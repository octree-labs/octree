package internal

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// jwksServer serves a mutable key set and counts fetches; down makes it 503.
type jwksServer struct {
	*httptest.Server
	mu   sync.Mutex
	keys []map[string]string
	hits atomic.Int32
	down atomic.Bool
}

func newJWKSServer(t *testing.T) *jwksServer {
	t.Helper()
	s := &jwksServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.hits.Add(1)
		if s.down.Load() {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": s.keys})
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *jwksServer) set(keys ...map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys = keys
}

// testOctKey is the symmetric JWKS entry in the fixture, deliberately not
// the HS256 secret, so a token HMAC'd with it proves oct keys are ignored.
const testOctKey = "jwks-oct-key-not-the-secret"

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func ecJWK(kid string, pub *ecdsa.PublicKey) map[string]string {
	x := make([]byte, 32)
	y := make([]byte, 32)
	pub.X.FillBytes(x)
	pub.Y.FillBytes(y)
	return map[string]string{"kid": kid, "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "x": b64u(x), "y": b64u(y)}
}

func rsaJWK(kid string, pub *rsa.PublicKey) map[string]string {
	return map[string]string{"kid": kid, "kty": "RSA", "alg": "RS256", "use": "sig",
		"n": b64u(pub.N.Bytes()), "e": b64u(big.NewInt(int64(pub.E)).Bytes())}
}

func mintAsym(t *testing.T, method jwt.SigningMethod, kid string, key any, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(method, claims)
	if kid != "" {
		tok.Header["kid"] = kid
	}
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign %s: %v", method.Alg(), err)
	}
	return s
}

func asymUserClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"iss": "https://abcdefghijklmnop.supabase.co/auth/v1", "sub": "0f0e0d0c-user", "aud": "authenticated",
		"role": "authenticated", "iat": testNow.Unix(), "exp": testNow.Add(time.Hour).Unix(),
	}
}

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type asymFixture struct {
	srv    *jwksServer
	clock  *fakeClock
	cfg    AuthConfig
	ecKey  *ecdsa.PrivateKey
	rsaKey *rsa.PrivateKey
}

func newAsymFixture(t *testing.T, withSecret bool) *asymFixture {
	t.Helper()
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	srv := newJWKSServer(t)
	srv.set(ecJWK("ec-1", &ecKey.PublicKey), rsaJWK("rsa-1", &rsaKey.PublicKey),
		map[string]string{"kid": "legacy", "kty": "oct", "k": b64u([]byte(testOctKey))})
	clock := &fakeClock{t: testNow}
	jwks := &JWKS{URL: srv.URL, Now: clock.Now, TTL: 10 * time.Minute, MinRefetchInterval: 30 * time.Second}
	cfg := AuthConfig{JWKS: jwks, Now: clock.Now}
	if withSecret {
		cfg.Secret = testJWTSecret
	}
	return &asymFixture{srv: srv, clock: clock, cfg: cfg, ecKey: ecKey, rsaKey: rsaKey}
}

func TestAsymAcceptsES256AndRS256(t *testing.T) {
	f := newAsymFixture(t, true)
	for _, tc := range []struct {
		name   string
		method jwt.SigningMethod
		kid    string
		key    any
	}{
		{"ES256", jwt.SigningMethodES256, "ec-1", f.ecKey},
		{"RS256", jwt.SigningMethodRS256, "rsa-1", f.rsaKey},
	} {
		t.Run(tc.name, func(t *testing.T) {
			claims, err := ValidateToken(mintAsym(t, tc.method, tc.kid, tc.key, asymUserClaims()), f.cfg)
			if err != nil {
				t.Fatalf("expected valid %s token, got %v", tc.name, err)
			}
			if sub, _ := claims.GetSubject(); sub != "0f0e0d0c-user" {
				t.Fatalf("unexpected sub %q", sub)
			}
		})
	}
	// HS256 still works alongside the JWKS.
	if _, err := ValidateToken(userToken(t, testNow.Add(time.Hour)), f.cfg); err != nil {
		t.Fatalf("expected HS256 token to still validate, got %v", err)
	}
	if got := f.srv.hits.Load(); got != 1 {
		t.Fatalf("expected one JWKS fetch for both tokens, got %d", got)
	}
}

func TestAsymOnlyConfigRejectsHS256(t *testing.T) {
	f := newAsymFixture(t, false)
	if _, err := ValidateToken(userToken(t, testNow.Add(time.Hour)), f.cfg); err == nil {
		t.Fatalf("HS256 token must be rejected when no secret is configured")
	}
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims()), f.cfg); err != nil {
		t.Fatalf("expected ES256 with JWKS-only config to validate, got %v", err)
	}
}

func TestAsymRejectsWrongSignature(t *testing.T) {
	f := newAsymFixture(t, true)
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", other, asymUserClaims()), f.cfg); err == nil {
		t.Fatalf("ES256 token signed by a different key must be rejected")
	}
}

func TestAsymRejectsMissingKid(t *testing.T) {
	f := newAsymFixture(t, true)
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "", f.ecKey, asymUserClaims()), f.cfg); err == nil {
		t.Fatalf("ES256 token without kid must be rejected")
	}
}

func TestAsymRejectsAlgKeyMismatch(t *testing.T) {
	// An RS256 token naming the EC key's kid: the key is never handed to the
	// RSA verifier.
	f := newAsymFixture(t, true)
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodRS256, "ec-1", f.rsaKey, asymUserClaims()), f.cfg); err == nil {
		t.Fatalf("RS256 token with an EC kid must be rejected")
	}
}

func TestAsymRejectsExpiredAndWrongRole(t *testing.T) {
	f := newAsymFixture(t, true)
	expired := asymUserClaims()
	expired["exp"] = testNow.Add(-time.Hour).Unix()
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, expired), f.cfg); !errors.Is(err, jwt.ErrTokenExpired) {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
	anon := asymUserClaims()
	anon["role"] = "anon"
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, anon), f.cfg); !errors.Is(err, ErrTokenRole) {
		t.Fatalf("expected ErrTokenRole, got %v", err)
	}
	// Issuer policy applies to asymmetric user tokens as well.
	cfg := f.cfg
	cfg.Issuer = "https://other.supabase.co/auth/v1"
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims()), cfg); !errors.Is(err, ErrTokenIssuer) {
		t.Fatalf("expected ErrTokenIssuer, got %v", err)
	}
}

func TestAsymUnknownKidRefetchesOnceThenRateLimits(t *testing.T) {
	f := newAsymFixture(t, true)
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims()), f.cfg); err != nil {
		t.Fatal(err)
	}
	if f.srv.hits.Load() != 1 {
		t.Fatalf("expected 1 fetch, got %d", f.srv.hits.Load())
	}

	// Rotation: a new key appears upstream. Its first token triggers one refetch.
	f.clock.Advance(time.Minute)
	rotated, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	f.srv.set(ecJWK("ec-1", &f.ecKey.PublicKey), ecJWK("ec-2", &rotated.PublicKey))
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-2", rotated, asymUserClaims()), f.cfg); err != nil {
		t.Fatalf("expected token with new kid to validate after one refetch, got %v", err)
	}
	if f.srv.hits.Load() != 2 {
		t.Fatalf("expected 2 fetches, got %d", f.srv.hits.Load())
	}

	// A burst of garbage kids within the refetch interval costs nothing upstream.
	for i := 0; i < 50; i++ {
		tok := mintAsym(t, jwt.SigningMethodES256, "garbage-kid", rotated, asymUserClaims())
		if _, err := ValidateToken(tok, f.cfg); err == nil {
			t.Fatalf("unknown kid must be rejected")
		}
	}
	if f.srv.hits.Load() != 2 {
		t.Fatalf("unknown kids within the refetch interval must not refetch, got %d fetches", f.srv.hits.Load())
	}

	// After the interval, one more refetch is allowed.
	f.clock.Advance(31 * time.Second)
	_, _ = ValidateToken(mintAsym(t, jwt.SigningMethodES256, "garbage-kid", rotated, asymUserClaims()), f.cfg)
	if f.srv.hits.Load() != 3 {
		t.Fatalf("expected a refetch after the interval, got %d fetches", f.srv.hits.Load())
	}
}

func TestAsymJWKSDownUsesCachedKeys(t *testing.T) {
	f := newAsymFixture(t, true)
	tok := func() string { return mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims()) }
	if _, err := ValidateToken(tok(), f.cfg); err != nil {
		t.Fatal(err)
	}
	f.srv.down.Store(true)
	// Past the TTL the cache tries to refresh, fails, and keeps the last good set.
	f.clock.Advance(11 * time.Minute)
	if _, err := ValidateToken(tok(), f.cfg); err != nil {
		t.Fatalf("expected cached key to be used while JWKS is down, got %v", err)
	}
	if f.srv.hits.Load() != 2 {
		t.Fatalf("expected one failed refresh attempt, got %d fetches", f.srv.hits.Load())
	}
	// Retried at most once per refetch interval while still down.
	for i := 0; i < 10; i++ {
		if _, err := ValidateToken(tok(), f.cfg); err != nil {
			t.Fatal(err)
		}
	}
	if f.srv.hits.Load() != 2 {
		t.Fatalf("failed refresh must be rate limited, got %d fetches", f.srv.hits.Load())
	}
	// Back up: the next refresh after the interval succeeds.
	f.srv.down.Store(false)
	f.clock.Advance(31 * time.Second)
	if _, err := ValidateToken(tok(), f.cfg); err != nil {
		t.Fatal(err)
	}
	if f.srv.hits.Load() != 3 {
		t.Fatalf("expected refresh after recovery, got %d fetches", f.srv.hits.Load())
	}
}

func TestAsymJWKSDownWithNoCacheRejects(t *testing.T) {
	f := newAsymFixture(t, true)
	f.srv.down.Store(true)
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims()), f.cfg); err == nil {
		t.Fatalf("expected rejection when no keys could ever be fetched")
	}
}

// hmacToken signs header.payload with HMAC-SHA256 under key, for crafting
// alg-confusion tokens the library would refuse to build.
func hmacToken(t *testing.T, header map[string]any, claims jwt.MapClaims, key []byte) string {
	t.Helper()
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	signing := b64u(h) + "." + b64u(c)
	sig, err := jwt.SigningMethodHS256.Sign(signing, key)
	if err != nil {
		t.Fatal(err)
	}
	return signing + "." + b64u(sig)
}

func TestAsymRejectsAlgConfusion(t *testing.T) {
	f := newAsymFixture(t, true)
	der, err := x509.MarshalPKIXPublicKey(&f.rsaKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	ecDer, _ := x509.MarshalPKIXPublicKey(&f.ecKey.PublicKey)
	ecPem := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: ecDer})
	jwkJSON, _ := json.Marshal(rsaJWK("rsa-1", &f.rsaKey.PublicKey))

	cases := map[string]string{
		// Classic: HS256 header + kid of the RSA key, HMAC'd with the public key.
		"HS256 keyed with RSA PEM":  hmacToken(t, map[string]any{"alg": "HS256", "typ": "JWT", "kid": "rsa-1"}, asymUserClaims(), pemBytes),
		"HS256 keyed with RSA DER":  hmacToken(t, map[string]any{"alg": "HS256", "typ": "JWT", "kid": "rsa-1"}, asymUserClaims(), der),
		"HS256 keyed with EC PEM":   hmacToken(t, map[string]any{"alg": "HS256", "typ": "JWT", "kid": "ec-1"}, asymUserClaims(), ecPem),
		"HS256 keyed with JWK JSON": hmacToken(t, map[string]any{"alg": "HS256", "typ": "JWT", "kid": "rsa-1"}, asymUserClaims(), jwkJSON),
		// The oct entry's k is distinct from the secret: it must never be used.
		"HS256 keyed with oct JWK k": hmacToken(t, map[string]any{"alg": "HS256", "typ": "JWT", "kid": "legacy"}, asymUserClaims(), []byte(testOctKey)),
		// RS256 header but HMAC'd with the shared secret.
		"RS256 header HMAC'd with secret": hmacToken(t, map[string]any{"alg": "RS256", "typ": "JWT", "kid": "rsa-1"}, asymUserClaims(), []byte(testJWTSecret)),
		"ES256 header HMAC'd with secret": hmacToken(t, map[string]any{"alg": "ES256", "typ": "JWT", "kid": "ec-1"}, asymUserClaims(), []byte(testJWTSecret)),
		// Other algorithms the library knows but we never allow.
		"HS512 with secret": func() string {
			s, _ := jwt.NewWithClaims(jwt.SigningMethodHS512, asymUserClaims()).SignedString([]byte(testJWTSecret))
			return s
		}(),
		"PS256 with RSA key": mintAsym(t, jwt.SigningMethodPS256, "rsa-1", f.rsaKey, asymUserClaims()),
	}
	// alg none, with and without a kid.
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, asymUserClaims()).SignedString(jwt.UnsafeAllowNoneSignatureType)
	cases["alg none"] = none
	noneKid := jwt.NewWithClaims(jwt.SigningMethodNone, asymUserClaims())
	noneKid.Header["kid"] = "rsa-1"
	s, _ := noneKid.SignedString(jwt.UnsafeAllowNoneSignatureType)
	cases["alg none with kid"] = s
	cases["alg None (case)"] = strings.Replace(none, b64u([]byte(`{"alg":"none","typ":"JWT"}`)), b64u([]byte(`{"alg":"None","typ":"JWT"}`)), 1)

	for name, tok := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ValidateToken(tok, f.cfg); err == nil {
				t.Fatalf("expected %s to be rejected", name)
			}
		})
	}
}

func TestParseJWKRejectsWeakAndMalformedKeys(t *testing.T) {
	small, _ := rsa.GenerateKey(rand.Reader, 1024)
	ec, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	offCurve := ecJWK("bad", &ec.PublicKey)
	offCurve["y"] = offCurve["x"]
	p384, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	encJWK := ecJWK("enc", &ec.PublicKey)
	encJWK["use"] = "enc"
	for name, k := range map[string]map[string]string{
		"rsa-1024":  rsaJWK("small", &small.PublicKey),
		"off-curve": offCurve,
		"p384":      {"kid": "p384", "kty": "EC", "crv": "P-384", "x": b64u(p384.X.Bytes()), "y": b64u(p384.Y.Bytes())},
		"use enc":   encJWK,
		"oct":       {"kid": "oct", "kty": "oct", "k": b64u([]byte("secret"))},
		"no kid":    {"kty": "EC", "crv": "P-256", "x": ecJWK("", &ec.PublicKey)["x"], "y": ecJWK("", &ec.PublicKey)["y"]},
	} {
		raw, _ := json.Marshal(k)
		var parsed jwk
		_ = json.Unmarshal(raw, &parsed)
		if _, err := parseJWK(parsed); err == nil {
			t.Errorf("%s: expected parseJWK to fail", name)
		}
	}
}

func TestJWKSURLFromEnv(t *testing.T) {
	for _, tc := range []struct {
		supabaseURL, jwksURL, want string
		wantErr                    bool
	}{
		{"", "", "", false},
		{"https://abc.supabase.co", "", "https://abc.supabase.co/auth/v1/.well-known/jwks.json", false},
		{"https://abc.supabase.co/", "", "https://abc.supabase.co/auth/v1/.well-known/jwks.json", false},
		{"http://127.0.0.1:54321", "", "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json", false},
		{"https://abc.supabase.co", "https://keys.example.com/jwks.json", "https://keys.example.com/jwks.json", false},
		{"http://abc.supabase.co", "", "", true},
		{"abc.supabase.co", "", "", true},
	} {
		got, err := JWKSURLFromEnv(tc.supabaseURL, tc.jwksURL)
		if (err != nil) != tc.wantErr || got != tc.want {
			t.Errorf("JWKSURLFromEnv(%q, %q) = %q, %v; want %q, err=%v", tc.supabaseURL, tc.jwksURL, got, err, tc.want, tc.wantErr)
		}
	}
}

func TestJWTAuthMiddlewareJWKSOnly(t *testing.T) {
	f := newAsymFixture(t, false)
	r := newAuthTestRouter(f.cfg)
	tok := mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims())
	if w := doAuthRequest(r, "Bearer "+tok); w.Code != http.StatusOK {
		t.Fatalf("expected 200 for ES256 user token, got %d", w.Code)
	}
	anon := asymUserClaims()
	anon["role"] = "anon"
	if w := doAuthRequest(r, "Bearer "+mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, anon)); w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for ES256 anon token, got %d", w.Code)
	}
	if w := doAuthRequest(r, "Bearer "+userToken(t, testNow.Add(time.Hour))); w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for HS256 token without a secret, got %d", w.Code)
	}
}

func TestAsymJWKSDownWithNoCacheIsUnavailable(t *testing.T) {
	f := newAsymFixture(t, true)
	f.srv.down.Store(true)
	_, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims()), f.cfg)
	if !errors.Is(err, ErrJWKSUnavailable) {
		t.Fatalf("expected ErrJWKSUnavailable, got %v", err)
	}
	r := newAuthTestRouter(f.cfg)
	if w := doAuthRequest(r, "Bearer "+mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims())); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 while the JWKS is unreachable, got %d", w.Code)
	}
}

func TestAsymEmptySetRevokesCachedKeys(t *testing.T) {
	f := newAsymFixture(t, true)
	tok := mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims())
	if _, err := ValidateToken(tok, f.cfg); err != nil {
		t.Fatal(err)
	}
	// Every asymmetric key is removed upstream (e.g. after revocation).
	f.srv.set([]map[string]string{}...) // {"keys":[]}
	f.clock.Advance(11 * time.Minute)
	if _, err := ValidateToken(tok, f.cfg); !errors.Is(err, ErrJWKSKeyNotFound) {
		t.Fatalf("expected revoked key to stop verifying, got %v", err)
	}
}

func TestAsymCachedKeysExpireAfterMaxStale(t *testing.T) {
	f := newAsymFixture(t, true)
	f.cfg.JWKS.MaxStale = time.Hour
	tok := func() string { return mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims()) }
	if _, err := ValidateToken(tok(), f.cfg); err != nil {
		t.Fatal(err)
	}
	f.srv.down.Store(true)
	f.clock.Advance(30 * time.Minute)
	if _, err := ValidateToken(tok(), f.cfg); err != nil {
		t.Fatalf("expected cached key within MaxStale, got %v", err)
	}
	f.clock.Advance(31 * time.Minute)
	claims := asymUserClaims()
	claims["exp"] = f.clock.Now().Add(time.Hour).Unix()
	if _, err := ValidateToken(mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, claims), f.cfg); !errors.Is(err, ErrJWKSUnavailable) {
		t.Fatalf("expected ErrJWKSUnavailable past MaxStale, got %v", err)
	}
}

func TestJWKSLookupDoesNotWaitOnRefresh(t *testing.T) {
	f := newAsymFixture(t, true)
	tok := mintAsym(t, jwt.SigningMethodES256, "ec-1", f.ecKey, asymUserClaims())
	if _, err := ValidateToken(tok, f.cfg); err != nil {
		t.Fatal(err)
	}
	f.clock.Advance(11 * time.Minute)
	// Simulate a refresh in flight: a stale but known kid is still served.
	f.cfg.JWKS.fetchMu.Lock()
	defer f.cfg.JWKS.fetchMu.Unlock()
	done := make(chan error, 1)
	go func() { _, err := ValidateToken(tok, f.cfg); done <- err }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected cached key during an in-flight refresh, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("lookup blocked on an in-flight JWKS refresh")
	}
}
