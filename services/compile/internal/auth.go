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

// Compile and SyncTeX requests are authenticated with a Supabase-issued HS256
// JWT. Three kinds of token are signed with the project's JWT secret:
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
	// Secret is SUPABASE_JWT_SECRET. Empty disables authentication (local dev only).
	Secret string
	// Issuer, when set, must equal the iss claim of "authenticated" tokens
	// (Supabase: https://<ref>.supabase.co/auth/v1). Service-role keys carry
	// iss "supabase" and are accepted regardless, so enabling this never cuts
	// off the ops health check.
	Issuer string
	// Now overrides the clock in tests.
	Now func() time.Time
}

// ValidateToken verifies the signature and the claims the service relies on:
// HS256 only, exp present and in the future, role in allowedTokenRoles, and
// (when configured) the issuer of user tokens.
func ValidateToken(tokenString string, cfg AuthConfig) (jwt.MapClaims, error) {
	if cfg.Secret == "" {
		return nil, errors.New("jwt secret not configured")
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(cfg.Secret), nil
	},
		jwt.WithValidMethods([]string{"HS256"}),
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

// JWTAuthMiddleware rejects requests without a valid bearer token. With an
// empty secret the middleware is a no-op, which is the local dev
// configuration (services/compile/.env.example); production always sets it.
func JWTAuthMiddleware(cfg AuthConfig) gin.HandlerFunc {
	if cfg.Secret == "" {
		log.Printf("WARNING: SUPABASE_JWT_SECRET is not set; /compile and /synctex accept unauthenticated requests")
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
