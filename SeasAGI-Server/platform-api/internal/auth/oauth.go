package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/SeasAGI/SeasAGI-Server/platform-api/internal/database"
	"github.com/SeasAGI/SeasAGI-Server/platform-api/internal/i18n"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// oauthProviderConfig 描述一个 OAuth 提供方的端点与凭证（凭证只保存在服务端）。
type oauthProviderConfig struct {
	Name         string
	ClientID     string
	ClientSecret string
	TokenURL     string
	UserInfoURL  string
	EmailsURL    string // 仅 GitHub 需要（用户主邮箱兜底）
}

// OAuthProviderInfo 下发给客户端的 provider 概要（不含密钥）。
type OAuthProviderInfo struct {
	Name     string `json:"name"`
	ClientID string `json:"client_id"`
}

// OAuthExchangeRequest 客户端用授权码换取平台 JWT 的请求体。
type OAuthExchangeRequest struct {
	Code         string `json:"code" binding:"required"`
	RedirectURI  string `json:"redirect_uri" binding:"required"`
	CodeVerifier string `json:"code_verifier"`
}

type oauthUserInfo struct {
	ProviderUserID string
	Email          string
}

const oauthHTTPTimeout = 15 * time.Second

// GetOAuthProviders 返回服务端已配置的第三方登录方式（供客户端动态渲染按钮）。
func GetOAuthProviders(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"providers": listConfiguredProviders()})
}

// ExchangeOAuthToken 用第三方授权码换取平台 JWT。
// 流程：code -> provider access_token -> userinfo -> 落库/绑定账号 -> 签发平台 JWT。
func ExchangeOAuthToken(c *gin.Context) {
	cfg, ok := resolveProvider(c.Param("provider"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": i18n.TFromContext(c, "auth.oauthUnsupportedProvider")})
		return
	}
	if cfg.ClientID == "" || cfg.ClientSecret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": i18n.TFromContext(c, "auth.oauthUnavailable")})
		return
	}

	var req OAuthExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	providerToken, err := exchangeAuthorizationCode(cfg, req.Code, req.RedirectURI, req.CodeVerifier)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.TFromContext(c, "auth.oauthExchangeFailed")})
		return
	}

	info, err := fetchUserInfo(cfg, providerToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": i18n.TFromContext(c, "auth.oauthUserInfoFailed")})
		return
	}

	userID, err := findOrCreateUserByIdentity(cfg.Name, info.ProviderUserID, info.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.TFromContext(c, "auth.tokenGenerationFailed")})
		return
	}

	accessToken, err := generateAccessToken(userID, info.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.TFromContext(c, "auth.tokenGenerationFailed")})
		return
	}

	refreshToken, err := generateRefreshToken(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": i18n.TFromContext(c, "auth.tokenGenerationFailed")})
		return
	}

	c.JSON(http.StatusOK, TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    86400,
	})
}

// resolveProvider 根据名称返回 provider 配置与凭证（来自环境变量）。
func resolveProvider(name string) (*oauthProviderConfig, bool) {
	switch strings.ToLower(name) {
	case "google":
		return &oauthProviderConfig{
			Name:         "google",
			ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
			TokenURL:     "https://oauth2.googleapis.com/token",
			UserInfoURL:  "https://www.googleapis.com/oauth2/v3/userinfo",
		}, true
	case "github":
		return &oauthProviderConfig{
			Name:         "github",
			ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
			ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
			TokenURL:     "https://github.com/login/oauth/access_token",
			UserInfoURL:  "https://api.github.com/user",
			EmailsURL:    "https://api.github.com/user/emails",
		}, true
	}
	return nil, false
}

// listConfiguredProviders 返回 client_id 与 client_secret 均已配置的 provider。
func listConfiguredProviders() []OAuthProviderInfo {
	providers := []OAuthProviderInfo{}
	for _, name := range []string{"google", "github"} {
		if cfg, ok := resolveProvider(name); ok && cfg.ClientID != "" && cfg.ClientSecret != "" {
			providers = append(providers, OAuthProviderInfo{Name: cfg.Name, ClientID: cfg.ClientID})
		}
	}
	return providers
}

// exchangeAuthorizationCode 用授权码向 provider 换取 access_token。
func exchangeAuthorizationCode(cfg *oauthProviderConfig, code, redirectURI, codeVerifier string) (string, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {cfg.ClientID},
		"client_secret": {cfg.ClientSecret},
	}
	if codeVerifier != "" {
		form.Set("code_verifier", codeVerifier)
	}

	httpReq, err := http.NewRequest(http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpReq.Header.Set("Accept", "application/json")

	httpClient := &http.Client{Timeout: oauthHTTPTimeout}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint returned %d", resp.StatusCode)
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", err
	}
	if tokenResp.AccessToken == "" {
		return "", fmt.Errorf("empty access token")
	}
	return tokenResp.AccessToken, nil
}

// fetchUserInfo 拉取 provider 用户信息，返回稳定的 provider_user_id 与邮箱。
func fetchUserInfo(cfg *oauthProviderConfig, accessToken string) (*oauthUserInfo, error) {
	body, err := oauthGetJSON(cfg.UserInfoURL, accessToken)
	if err != nil {
		return nil, err
	}

	info := &oauthUserInfo{}
	switch cfg.Name {
	case "google":
		var payload struct {
			Sub   string `json:"sub"`
			Email string `json:"email"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return nil, err
		}
		if payload.Sub == "" {
			return nil, fmt.Errorf("missing sub")
		}
		info.ProviderUserID = payload.Sub
		info.Email = payload.Email
	case "github":
		var payload struct {
			ID    int64  `json:"id"`
			Email string `json:"email"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return nil, err
		}
		if payload.ID == 0 {
			return nil, fmt.Errorf("missing id")
		}
		info.ProviderUserID = strconv.FormatInt(payload.ID, 10)
		info.Email = payload.Email
		if info.Email == "" {
			email, err := fetchGitHubPrimaryEmail(cfg, accessToken)
			if err != nil {
				return nil, err
			}
			info.Email = email
		}
	default:
		return nil, fmt.Errorf("unsupported provider")
	}

	if info.Email == "" {
		return nil, fmt.Errorf("email is required")
	}
	return info, nil
}

// fetchGitHubPrimaryEmail 从 /user/emails 兜底获取主邮箱。
func fetchGitHubPrimaryEmail(cfg *oauthProviderConfig, accessToken string) (string, error) {
	body, err := oauthGetJSON(cfg.EmailsURL, accessToken)
	if err != nil {
		return "", err
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := json.Unmarshal(body, &emails); err != nil {
		return "", err
	}
	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email, nil
		}
	}
	return "", fmt.Errorf("no verified email")
}

func oauthGetJSON(endpoint, accessToken string) ([]byte, error) {
	httpReq, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+accessToken)
	httpReq.Header.Set("Accept", "application/json")

	httpClient := &http.Client{Timeout: oauthHTTPTimeout}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo endpoint returned %d", resp.StatusCode)
	}
	return body, nil
}

// findOrCreateUserByIdentity 按 identity 复用 -> email 绑定 -> 新建用户的顺序解析平台账号。
func findOrCreateUserByIdentity(provider, providerUserID, email string) (string, error) {
	if database.DB == nil {
		return "", fmt.Errorf("database not initialized")
	}
	if providerUserID == "" || email == "" {
		return "", fmt.Errorf("provider user id and email are required")
	}
	email = strings.ToLower(email)

	var userID string
	err := database.DB.QueryRow(
		`SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?`,
		provider, providerUserID,
	).Scan(&userID)
	if err == nil {
		return userID, nil
	}

	// 已有同邮箱的平台账号则绑定 identity，不新建。
	err = database.DB.QueryRow(`SELECT user_id FROM users WHERE email = ?`, email).Scan(&userID)
	if err == nil {
		if _, err := database.DB.Exec(
			`INSERT INTO oauth_identities (user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?)`,
			userID, provider, providerUserID, email,
		); err != nil {
			return "", fmt.Errorf("bind identity failed: %w", err)
		}
		return userID, nil
	}

	// 新用户：随机占位密码（无法用密码登录，只能走 OAuth）。
	newUserID := fmt.Sprintf("user_%d", time.Now().UnixNano())
	placeholder, err := randomHex(32)
	if err != nil {
		return "", err
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(placeholder), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	if _, err := database.DB.Exec(
		`INSERT INTO users (user_id, email, hashed_password) VALUES (?, ?, ?)`,
		newUserID, email, string(hashed),
	); err != nil {
		return "", fmt.Errorf("create user failed: %w", err)
	}
	if _, err := database.DB.Exec(
		`INSERT INTO oauth_identities (user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?)`,
		newUserID, provider, providerUserID, email,
	); err != nil {
		return "", fmt.Errorf("create identity failed: %w", err)
	}
	return newUserID, nil
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
