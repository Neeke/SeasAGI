package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"time"

	"github.com/SeasAGI/SeasAGI-Client/internal/keychain"
)

// OAuthProvider 服务端已配置的第三方登录方式。
type OAuthProvider struct {
	Name     string `json:"name"`
	ClientID string `json:"client_id"`
}

const (
	oauthCallbackTimeout = 5 * time.Minute

	googleAuthorizeURL = "https://accounts.google.com/o/oauth2/v2/auth"
	githubAuthorizeURL = "https://github.com/login/oauth/authorize"
)

type callbackResult struct {
	Code  string
	State string
	Error string
}

// FetchOAuthProviders 获取服务端已配置的第三方登录方式（用于前端动态渲染按钮）。
func (s *Service) FetchOAuthProviders() ([]OAuthProvider, error) {
	reqCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, platformAPIBaseURL()+"/auth/oauth/providers", nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Providers []OAuthProvider `json:"providers"`
		Error     string          `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		if result.Error == "" {
			result.Error = "fetch oauth providers failed"
		}
		return nil, fmt.Errorf("%s", result.Error)
	}
	return result.Providers, nil
}

// StartOAuthLogin 执行完整的第三方 OAuth 登录流程：
// 浏览器授权 -> 本地回调服务器接收 code -> 服务端换取平台 JWT -> 持久化登录态。
func (s *Service) StartOAuthLogin(providerName string) error {
	if providerName != "google" && providerName != "github" {
		return fmt.Errorf("unsupported oauth provider: %s", providerName)
	}

	s.mu.Lock()
	if s.oauthRunning {
		s.mu.Unlock()
		return fmt.Errorf("oauth login already in progress")
	}
	s.oauthRunning = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.oauthRunning = false
		s.mu.Unlock()
	}()

	providers, err := s.FetchOAuthProviders()
	if err != nil {
		return fmt.Errorf("fetch oauth providers: %w", err)
	}
	var clientID string
	for _, p := range providers {
		if p.Name == providerName {
			clientID = p.ClientID
		}
	}
	if clientID == "" {
		return fmt.Errorf("oauth provider %s is not configured on server", providerName)
	}

	// state 防 CSRF；Google 走 PKCE（GitHub OAuth App 暂不支持）。
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return err
	}
	state := base64.RawURLEncoding.EncodeToString(stateBytes)

	var codeVerifier, codeChallenge string
	if providerName == "google" {
		verifierBytes := make([]byte, 32)
		if _, err := rand.Read(verifierBytes); err != nil {
			return err
		}
		codeVerifier = base64.RawURLEncoding.EncodeToString(verifierBytes)
		sum := sha256.Sum256([]byte(codeVerifier))
		codeChallenge = base64.RawURLEncoding.EncodeToString(sum[:])
	}

	// 本地回调服务器：随机端口，仅监听回环地址。
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("start oauth callback server: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	callbackCh := make(chan callbackResult, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		res := callbackResult{Code: q.Get("code"), State: q.Get("state"), Error: q.Get("error")}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if res.Code != "" && res.Error == "" {
			_, _ = io.WriteString(w, oauthSuccessHTML)
		} else {
			_, _ = io.WriteString(w, oauthFailureHTML)
		}
		select {
		case callbackCh <- res:
		default:
		}
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	defer func() { _ = srv.Close() }()

	authorizeParams := url.Values{
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"state":         {state},
	}
	switch providerName {
	case "google":
		authorizeParams.Set("scope", "openid email profile")
		if codeChallenge != "" {
			authorizeParams.Set("code_challenge", codeChallenge)
			authorizeParams.Set("code_challenge_method", "S256")
		}
	case "github":
		authorizeParams.Set("scope", "read:user user:email")
	}

	var authorizeURL string
	if providerName == "google" {
		authorizeURL = googleAuthorizeURL + "?" + authorizeParams.Encode()
	} else {
		authorizeURL = githubAuthorizeURL + "?" + authorizeParams.Encode()
	}

	if err := openBrowser(authorizeURL); err != nil {
		return fmt.Errorf("open browser: %w", err)
	}

	var cb callbackResult
	select {
	case cb = <-callbackCh:
	case <-time.After(oauthCallbackTimeout):
		return fmt.Errorf("oauth login timed out")
	}

	if cb.Error != "" {
		return fmt.Errorf("oauth authorization failed: %s", cb.Error)
	}
	if cb.Code == "" {
		return fmt.Errorf("oauth callback missing code")
	}
	if cb.State != state {
		return fmt.Errorf("oauth state mismatch")
	}

	token, err := s.exchangeOAuthCode(providerName, cb.Code, redirectURI, codeVerifier)
	if err != nil {
		return err
	}

	userID := s.extractUserID(token)
	s.mu.Lock()
	s.info = AuthInfo{
		IsLoggedIn: true,
		UserID:     &userID,
	}
	s.token = token
	s.mu.Unlock()
	_ = savePlatformToken(token)

	return nil
}

// savePlatformToken / openBrowser 抽为包级变量，便于单元测试替换。
var savePlatformToken = keychain.SavePlatformToken

var openBrowser = func(rawURL string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", rawURL).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL).Start()
	default:
		return exec.Command("xdg-open", rawURL).Start()
	}
}

// exchangeOAuthCode 将授权码交给服务端换取平台 JWT。
func (s *Service) exchangeOAuthCode(provider, code, redirectURI, codeVerifier string) (string, error) {
	payload := map[string]string{
		"code":         code,
		"redirect_uri": redirectURI,
	}
	if codeVerifier != "" {
		payload["code_verifier"] = codeVerifier
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, platformAPIBaseURL()+"/auth/oauth/"+provider+"/token", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		if result.Error == "" {
			result.Error = "oauth token exchange failed"
		}
		return "", fmt.Errorf("%s", result.Error)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("platform returned empty access token")
	}
	return result.AccessToken, nil
}

const oauthSuccessHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SeasAGI</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f7fa;color:#1a1a2e}div{text-align:center}h1{font-size:20px;margin-bottom:8px}p{color:#6b7280}</style></head><body><div><h1>登录成功</h1><p>请返回 SeasAGI 桌面应用继续</p></div></body></html>`

const oauthFailureHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SeasAGI</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f7fa;color:#1a1a2e}div{text-align:center}h1{font-size:20px;margin-bottom:8px}p{color:#6b7280}</style></head><body><div><h1>登录失败</h1><p>请返回 SeasAGI 桌面应用后重试</p></div></body></html>`
