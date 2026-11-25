package internal

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// Compile and SyncTeX requests are authenticated with a Supabase-issued JWT.
// Two signing schemes are accepted, chosen by the token's alg header:
//
//   - HS256, verified with SUPABASE_JWT_SECRET (legacy, and what the legacy
//     anon/service-role keys and lib/compile/credential.ts tokens use)
//   - ES256 / RS256, verified with the project's public JWKS key whose kid
//     matches the token (Supabase asymmetric signing keys); enabled by
//     SUPABASE_URL or SUPABASE_JWKS_URL
//
// An HS256 token is never checked against a JWKS key and an ES/RS token never
// against the secret (no alg confusion); "none" and every other alg fail.
//
// Three kinds of token reach the service:
//
//   - a signed-in user's access token  (role "authenticated", iss https://<ref>.supabase.co/auth/v1)
//   - the service-role key              (role "service_role", iss "supabase")
//   - the public anon key               (role "anon",         iss "supabase")
//
// The anon key ships in every browser bundle, so a valid signature alone is
// not proof of anything. Only the first two roles may drive the compiler.
var allowedTokenRoles = map[string]bool{
	"authenticated": true,
	"service_role":  true,
}

// jwtClockSkew tolerates small clock differences between Supabase and the droplet.
const jwtClockSkew = 30 * time.Second

var (
	ErrTokenRole   = errors.New("token role is not allowed")
	ErrTokenIssuer = errors.New("token issuer is not allowed")
)

// AuthConfig is the compile service's token policy.
type AuthConfig struct {
	// Secret is SUPABASE_JWT_SECRET. Empty is a configuration error unless
	// AllowUnauthenticated is set: the middleware then fails closed.
	Secret string
	// JWKS, when set, verifies ES256/RS256 tokens by kid (SUPABASE_URL or
	// SUPABASE_JWKS_URL). Either Secret or JWKS is enough to enable auth.
	JWKS *JWKS
	// AllowUnauthenticated (COMPILE_AUTH_DISABLED=true) turns the middleware
	// into a no-op when neither Secret nor JWKS is set. Local development only.
	AllowUnauthenticated bool
	// Issuer, when set, must equal the iss claim of "authenticated" tokens
	// (Supabase: https://<ref>.supabase.co/auth/v1). Service-role keys carry
	// iss "supabase" and are accepted regardless, so enabling this never cuts
	// off the ops health check.
	Issuer string
	// Now overrides the clock in tests.
	Now func() time.Time
}

// Configured reports whether any verifier (secret or JWKS) is set.
func (cfg AuthConfig) Configured() bool {
	return cfg.Secret != "" || cfg.JWKS != nil
}

// validMethods is the alg allow-list for this configuration.
func (cfg AuthConfig) validMethods() []string {
	var m []string
	if cfg.Secret != "" {
		m = append(m, "HS256")
	}
	if cfg.JWKS != nil {
		m = append(m, "ES256", "RS256")
	}
	return m
}

// keyFor picks the verification key strictly by alg: the HMAC secret only for
// HS256, a JWKS key of the matching type only for ES256/RS256.
func (cfg AuthConfig) keyFor(t *jwt.Token) (interface{}, error) {
	switch t.Method.Alg() {
	case "HS256":
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok || cfg.Secret == "" {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(cfg.Secret), nil
	case "ES256", "RS256":
		if cfg.JWKS == nil {
			return nil, jwt.ErrSignatureInvalid
		}
		switch t.Method.(type) {
		case *jwt.SigningMethodECDSA, *jwt.SigningMethodRSA:
		default:
			return nil, jwt.ErrSignatureInvalid
		}
		kid, _ := t.Header["kid"].(string)
		return cfg.JWKS.Key(kid, t.Method.Alg())
	default:
		return nil, jwt.ErrSignatureInvalid
	}
}

// ValidateToken verifies the signature and the claims the service relies on:
// HS256 (secret) or ES256/RS256 (JWKS by kid), exp present and in the future,
// nbf honoured, role in allowedTokenRoles, and (when configured) the issuer
// of user tokens.
func ValidateToken(tokenString string, cfg AuthConfig) (jwt.MapClaims, error) {
	if !cfg.Configured() {
		return nil, errors.New("jwt verification not configured")
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, cfg.keyFor,
		jwt.WithValidMethods(cfg.validMethods()),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(jwtClockSkew),
		jwt.WithTimeFunc(now),
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}

	role, _ := claims["role"].(string)
	if !allowedTokenRoles[role] {
		return nil, fmt.Errorf("%w: %q", ErrTokenRole, role)
	}

	if cfg.Issuer != "" && role == "authenticated" {
		iss, _ := claims.GetIssuer()
		if iss != cfg.Issuer {
			return nil, fmt.Errorf("%w: %q", ErrTokenIssuer, iss)
		}
	}

	return claims, nil
}

// JWTAuthMiddleware rejects requests without a valid bearer token. No
// verifier (neither secret nor JWKS) fails closed (503 on every protected route) unless
// AllowUnauthenticated is set, the local dev configuration; main.go refuses
// to start in that state anyway, this is the second line.
func JWTAuthMiddleware(cfg AuthConfig) gin.HandlerFunc {
	if !cfg.Configured() {
		if !cfg.AllowUnauthenticated {
			log.Printf("ERROR: neither SUPABASE_JWT_SECRET nor SUPABASE_URL is set and COMPILE_AUTH_DISABLED is not true; protected routes will refuse every request")
			return func(c *gin.Context) {
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Service authentication is not configured"})
			}
		}
		log.Printf("WARNING: COMPILE_AUTH_DISABLED=true and no SUPABASE_JWT_SECRET/SUPABASE_URL is set; protected routes accept unauthenticated requests (local development only)")
		return func(c *gin.Context) { c.Next() }
	}

	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			return
		}

		const prefix = "Bearer "
		if len(authHeader) < len(prefix) || !strings.EqualFold(authHeader[:len(prefix)], prefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			return
		}

		tokenString := strings.TrimSpace(authHeader[len(prefix):])
		claims, err := ValidateToken(tokenString, cfg)
		if err != nil {
			switch {
			case errors.Is(err, ErrTokenRole), errors.Is(err, ErrTokenIssuer):
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Token not permitted to use this service"})
			case errors.Is(err, ErrJWKSUnavailable):
				// The signing keys could not be fetched: our outage, not a
				// bad token, so do not tell the client to re-authenticate.
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Token verification temporarily unavailable"})
			default:
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			}
			return
		}

		if sub, _ := claims.GetSubject(); sub != "" {
			c.Set("authSubject", sub)
		}
		c.Next()
	}
}
