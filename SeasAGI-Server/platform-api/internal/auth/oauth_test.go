package auth

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SeasAGI/SeasAGI-Server/platform-api/internal/database"
)

func TestOAuthProviderInfoJSON(t *testing.T) {
	info := OAuthProviderInfo{Name: "google", ClientID: "cid-123"}
	data, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var got OAuthProviderInfo
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if got.Name != "google" || got.ClientID != "cid-123" {
		t.Fatalf("unexpected round-trip result: %+v", got)
	}
	if string(data) != `{"name":"google","client_id":"cid-123"}` {
		t.Fatalf("unexpected JSON: %s", data)
	}
}

func TestOAuthExchangeRequestJSON(t *testing.T) {
	req := OAuthExchangeRequest{Code: "abc", RedirectURI: "http://127.0.0.1:55331/callback", CodeVerifier: "v"}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var got OAuthExchangeRequest
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if got.Code != "abc" || got.RedirectURI != "http://127.0.0.1:55331/callback" || got.CodeVerifier != "v" {
		t.Fatalf("unexpected round-trip result: %+v", got)
	}
}

func TestListConfiguredProviders(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "g-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "g-secret")
	t.Setenv("GITHUB_CLIENT_ID", "h-id")
	t.Setenv("GITHUB_CLIENT_SECRET", "h-secret")

	providers := listConfiguredProviders()
	if len(providers) != 2 {
		t.Fatalf("expected 2 providers, got %d: %+v", len(providers), providers)
	}
	if providers[0].Name != "google" || providers[0].ClientID != "g-id" {
		t.Fatalf("unexpected google provider: %+v", providers[0])
	}
	if providers[1].Name != "github" || providers[1].ClientID != "h-id" {
		t.Fatalf("unexpected github provider: %+v", providers[1])
	}

	// 缺少 secret 的 provider 不应下发。
	t.Setenv("GITHUB_CLIENT_SECRET", "")
	providers = listConfiguredProviders()
	if len(providers) != 1 || providers[0].Name != "google" {
		t.Fatalf("expected only google, got %+v", providers)
	}
}

func TestExchangeAuthorizationCode(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Accept") != "application/json" {
			t.Errorf("expected Accept: application/json, got %q", r.Header.Get("Accept"))
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form failed: %v", err)
		}
		if r.Form.Get("code") != "auth-code" {
			t.Errorf("unexpected code: %q", r.Form.Get("code"))
		}
		if r.Form.Get("redirect_uri") != "http://127.0.0.1:55331/callback" {
			t.Errorf("unexpected redirect_uri: %q", r.Form.Get("redirect_uri"))
		}
		if r.Form.Get("code_verifier") != "verifier-1" {
			t.Errorf("unexpected code_verifier: %q", r.Form.Get("code_verifier"))
		}
		if r.Form.Get("client_id") != "cid" || r.Form.Get("client_secret") != "csecret" {
			t.Errorf("unexpected client credentials: %q/%q", r.Form.Get("client_id"), r.Form.Get("client_secret"))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "provider-token"})
	}))
	defer ts.Close()

	cfg := &oauthProviderConfig{Name: "google", ClientID: "cid", ClientSecret: "csecret", TokenURL: ts.URL}
	token, err := exchangeAuthorizationCode(cfg, "auth-code", "http://127.0.0.1:55331/callback", "verifier-1")
	if err != nil {
		t.Fatalf("exchange failed: %v", err)
	}
	if token != "provider-token" {
		t.Fatalf("unexpected token: %q", token)
	}
}

func TestExchangeAuthorizationCodeError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
	}))
	defer ts.Close()

	cfg := &oauthProviderConfig{Name: "google", ClientID: "cid", ClientSecret: "csecret", TokenURL: ts.URL}
	if _, err := exchangeAuthorizationCode(cfg, "bad", "http://127.0.0.1:55331/callback", ""); err == nil {
		t.Fatal("expected error for non-200 token response")
	}
}

func TestFetchUserInfoGoogle(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer g-token" {
			t.Errorf("unexpected Authorization: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sub":"sub-42","email":"User@Example.com","email_verified":true}`))
	}))
	defer ts.Close()

	cfg := &oauthProviderConfig{Name: "google", UserInfoURL: ts.URL}
	info, err := fetchUserInfo(cfg, "g-token")
	if err != nil {
		t.Fatalf("fetch user info failed: %v", err)
	}
	if info.ProviderUserID != "sub-42" || info.Email != "User@Example.com" {
		t.Fatalf("unexpected info: %+v", info)
	}
}

func TestFetchUserInfoGitHubEmailFallback(t *testing.T) {
	userTS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":9001,"login":"octo","email":null}`))
	}))
	defer userTS.Close()

	emailTS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"email":"private@x.com","primary":false,"verified":true},{"email":"main@x.com","primary":true,"verified":true}]`))
	}))
	defer emailTS.Close()

	cfg := &oauthProviderConfig{Name: "github", UserInfoURL: userTS.URL, EmailsURL: emailTS.URL}
	info, err := fetchUserInfo(cfg, "h-token")
	if err != nil {
		t.Fatalf("fetch user info failed: %v", err)
	}
	if info.ProviderUserID != "9001" {
		t.Fatalf("unexpected provider user id: %q", info.ProviderUserID)
	}
	if info.Email != "main@x.com" {
		t.Fatalf("expected primary verified email, got %q", info.Email)
	}
}

func TestFetchUserInfoMissingEmail(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sub":"sub-1"}`))
	}))
	defer ts.Close()

	cfg := &oauthProviderConfig{Name: "google", UserInfoURL: ts.URL}
	if _, err := fetchUserInfo(cfg, "g-token"); err == nil {
		t.Fatal("expected error when email missing")
	}
}

// openTestDB 打开内存 SQLite 并建立 OAuth 相关最小表结构。
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	for _, driverName := range []string{"sqlite", "sqlite3"} {
		db, err := sql.Open(driverName, ":memory:")
		if err != nil {
			continue
		}
		if _, err := db.Exec(`
			CREATE TABLE users (
				user_id TEXT PRIMARY KEY,
				email TEXT UNIQUE NOT NULL,
				hashed_password TEXT NOT NULL
			);
			CREATE TABLE oauth_identities (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				provider_user_id TEXT NOT NULL,
				email TEXT NOT NULL DEFAULT '',
				UNIQUE(provider, provider_user_id)
			);
		`); err == nil {
			return db
		}
		db.Close()
	}
	t.Skip("no sqlite driver available for tests")
	return nil
}

func TestFindOrCreateUserByIdentity(t *testing.T) {
	db := openTestDB(t)
	defer db.Close()
	prev := database.DB
	database.DB = db
	defer func() { database.DB = prev }()

	// 1. 新建用户。
	userID1, err := findOrCreateUserByIdentity("google", "sub-1", "Alice@Example.com")
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}
	if userID1 == "" {
		t.Fatal("expected non-empty user id")
	}
	var email, hashed string
	if err := db.QueryRow(`SELECT email, hashed_password FROM users WHERE user_id = ?`, userID1).Scan(&email, &hashed); err != nil {
		t.Fatalf("user not persisted: %v", err)
	}
	if email != "alice@example.com" {
		t.Fatalf("expected lowercased email, got %q", email)
	}
	if hashed == "" {
		t.Fatal("expected non-empty placeholder hashed_password")
	}

	// 2. 同 identity 再次登录复用账号。
	userID2, err := findOrCreateUserByIdentity("google", "sub-1", "alice@example.com")
	if err != nil {
		t.Fatalf("reuse failed: %v", err)
	}
	if userID2 != userID1 {
		t.Fatalf("expected identity reuse, got %s vs %s", userID1, userID2)
	}

	// 3. 同邮箱不同 identity -> 绑定已有账号。
	userID3, err := findOrCreateUserByIdentity("github", "9001", "alice@example.com")
	if err != nil {
		t.Fatalf("bind failed: %v", err)
	}
	if userID3 != userID1 {
		t.Fatalf("expected email binding to existing user, got %s vs %s", userID1, userID3)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		t.Fatalf("count users failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 user after binding, got %d", count)
	}

	// 4. 新邮箱新 identity -> 再建一个用户。
	if _, err := findOrCreateUserByIdentity("github", "9002", "bob@example.com"); err != nil {
		t.Fatalf("second create failed: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		t.Fatalf("count users failed: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 users, got %d", count)
	}
}
