package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/SeasAGI/SeasAGI-Client/internal/keychain"
)

type AuthInfo struct {
	IsLoggedIn bool    `json:"is_logged_in"`
	UserID     *string `json:"user_id"`
	Email      *string `json:"email"`
}

type Service struct {
	mu    sync.RWMutex
	info  AuthInfo
	token string
}

func NewService() *Service {
	token, _ := keychain.GetPlatformToken()
	svc := &Service{
		info:  AuthInfo{IsLoggedIn: false},
		token: token,
	}
	if token != "" {
		userID := svc.extractUserID(token)
		svc.info = AuthInfo{
			IsLoggedIn: true,
			UserID:     &userID,
		}
	}
	return svc
}

func (s *Service) Login(email, password string) error {
	token, err := s.callPlatformLogin(email, password)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	userID := s.extractUserID(token)
	s.info = AuthInfo{
		IsLoggedIn: true,
		UserID:     &userID,
		Email:      &email,
	}
	s.token = token
	_ = keychain.SavePlatformToken(token)

	return nil
}

func (s *Service) Logout() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.info = AuthInfo{IsLoggedIn: false}
	s.token = ""
	_ = keychain.ClearPlatformToken()
	return nil
}

func (s *Service) GetAuthState() AuthInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.info
}

func (s *Service) IsLoggedIn() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.info.IsLoggedIn
}

func (s *Service) GetPlatformToken() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.token
}

func (s *Service) callPlatformLogin(email, password string) (string, error) {
	payload, err := json.Marshal(map[string]string{
		"email":    email,
		"password": password,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, platformAPIBaseURL()+"/auth/login", bytes.NewReader(payload))
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
			result.Error = "platform login failed"
		}
		return "", errors.New(result.Error)
	}
	if result.AccessToken == "" {
		return "", errors.New("platform returned empty access token")
	}
	return result.AccessToken, nil
}

func (s *Service) extractUserID(token string) string {
	if token == "" {
		return ""
	}
	if len(token) <= 8 {
		return token
	}
	return token[:8]
}

func (s *Service) FetchPlatformChannels(ctx context.Context) ([]map[string]interface{}, error) {
	if !s.IsLoggedIn() {
		return nil, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, platformAPIBaseURL()+"/channels", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.GetPlatformToken())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Data  []map[string]interface{} `json:"data"`
		Error string                   `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		if result.Error == "" {
			result.Error = "fetch platform channels failed"
		}
		return nil, errors.New(result.Error)
	}
	return result.Data, nil
}

// FetchFreeChannels 从平台 API 拉取免费通道种子列表。
func (s *Service) FetchFreeChannels(ctx context.Context) ([]map[string]interface{}, error) {
	if !s.IsLoggedIn() {
		return nil, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	reqCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, platformAPIBaseURL()+"/free-channels", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.GetPlatformToken())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Data  []map[string]interface{} `json:"data"`
		Error string                   `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		if result.Error == "" {
			result.Error = "fetch free channels failed"
		}
		return nil, errors.New(result.Error)
	}
	return result.Data, nil
}

func (s *Service) PlatformAPIBaseURL() string {
	return platformAPIBaseURL()
}

func platformAPIBaseURL() string {
	if value := os.Getenv("PLATFORM_API_BASE_URL"); value != "" {
		return value
	}
	if value := getConfiguredBaseURL(); value != "" {
		return value
	}
	return "https://seasagi.seasx.ai/api/v1"
}
