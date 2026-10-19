package internal

import (
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const testJWTSecret = "test-secret-for-compile-service-unit-tests"

var testNow = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func mintToken(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

// Shapes mirror real Supabase tokens: the anon/service keys carry iss
// "supabase" and a far-future exp; user access tokens carry the project's
// auth URL and a one-hour exp.
func anonKey(t *testing.T) string {
	return mintToken(t, testJWTSecret, jwt.MapClaims{
		"iss": "supabase", "ref": "abcdefghijklmnop", "role": "anon",
		"iat": testNow.Unix(), "exp": testNow.Add(10 * 365 * 24 * time.Hour).Unix(),
	})
}

func serviceRoleKey(t *testing.T) string {
	return mintToken(t, testJWTSecret, jwt.MapClaims{
		"iss": "supabase", "ref": "abcdefghijklmnop", "role": "service_role",
		"iat": testNow.Unix(), "exp": testNow.Add(10 * 365 * 24 * time.Hour).Unix(),
	})
}

func userToken(t *testing.T, exp time.Time) string {
	return mintToken(t, testJWTSecret, jwt.MapClaims{
		"iss": "https://abcdefghijklmnop.supabase.co/auth/v1", "sub": "0f0e0d0c-user", "aud": "authenticated",
		"role": "authenticated", "iat": testNow.Unix(), "exp": exp.Unix(),
	})
}

func testAuthConfig() AuthConfig {
	return AuthConfig{Secret: testJWTSecret, Now: func() time.Time { return testNow }}
}

func TestValidateTokenAcceptsAuthenticatedUser(t *testing.T) {
	claims, err := ValidateToken(userToken(t, testNow.Add(time.Hour)), testAuthConfig())
	if err != nil {
		t.Fatalf("expected user token to validate, got %v", err)
	}
	if claims["role"] != "authenticated" {
		t.Fatalf("unexpected role %v", claims["role"])
	}
}

func TestValidateTokenAcceptsServiceRole(t *testing.T) {
	if _, err := ValidateToken(serviceRoleKey(t), testAuthConfig()); err != nil {
		t.Fatalf("expected service-role key to validate, got %v", err)
	}
}

func TestValidateTokenRejectsAnonKey(t *testing.T) {
	_, err := ValidateToken(anonKey(t), testAuthConfig())
	if !errors.Is(err, ErrTokenRole) {
		t.Fatalf("expected anon key to be rejected with ErrTokenRole, got %v", err)
	}
}

func TestValidateTokenRejectsMissingRole(t *testing.T) {
	// The shape PR #405's preview token has today (iss/sub/exp, no role).
	token := mintToken(t, testJWTSecret, jwt.MapClaims{
		"iss": "octree-app", "sub": "import-preview", "iat": testNow.Unix(), "exp": testNow.Add(2 * time.Minute).Unix(),
	})
	_, err := ValidateToken(token, testAuthConfig())
	if !errors.Is(err, ErrTokenRole) {
		t.Fatalf("expected token without role to be rejected with ErrTokenRole, got %v", err)
	}
}

func TestValidateTokenRejectsUnknownRole(t *testing.T) {
	token := mintToken(t, testJWTSecret, jwt.MapClaims{
		"role": "superuser", "exp": testNow.Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(token, testAuthConfig()); !errors.Is(err, ErrTokenRole) {
		t.Fatalf("expected unknown role to be rejected, got %v", err)
	}
}

func TestValidateTokenRejectsExpired(t *testing.T) {
	_, err := ValidateToken(userToken(t, testNow.Add(-time.Hour)), testAuthConfig())
	if !errors.Is(err, jwt.ErrTokenExpired) {
		t.Fatalf("expected expired token to be rejected with ErrTokenExpired, got %v", err)
	}
}

func TestValidateTokenToleratesSmallSkew(t *testing.T) {
	// Expired 10s ago is inside the 30s leeway; 5 minutes ago is not.
	if _, err := ValidateToken(userToken(t, testNow.Add(-10*time.Second)), testAuthConfig()); err != nil {
		t.Fatalf("expected token inside leeway to validate, got %v", err)
	}
	if _, err := ValidateToken(userToken(t, testNow.Add(-5*time.Minute)), testAuthConfig()); err == nil {
		t.Fatalf("expected token outside leeway to be rejected")
	}
}

func TestValidateTokenRequiresExp(t *testing.T) {
	token := mintToken(t, testJWTSecret, jwt.MapClaims{"role": "authenticated", "iss": "supabase"})
	if _, err := ValidateToken(token, testAuthConfig()); err == nil {
		t.Fatalf("expected token without exp to be rejected")
	}
}

func TestValidateTokenRejectsWrongSecret(t *testing.T) {
	token := mintToken(t, "some-other-secret", jwt.MapClaims{
		"role": "service_role", "iss": "supabase", "exp": testNow.Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(token, testAuthConfig()); !errors.Is(err, jwt.ErrSignatureInvalid) {
		t.Fatalf("expected signature error, got %v", err)
	}
}

func TestValidateTokenRejectsAlgNone(t *testing.T) {
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"role": "service_role", "exp": testNow.Add(time.Hour).Unix(),
	})
	unsigned, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none token: %v", err)
	}
	if _, err := ValidateToken(unsigned, testAuthConfig()); err == nil {
		t.Fatalf("expected alg=none token to be rejected")
	}
}

func TestValidateTokenIssuerPolicy(t *testing.T) {
	cfg := testAuthConfig()
	cfg.Issuer = "https://abcdefghijklmnop.supabase.co/auth/v1"

	if _, err := ValidateToken(userToken(t, testNow.Add(time.Hour)), cfg); err != nil {
		t.Fatalf("expected user token with matching issuer to validate, got %v", err)
	}

	// Service-role key keeps working with an issuer configured (iss "supabase").
	if _, err := ValidateToken(serviceRoleKey(t), cfg); err != nil {
		t.Fatalf("expected service-role key to validate with issuer configured, got %v", err)
	}

	foreign := mintToken(t, testJWTSecret, jwt.MapClaims{
		"iss": "https://other-project.supabase.co/auth/v1", "role": "authenticated", "exp": testNow.Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(foreign, cfg); !errors.Is(err, ErrTokenIssuer) {
		t.Fatalf("expected foreign issuer to be rejected with ErrTokenIssuer, got %v", err)
	}
}

func TestValidateTokenRequiresSecret(t *testing.T) {
	if _, err := ValidateToken(serviceRoleKey(t), AuthConfig{}); err == nil {
		t.Fatalf("expected validation without a secret to fail")
	}
}

func newAuthTestRouter(cfg AuthConfig) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(JWTAuthMiddleware(cfg))
	r.POST("/compile", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	return r
}

func doAuthRequest(r *gin.Engine, authorization string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/compile", nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestJWTAuthMiddleware(t *testing.T) {
	r := newAuthTestRouter(testAuthConfig())

	cases := []struct {
		name   string
		header string
		status int
	}{
		{"missing header", "", http.StatusUnauthorized},
		{"not bearer", "Basic abc", http.StatusUnauthorized},
		{"user token", "Bearer " + userToken(t, testNow.Add(time.Hour)), http.StatusOK},
		{"service role", "Bearer " + serviceRoleKey(t), http.StatusOK},
		{"anon key", "Bearer " + anonKey(t), http.StatusForbidden},
		{"expired", "Bearer " + userToken(t, testNow.Add(-time.Hour)), http.StatusUnauthorized},
		{"garbage", "Bearer not.a.jwt", http.StatusUnauthorized},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if w := doAuthRequest(r, tc.header); w.Code != tc.status {
				t.Fatalf("%s: got %d want %d (body %s)", tc.name, w.Code, tc.status, w.Body.String())
			}
		})
	}
}

func TestJWTAuthMiddlewareFailsClosedWithoutSecret(t *testing.T) {
	// No secret and no explicit opt-out: every protected request is refused,
	// even a would-be valid one, so a misconfigured production deploy is not
	// silently open.
	r := newAuthTestRouter(AuthConfig{})
	if w := doAuthRequest(r, "Bearer "+serviceRoleKey(t)); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when secret is unset, got %d", w.Code)
	}
}

func TestJWTAuthMiddlewareOpenOnlyWhenExplicitlyAllowed(t *testing.T) {
	r := newAuthTestRouter(AuthConfig{AllowUnauthenticated: true})
	if w := doAuthRequest(r, ""); w.Code != http.StatusOK {
		t.Fatalf("expected open access with AllowUnauthenticated, got %d", w.Code)
	}
}

func TestValidateTokenRejectsNbfInFuture(t *testing.T) {
	token := mintToken(t, testJWTSecret, jwt.MapClaims{
		"role": "service_role", "iss": "supabase",
		"nbf": testNow.Add(10 * time.Minute).Unix(),
		"exp": testNow.Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(token, testAuthConfig()); !errors.Is(err, jwt.ErrTokenNotValidYet) {
		t.Fatalf("expected nbf-in-future token to be rejected with ErrTokenNotValidYet, got %v", err)
	}
}

func TestValidateTokenRejectsRS256(t *testing.T) {
	// An RS256 token must be rejected by the alg allowlist, not cause a panic
	// when the HS256 keyfunc hands []byte to an RSA verifier.
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"role": "service_role", "iss": "supabase", "exp": testNow.Add(time.Hour).Unix(),
	})
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign rs256: %v", err)
	}
	if _, err := ValidateToken(signed, testAuthConfig()); err == nil {
		t.Fatalf("expected RS256 token to be rejected")
	}
}

func TestValidateTokenRejectsNonStringRole(t *testing.T) {
	token := mintToken(t, testJWTSecret, jwt.MapClaims{
		"role": []string{"service_role"}, "iss": "supabase", "exp": testNow.Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(token, testAuthConfig()); !errors.Is(err, ErrTokenRole) {
		t.Fatalf("expected non-string role to be rejected with ErrTokenRole, got %v", err)
	}
}

func TestValidateTokenRejectsFarFutureExpAnon(t *testing.T) {
	// A Supabase anon key has a ~10-year exp and a valid signature; exp being
	// far in the future must not matter, the role gate still rejects it.
	if _, err := ValidateToken(anonKey(t), testAuthConfig()); !errors.Is(err, ErrTokenRole) {
		t.Fatalf("expected far-future-exp anon key to be rejected by role, got %v", err)
	}
}

func TestJWTAuthMiddlewareBearerPrefixVariants(t *testing.T) {
	r := newAuthTestRouter(testAuthConfig())
	tok := serviceRoleKey(t)
	cases := []struct {
		name   string
		header string
		status int
	}{
		{"lowercase bearer", "bearer " + tok, http.StatusOK},
		{"mixed case bearer", "BeArEr " + tok, http.StatusOK},
		{"extra spaces after bearer", "Bearer   " + tok, http.StatusOK},
		{"no space", "Bearer" + tok, http.StatusUnauthorized},
		{"token only, no prefix", tok, http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if w := doAuthRequest(r, tc.header); w.Code != tc.status {
				t.Fatalf("%s: got %d want %d", tc.name, w.Code, tc.status)
			}
		})
	}
}
