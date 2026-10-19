package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/octree/latex-compile/internal"
)

// publicRoutes are the only routes allowed to answer without a token. Every
// other registered route must sit behind the auth middleware; this test fails
// if a new route is added outside the protected group.
var publicRoutes = map[string]bool{
	"GET /health": true,
}

// TestEveryRouteButHealthRequiresAuth builds the real router with auth on and
// hits each registered route without a token. Public routes may answer;
// everything else must be rejected by the middleware (401, no secret-bearing
// handler ever runs).
func TestEveryRouteButHealthRequiresAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupRouter(internal.AuthConfig{Secret: "unit-test-secret"})

	for _, r := range router.Routes() {
		key := r.Method + " " + r.Path
		req := httptest.NewRequest(r.Method, r.Path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if publicRoutes[key] {
			if w.Code == http.StatusUnauthorized {
				t.Errorf("%s is public but was rejected with 401", key)
			}
			continue
		}
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s answered %d without a token; expected 401 (route not behind auth middleware?)", key, w.Code)
		}
	}
}

// TestProtectedRouteSetIsExpected pins the exact set of protected routes, so
// adding or removing one is a deliberate, reviewed change.
func TestProtectedRouteSetIsExpected(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := setupRouter(internal.AuthConfig{Secret: "unit-test-secret"})

	want := map[string]bool{
		"GET /health":      true, // public
		"POST /compile":    true,
		"POST /synctex":    true,
		"POST /word-count": true,
	}
	got := map[string]bool{}
	for _, r := range router.Routes() {
		got[r.Method+" "+r.Path] = true
	}
	for route := range want {
		if !got[route] {
			t.Errorf("expected route %q to be registered", route)
		}
	}
	for route := range got {
		if !want[route] {
			t.Errorf("unexpected route %q registered; add it to the test and confirm its auth placement", route)
		}
	}
}
