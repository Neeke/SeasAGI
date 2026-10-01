package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
)

// startOAuthPlatformStub 启动一个模拟企业服务端的 httptest server，
// 覆盖 /auth/oauth/providers 与 /auth/oauth/:provider/token 两个端点。
func startOAuthPlatformStub(t *testing.T, tokenHandler http.HandlerFunc) (*httptest.Server, *recordedExchange) {
	t.Helper()
	rec := &recordedExchange{}
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/oauth/providers", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"providers":[{"name":"google","client_id":"g-cid"},{"name":"github","client_id":"h-cid"}]}`))
	})
	mux.HandleFunc("/auth/oauth/google/token", func(w http.ResponseWriter, r *http.Request) {
		rec.record(t, r)
		tokenHandler(w, r)
	})
	mux.HandleFunc("/auth/oauth/github/token", func(w http.ResponseWriter, r *http.Request) {
		rec.record(t, r)
		tokenHandler(w, r)
	})
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts, rec
}

// recordedExchange 记录客户端发给服务端的换 token 请求体。
type recordedExchange struct {
	mu      sync.Mutex
	payload map[string]any
}

func (r *recordedExchange) record(t *testing.T, req *http.Request) {
	t.Helper()
	body, err := io.ReadAll(req.Body)
	if err != nil {
		t.Errorf("read exchange body: %v", err)
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.payload = map[string]any{}
	if err := json.Unmarshal(body, &r.payload); err != nil {
		t.Errorf("decode exchange body: %v", err)
	}
}

func (r *recordedExchange) get() map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.payload
}

// stubOAuthBrowser 拦截 openBrowser，校验授权 URL 并模拟浏览器跳转回调。
func stubOAuthBrowser(t *testing.T, check func(authURL *url.URL, query url.Values), callbackQuery func(query url.Values) url.Values) {
	t.Helper()
	origOpen := openBrowser
	origSave := savePlatformToken
	t.Cleanup(func() { openBrowser = origOpen; savePlatformToken = origSave })

	openBrowser = func(rawURL string) error {
		u, err := url.Parse(rawURL)
		if err != nil {
			return err
		}
		q := u.Query()
		check(u, q)
		redirect, err := url.Parse(q.Get("redirect_uri"))
		if err != nil {
			return err
		}
		callbackURL := redirect.Scheme + "://" + redirect.Host + "/callback?" + callbackQuery(q).Encode()
		go func() {
			resp, err := http.Get(callbackURL)
			if err == nil {
				_, _ = io.ReadAll(resp.Body)
				_ = resp.Body.Close()
			}
		}()
		return nil
	}
	savePlatformToken = func(token string) error { return nil }
}

func TestFetchOAuthProviders(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/oauth/providers" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"providers":[{"name":"google","client_id":"g-cid"}]}`))
	}))
	defer ts.Close()
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	svc := &Service{}
	providers, err := svc.FetchOAuthProviders()
	if err != nil {
		t.Fatalf("FetchOAuthProviders() error: %v", err)
	}
	if len(providers) != 1 || providers[0].Name != "google" || providers[0].ClientID != "g-cid" {
		t.Fatalf("unexpected providers: %+v", providers)
	}
}

func TestFetchOAuthProviders_ServerError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"oauth is not enabled"}`))
	}))
	defer ts.Close()
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	svc := &Service{}
	if _, err := svc.FetchOAuthProviders(); err == nil || err.Error() != "oauth is not enabled" {
		t.Fatalf("expected server error passthrough, got %v", err)
	}
}

func TestStartOAuthLogin_Google(t *testing.T) {
	ts, rec := startOAuthPlatformStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"fake-jwt-token-123","refresh_token":"r-1","expires_in":86400}`))
	})
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	stubOAuthBrowser(t,
		func(authURL *url.URL, q url.Values) {
			if authURL.Host != "accounts.google.com" {
				t.Errorf("unexpected authorize host: %s", authURL.Host)
			}
			if q.Get("client_id") != "g-cid" {
				t.Errorf("unexpected client_id: %q", q.Get("client_id"))
			}
			if q.Get("response_type") != "code" {
				t.Errorf("unexpected response_type: %q", q.Get("response_type"))
			}
			if q.Get("scope") != "openid email profile" {
				t.Errorf("unexpected scope: %q", q.Get("scope"))
			}
			if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" {
				t.Errorf("expected PKCE S256, got method=%q challenge=%q", q.Get("code_challenge_method"), q.Get("code_challenge"))
			}
			if q.Get("state") == "" {
				t.Error("expected non-empty state")
			}
			if q.Get("redirect_uri") == "" {
				t.Error("expected non-empty redirect_uri")
			}
		},
		func(q url.Values) url.Values {
			return url.Values{"code": {"the-code"}, "state": {q.Get("state")}}
		},
	)

	svc := &Service{}
	if err := svc.StartOAuthLogin("google"); err != nil {
		t.Fatalf("StartOAuthLogin() error: %v", err)
	}
	if !svc.IsLoggedIn() {
		t.Fatal("expected logged in after oauth flow")
	}
	if svc.GetPlatformToken() != "fake-jwt-token-123" {
		t.Fatalf("unexpected token: %q", svc.GetPlatformToken())
	}

	payload := rec.get()
	if payload["code"] != "the-code" {
		t.Errorf("unexpected exchanged code: %v", payload["code"])
	}
	if payload["code_verifier"] == "" {
		t.Error("expected code_verifier in exchange payload for google")
	}
	if payload["redirect_uri"] == "" {
		t.Error("expected redirect_uri in exchange payload")
	}
}

func TestStartOAuthLogin_GitHub(t *testing.T) {
	ts, rec := startOAuthPlatformStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"gh-jwt-456","refresh_token":"r-2","expires_in":86400}`))
	})
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	stubOAuthBrowser(t,
		func(authURL *url.URL, q url.Values) {
			if authURL.Host != "github.com" {
				t.Errorf("unexpected authorize host: %s", authURL.Host)
			}
			if q.Get("client_id") != "h-cid" {
				t.Errorf("unexpected client_id: %q", q.Get("client_id"))
			}
			if q.Get("scope") != "read:user user:email" {
				t.Errorf("unexpected scope: %q", q.Get("scope"))
			}
		},
		func(q url.Values) url.Values {
			return url.Values{"code": {"gh-code"}, "state": {q.Get("state")}}
		},
	)

	svc := &Service{}
	if err := svc.StartOAuthLogin("github"); err != nil {
		t.Fatalf("StartOAuthLogin() error: %v", err)
	}
	if svc.GetPlatformToken() != "gh-jwt-456" {
		t.Fatalf("unexpected token: %q", svc.GetPlatformToken())
	}

	payload := rec.get()
	if payload["code"] != "gh-code" {
		t.Errorf("unexpected exchanged code: %v", payload["code"])
	}
	if _, ok := payload["code_verifier"]; ok {
		t.Error("github oauth app does not use PKCE, unexpected code_verifier")
	}
}

func TestStartOAuthLogin_UnsupportedProvider(t *testing.T) {
	svc := &Service{}
	if err := svc.StartOAuthLogin("microsoft"); err == nil {
		t.Fatal("expected error for unsupported provider")
	}
}

func TestStartOAuthLogin_ProviderNotConfigured(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"providers":[]}`))
	}))
	defer ts.Close()
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	svc := &Service{}
	if err := svc.StartOAuthLogin("google"); err == nil {
		t.Fatal("expected error when provider not configured on server")
	}
}

func TestStartOAuthLogin_StateMismatch(t *testing.T) {
	ts, _ := startOAuthPlatformStub(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("token exchange should not happen on state mismatch")
	})
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	stubOAuthBrowser(t,
		func(authURL *url.URL, q url.Values) {},
		func(q url.Values) url.Values {
			return url.Values{"code": {"the-code"}, "state": {"tampered-state"}}
		},
	)

	svc := &Service{}
	if err := svc.StartOAuthLogin("google"); err == nil || err.Error() != "oauth state mismatch" {
		t.Fatalf("expected state mismatch error, got %v", err)
	}
}

func TestStartOAuthLogin_UserDenied(t *testing.T) {
	ts, _ := startOAuthPlatformStub(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("token exchange should not happen when user denies")
	})
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	stubOAuthBrowser(t,
		func(authURL *url.URL, q url.Values) {},
		func(q url.Values) url.Values {
			return url.Values{"error": {"access_denied"}}
		},
	)

	svc := &Service{}
	if err := svc.StartOAuthLogin("google"); err == nil {
		t.Fatal("expected error when user denies authorization")
	}
}

func TestStartOAuthLogin_ExchangeError(t *testing.T) {
	ts, _ := startOAuthPlatformStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"第三方授权失败，请重试"}`))
	})
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	stubOAuthBrowser(t,
		func(authURL *url.URL, q url.Values) {},
		func(q url.Values) url.Values {
			return url.Values{"code": {"the-code"}, "state": {q.Get("state")}}
		},
	)

	svc := &Service{}
	err := svc.StartOAuthLogin("google")
	if err == nil {
		t.Fatal("expected error when server rejects exchange")
	}
	if err.Error() != "第三方授权失败，请重试" {
		t.Errorf("expected server error passthrough, got %q", err.Error())
	}
	if svc.IsLoggedIn() {
		t.Error("expected not logged in after failed exchange")
	}
}

func TestStartOAuthLogin_ServerErrorPassthrough(t *testing.T) {
	// 验证 providers 端点失败时直接透传（i18n 文案由服务端下发）。
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"error":"internal"}`)
	}))
	defer ts.Close()
	t.Setenv("PLATFORM_API_BASE_URL", ts.URL)

	svc := &Service{}
	if err := svc.StartOAuthLogin("google"); err == nil {
		t.Fatal("expected error when providers fetch fails")
	}
}
