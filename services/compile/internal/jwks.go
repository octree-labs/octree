package internal

import (
	"context"
	"crypto"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Supabase projects on asymmetric JWT signing keys sign user access tokens
// with ES256 (or RS256) and publish the public keys at
// <SUPABASE_URL>/auth/v1/.well-known/jwks.json, selected by the token's kid.
// JWKS fetches and caches that set. Only public signature keys are kept: EC
// P-256 for ES256 and RSA (>= 2048 bits) for RS256. Symmetric ("oct") entries
// are ignored, so the HMAC path can never be reached through the JWKS.

const (
	// DefaultJWKSTTL is how long a fetched key set is used before a refresh.
	DefaultJWKSTTL = 10 * time.Minute
	// DefaultJWKSMinRefetchInterval bounds fetches triggered by an unknown kid
	// (or an expired set), so a flood of garbage tokens costs one request to
	// Supabase per interval, not one per token.
	DefaultJWKSMinRefetchInterval = 30 * time.Second
	// DefaultJWKSHTTPTimeout caps one fetch.
	DefaultJWKSHTTPTimeout = 5 * time.Second

	jwksMaxBodyBytes = 1 << 20
	jwksPath         = "/auth/v1/.well-known/jwks.json"
)

var ErrJWKSKeyNotFound = errors.New("no signing key for token kid")

// JWKSURLFromEnv returns the JWKS URL: SUPABASE_JWKS_URL if set, else
// <SUPABASE_URL>/auth/v1/.well-known/jwks.json, else "". The URL must be
// https, except for a loopback host (the local Supabase stack).
func JWKSURLFromEnv(supabaseURL, jwksURL string) (string, error) {
	raw := strings.TrimSpace(jwksURL)
	if raw == "" {
		base := strings.TrimRight(strings.TrimSpace(supabaseURL), "/")
		if base == "" {
			return "", nil
		}
		raw = base + jwksPath
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("invalid JWKS URL %q", raw)
	}
	switch {
	case u.Scheme == "https":
	case u.Scheme == "http" && isLoopbackHost(u.Hostname()):
	default:
		return "", fmt.Errorf("JWKS URL must be https (http only for localhost): %q", raw)
	}
	return u.String(), nil
}

func isLoopbackHost(h string) bool {
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "host.docker.internal"
}

type jwk struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksKey struct {
	alg string // "ES256" or "RS256"
	key crypto.PublicKey
}

// JWKS is a concurrency-safe, in-memory cache of a remote JSON Web Key Set.
type JWKS struct {
	URL string
	// TTL, MinRefetchInterval and Client default to the Default* values.
	TTL                time.Duration
	MinRefetchInterval time.Duration
	Client             *http.Client
	// Now overrides the clock in tests.
	Now func() time.Time

	mu          sync.Mutex
	keys        map[string]jwksKey
	fetchedAt   time.Time // last successful fetch
	lastAttempt time.Time // last fetch attempt, successful or not
}

// NewJWKS returns a cache for url with the default TTL, refetch limit and timeout.
func NewJWKS(url string) *JWKS {
	return &JWKS{URL: url}
}

func (j *JWKS) now() time.Time {
	if j.Now != nil {
		return j.Now()
	}
	return time.Now()
}

func (j *JWKS) ttl() time.Duration {
	if j.TTL > 0 {
		return j.TTL
	}
	return DefaultJWKSTTL
}

func (j *JWKS) minRefetch() time.Duration {
	if j.MinRefetchInterval > 0 {
		return j.MinRefetchInterval
	}
	return DefaultJWKSMinRefetchInterval
}

func (j *JWKS) client() *http.Client {
	if j.Client != nil {
		return j.Client
	}
	return &http.Client{Timeout: DefaultJWKSHTTPTimeout}
}

// Warm fetches the key set once; errors are returned for logging only.
func (j *JWKS) Warm() error {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.refreshLocked()
}

// Key returns the public key for kid, which must be usable with alg
// (ES256 → ECDSA P-256, RS256 → RSA). A stale set is refreshed, and an
// unknown kid triggers a refresh, both at most once per MinRefetchInterval;
// a failed refresh keeps serving the last good set.
func (j *JWKS) Key(kid, alg string) (crypto.PublicKey, error) {
	if kid == "" {
		return nil, errors.New("token has no kid")
	}
	j.mu.Lock()
	defer j.mu.Unlock()

	now := j.now()
	canFetch := j.lastAttempt.IsZero() || now.Sub(j.lastAttempt) >= j.minRefetch()
	stale := j.keys == nil || now.Sub(j.fetchedAt) >= j.ttl()
	if stale && canFetch {
		if err := j.refreshLocked(); err != nil {
			log.Printf("WARNING: JWKS refresh failed (keeping %d cached keys): %v", len(j.keys), err)
		}
		canFetch = false
	}

	k, ok := j.keys[kid]
	if !ok && canFetch {
		if err := j.refreshLocked(); err != nil {
			log.Printf("WARNING: JWKS refresh for unknown kid failed (keeping %d cached keys): %v", len(j.keys), err)
		}
		k, ok = j.keys[kid]
	}
	if !ok {
		return nil, ErrJWKSKeyNotFound
	}
	if k.alg != alg {
		return nil, fmt.Errorf("key %q is for %s, token says %s", kid, k.alg, alg)
	}
	return k.key, nil
}

// refreshLocked fetches the set; on failure the cached keys are left as is.
func (j *JWKS) refreshLocked() error {
	j.lastAttempt = j.now()

	ctx, cancel := context.WithTimeout(context.Background(), DefaultJWKSHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, j.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := j.client().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS fetch: HTTP %d", resp.StatusCode)
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, jwksMaxBodyBytes)).Decode(&set); err != nil {
		return fmt.Errorf("JWKS decode: %w", err)
	}

	keys := make(map[string]jwksKey, len(set.Keys))
	for _, k := range set.Keys {
		parsed, err := parseJWK(k)
		if err != nil {
			if k.Kid != "" && k.Kty != "oct" {
				log.Printf("WARNING: skipping JWKS key %q: %v", k.Kid, err)
			}
			continue
		}
		keys[k.Kid] = parsed
	}
	if len(keys) == 0 {
		return errors.New("JWKS contains no usable ES256/RS256 keys")
	}
	j.keys = keys
	j.fetchedAt = j.lastAttempt
	return nil
}

func parseJWK(k jwk) (jwksKey, error) {
	if k.Kid == "" {
		return jwksKey{}, errors.New("missing kid")
	}
	if k.Use != "" && k.Use != "sig" {
		return jwksKey{}, fmt.Errorf("use %q is not sig", k.Use)
	}
	switch k.Kty {
	case "EC":
		if k.Alg != "" && k.Alg != "ES256" {
			return jwksKey{}, fmt.Errorf("unsupported EC alg %q", k.Alg)
		}
		if k.Crv != "P-256" {
			return jwksKey{}, fmt.Errorf("unsupported curve %q", k.Crv)
		}
		x, err := b64Fixed(k.X, 32)
		if err != nil {
			return jwksKey{}, fmt.Errorf("x: %w", err)
		}
		y, err := b64Fixed(k.Y, 32)
		if err != nil {
			return jwksKey{}, fmt.Errorf("y: %w", err)
		}
		// ecdh validates that the point is on the curve.
		if _, err := ecdh.P256().NewPublicKey(append(append([]byte{4}, x...), y...)); err != nil {
			return jwksKey{}, fmt.Errorf("invalid P-256 point: %w", err)
		}
		pub := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
		return jwksKey{alg: "ES256", key: pub}, nil
	case "RSA":
		if k.Alg != "" && k.Alg != "RS256" {
			return jwksKey{}, fmt.Errorf("unsupported RSA alg %q", k.Alg)
		}
		nb, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return jwksKey{}, fmt.Errorf("n: %w", err)
		}
		eb, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil || len(eb) == 0 || len(eb) > 4 {
			return jwksKey{}, errors.New("invalid e")
		}
		n := new(big.Int).SetBytes(nb)
		if n.BitLen() < 2048 {
			return jwksKey{}, fmt.Errorf("RSA key too small (%d bits)", n.BitLen())
		}
		e := int(new(big.Int).SetBytes(eb).Int64())
		if e < 3 || e%2 == 0 {
			return jwksKey{}, errors.New("invalid e")
		}
		return jwksKey{alg: "RS256", key: &rsa.PublicKey{N: n, E: e}}, nil
	default:
		return jwksKey{}, fmt.Errorf("unsupported kty %q", k.Kty)
	}
}

func b64Fixed(s string, size int) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	if len(b) != size {
		return nil, fmt.Errorf("want %d bytes, got %d", size, len(b))
	}
	return b, nil
}
