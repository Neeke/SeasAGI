package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	stdsync "sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"seasagi/internal/auth"
	"seasagi/internal/config"
	"seasagi/internal/configio"
	"seasagi/internal/deeplink"
	"seasagi/internal/discovery"
	"seasagi/internal/gateway"
	"seasagi/internal/keychain"
	"seasagi/internal/localtoken"
	"seasagi/internal/logs"
	"seasagi/internal/mcp"
	"seasagi/internal/network"
	"seasagi/internal/oauth"
	"seasagi/internal/optimizer"
	"seasagi/internal/presets"
	"seasagi/internal/prompts"
	"seasagi/internal/sessions"
	"seasagi/internal/skills"
	"seasagi/internal/sync"
	"seasagi/internal/tunnel"
	"seasagi/internal/updater"
	"seasagi/internal/usage"
)

func mustHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "/tmp"
	}
	return home
}

type App struct {
	ctx             context.Context
	authSvc         *auth.Service
	configSvc       *config.Service
	gatewaySvc      *gateway.Service
	logSvc          *logs.Service
	discoverySvc    *discovery.Service
	tunnelMgr       *tunnel.Manager
	oauthStore      *oauth.TokenStore
	oauthRefresh    *oauth.AutoRefresher
	mcpSvc          *mcp.Service
	promptsSvc      *prompts.Service
	skillsSvc       *skills.Service
	usageSvc        *usage.Service
	optimizerSvc    *optimizer.Service
	deeplinkMgr     *deeplink.Manager
	presetsSvc      *presets.Service
	syncMgr         *sync.Manager
	sessionsSvc     *sessions.Service
	configioSvc     *configio.Service
	localTokenStore *localtoken.Store
	oauthFlowMu     stdsync.Mutex
	oauthFlows      map[string]*pendingOAuthFlow
}

func NewApp(
	authSvc *auth.Service,
	configSvc *config.Service,
	gatewaySvc *gateway.Service,
	logSvc *logs.Service,
	discoverySvc *discovery.Service,
	mcpSvc *mcp.Service,
	promptsSvc *prompts.Service,
	skillsSvc *skills.Service,
	usageSvc *usage.Service,
	optimizerSvc *optimizer.Service,
	deeplinkMgr *deeplink.Manager,
	presetsSvc *presets.Service,
	syncMgr *sync.Manager,
	sessionsSvc *sessions.Service,
	configioSvc *configio.Service,
	localTokenStore *localtoken.Store,
) *App {
	oauthDir := filepath.Join(mustHomeDir(), ".seasagi", "oauth")
	tokenStore := oauth.NewTokenStore(oauthDir)
	tokenStore.Load()
	autoRefresh := oauth.NewAutoRefresher(tokenStore)

	return &App{
		authSvc:         authSvc,
		configSvc:       configSvc,
		gatewaySvc:      gatewaySvc,
		logSvc:          logSvc,
		discoverySvc:    discoverySvc,
		tunnelMgr:       tunnel.NewManager(4318),
		oauthStore:      tokenStore,
		oauthRefresh:    autoRefresh,
		mcpSvc:          mcpSvc,
		promptsSvc:      promptsSvc,
		skillsSvc:       skillsSvc,
		usageSvc:        usageSvc,
		optimizerSvc:    optimizerSvc,
		deeplinkMgr:     deeplinkMgr,
		presetsSvc:      presetsSvc,
		syncMgr:         syncMgr,
		sessionsSvc:     sessionsSvc,
		configioSvc:     configioSvc,
		localTokenStore: localTokenStore,
		oauthFlows:      make(map[string]*pendingOAuthFlow),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.restoreOAuthProviderConfigs()
	a.oauthRefresh.Start()
	auth.SetPlatformAPIBaseURL(a.configSvc.GetPlatformAPIBaseURL())
}

func (a *App) GetAppInfo() map[string]any {
	return map[string]any{
		"name":    "SeasAGI",
		"version": "0.1.0",
	}
}

func (a *App) SelectDirectory() string {
	result, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Directory",
	})
	if err != nil {
		return ""
	}
	return result
}

func (a *App) CopyToClipboard(text string) {
	runtime.ClipboardSetText(a.ctx, text)
}

func (a *App) ShowMessage(title, message string) {
	_, _ = runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:    runtime.InfoDialog,
		Title:   title,
		Message: message,
	})
}

func (a *App) ConfirmAction(title, message string) bool {
	result, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         title,
		Message:       message,
		Buttons:       []string{"Yes", "No"},
		DefaultButton: "No",
	})
	if err != nil {
		return false
	}
	return result == "Yes"
}

func (a *App) OpenInBrowser(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}

func (a *App) StartLocalGateway() error {
	go a.gatewaySvc.Start(a.ctx)
	return nil
}

func (a *App) StopLocalGateway() error {
	a.gatewaySvc.Stop()
	return nil
}

func (a *App) GetRuntimeStatus() map[string]any {
	cfg := a.configSvc.GetConfig()
	return map[string]any{
		"gateway_running":    a.gatewaySvc.IsRunning(),
		"listen_port":        a.gatewaySvc.GetListenPort(),
		"default_model":      emptyStringToNil(cfg.DefaultModel),
		"default_channel_id": emptyStringToNil(cfg.DefaultChannelID),
	}
}

// GetComboRouteMetrics returns combo-level route metrics from the gateway
func (a *App) GetComboRouteMetrics() []map[string]any {
	metrics := a.gatewaySvc.GetComboRouteMetrics()
	result := make([]map[string]any, 0, len(metrics))
	for _, m := range metrics {
		result = append(result, map[string]any{
			"combo_name":         m.ComboName,
			"total_requests":     m.TotalRequests,
			"total_fallbacks":    m.TotalFallbacks,
			"step1_success":      m.Step1Success,
			"last_step_fallback": m.LastStepFallback,
			"step1_hit_rate":     m.Step1HitRate,
			"last_step_hit_rate": m.LastStepHitRate,
			"avg_attempts":       m.AvgAttempts,
			"task_type":          m.TaskType,
		})
	}
	return result
}

func (a *App) GetProviderHealthMetrics(providerId string) []map[string]any {
	return a.authSvc.FetchProviderHealthMetrics(providerId)
}

func (a *App) GetProviderHealthSummary() []map[string]any {
	return a.authSvc.FetchProviderHealthSummary()
}

func (a *App) GetByokPolicies() []map[string]any {
	return a.authSvc.FetchByokPolicies()
}

func (a *App) SetByokPolicy(policy map[string]any) map[string]any {
	result, _ := a.authSvc.CreateByokPolicy(policy)
	return result
}

func (a *App) GetAppConfig() config.AppConfig {
	return a.configSvc.GetConfig()
}

func (a *App) GetPlatformAPIBaseURL() string {
	return a.configSvc.GetPlatformAPIBaseURL()
}

func (a *App) GetPlatformToken() string {
	return a.authSvc.GetPlatformToken()
}

func (a *App) SetPlatformAPIBaseURL(url string) error {
	if url == "" {
		return fmt.Errorf("platform API base URL cannot be empty")
	}
	if err := a.configSvc.SetPlatformAPIBaseURL(url); err != nil {
		return err
	}
	auth.SetPlatformAPIBaseURL(url)
	return nil
}

func (a *App) SyncPlatformChannels() error {
	if !a.authSvc.IsLoggedIn() {
		return fmt.Errorf("not logged in")
	}
	platformChannels, err := a.authSvc.FetchPlatformChannels(a.ctx)
	if err != nil {
		return err
	}
	return a.configSvc.UpsertPlatformChannels(convertPlatformChannels(platformChannels))
}

func (a *App) CreateCheckoutSession(planID string, quantity ...int) (map[string]any, error) {
	if !a.authSvc.IsLoggedIn() {
		return nil, fmt.Errorf("not logged in")
	}

	qty := 1
	if len(quantity) > 0 && quantity[0] > 1 {
		qty = quantity[0]
	}

	body := map[string]any{"plan_id": planID, "quantity": qty}
	bodyBytes, _ := json.Marshal(body)

	apiBase := a.configSvc.GetPlatformAPIBaseURL()
	reqCtx, cancel := context.WithTimeout(a.ctx, 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, apiBase+"/checkout/create", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.authSvc.GetPlatformToken())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)

	if resp.StatusCode >= 400 {
		errMsg := "create checkout session failed"
		if result != nil {
			if e, ok := result["error"].(string); ok {
				errMsg = e
			}
		}
		return nil, fmt.Errorf(errMsg)
	}
	return result, nil
}

func (a *App) Login(email, password string) error {
	if err := a.authSvc.Login(email, password); err != nil {
		return err
	}

	platformChannels, err := a.authSvc.FetchPlatformChannels(a.ctx)
	if err != nil {
		return err
	}

	if err := a.configSvc.UpsertPlatformChannels(convertPlatformChannels(platformChannels)); err != nil {
		return err
	}

	// Sync local data to cloud (best-effort)
	_ = a.syncLocalDataToCloud()

	if !a.gatewaySvc.IsRunning() {
		go a.gatewaySvc.Start(a.ctx)
	}
	return nil
}

func (a *App) Logout() error {
	a.gatewaySvc.Stop()

	// Sync local data before clearing auth, unless user is not logged in
	if a.authSvc.IsLoggedIn() {
		if err := a.syncLocalDataToCloud(); err != nil {
			// Best-effort: don't block logout
		}
	}

	if err := a.authSvc.Logout(); err != nil {
		return err
	}
	return a.configSvc.ClearPlatformChannels()
}

func (a *App) SyncLocalDataToCloud() error {
	return a.syncLocalDataToCloud()
}

func (a *App) syncLocalDataToCloud() error {
	if !a.authSvc.IsLoggedIn() {
		return fmt.Errorf("not logged in")
	}

	// Sync local custom channels
	channels, _ := a.configSvc.ListChannels()
	var customChannels []map[string]any
	for _, ch := range channels {
		if ch.ChannelType == "custom" {
			customChannels = append(customChannels, map[string]any{
				"channel_id":    ch.ChannelID,
				"display_name":  ch.DisplayName,
				"provider_type": ch.ProviderType,
				"base_url":      ch.BaseURL,
				"channel_type":  ch.ChannelType,
				"models":        ch.Models,
				"enabled":       ch.Enabled,
			})
		}
	}
	if len(customChannels) > 0 {
		_, err := a.SyncCustomChannelsToCloud(customChannels)
		if err != nil {
			return fmt.Errorf("sync channels: %w", err)
		}
	}

	// Sync local combos
	combos := a.configSvc.ListModelCombos()
	for _, combo := range combos {
		stepsJSON, _ := json.Marshal(combo.Steps)
		_, _ = a.PushCloudCombo(combo.LogicalName, combo.DisplayName, combo.Description,
			combo.Strategy, combo.StickyUses, combo.QuickStrategy,
			combo.TaskProfile, string(stepsJSON))
	}

	return nil
}

func (a *App) GetAuthState() auth.AuthInfo {
	return a.authSvc.GetAuthState()
}

func (a *App) ListChannels() ([]config.Channel, error) {
	return a.configSvc.ListChannels()
}

func (a *App) SaveCustomChannel(channel config.Channel) (string, error) {
	if channel.ChannelID == "" {
		channel.ChannelID = fmt.Sprintf("ch_%d", time.Now().UnixNano())
	}
	// Save single APIKey to keychain
	if channel.APIKey != "" {
		if err := keychain.SaveChannelKey(channel.ChannelID, channel.APIKey); err != nil {
			return "", err
		}
	}
	// Save multi-key APIKeys: always persist to config JSON via configSvc
	// If no single key but multi-keys exist, save first key to keychain too
	if channel.APIKey == "" && len(channel.APIKeys) > 0 {
		firstKey := channel.APIKeys[0]
		if firstKey != "" {
			if err := keychain.SaveChannelKey(channel.ChannelID, firstKey); err != nil {
				return "", err
			}
			channel.APIKey = "" // keep single key empty; keychain has it
		}
	}
	return a.configSvc.SaveCustomChannel(channel)
}

func (a *App) DeleteCustomChannel(channelID string) error {
	if err := keychain.DeleteChannelKey(channelID); err != nil {
		return err
	}
	return a.configSvc.DeleteCustomChannel(channelID)
}

func (a *App) ReorderChannels(orderedIDs []string) error {
	return a.configSvc.ReorderChannels(orderedIDs)
}

func (a *App) ExportConfig() (string, error) {
	data, err := a.configioSvc.Export()
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) ImportConfig(jsonStr string) error {
	return a.configioSvc.Import([]byte(jsonStr))
}

func (a *App) TestCustomChannel(channelID string) (map[string]any, error) {
	ch, ok := a.configSvc.GetChannel(channelID)
	if !ok {
		return nil, fmt.Errorf("channel not found")
	}
	return a.testConnectivity(ch, true)
}

func (a *App) TestChannelDirect(channelID string) (map[string]any, error) {
	ch, ok := a.configSvc.GetChannel(channelID)
	if !ok {
		return nil, fmt.Errorf("channel not found")
	}
	return a.testConnectivity(ch, false)
}

// testConnectivity checks whether the channel's API is reachable via a lightweight request.
// When useGateway is true, it sends a minimal request through the local gateway.
// When false, it sends a GET to the channel's models endpoint directly.
func (a *App) testConnectivity(ch config.Channel, useGateway bool) (map[string]any, error) {
	apiKey := ""
	if len(ch.APIKeys) > 0 {
		apiKey = ch.APIKeys[0]
	} else if ch.APIKey != "" {
		apiKey = ch.APIKey
	}

	channelID := ch.ChannelID

	if !useGateway {
		// Direct connectivity check: GET {base_url}/v1/models (or /models as fallback)
		if apiKey == "" {
			return map[string]any{
				"success": false,
				"error":   "no API key configured for this channel",
			}, nil
		}

		baseURL := strings.TrimRight(ch.BaseURL, "/")
		endpoints := []string{baseURL + "/v1/models", baseURL + "/models", baseURL}
		var lastErr string
		for _, url := range endpoints {
			req, err := http.NewRequest(http.MethodGet, url, nil)
			if err != nil {
				continue
			}
			req.Header.Set("Authorization", "Bearer "+apiKey)
			client := &http.Client{Timeout: 8 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				lastErr = fmt.Sprintf("connectivity test failed: %v", err)
				continue
			}
			resp.Body.Close()
			if resp.StatusCode < 500 {
				_ = a.configSvc.UpdateChannelHealth(channelID, "healthy")
				return map[string]any{
					"success":     true,
					"message":     fmt.Sprintf("channel API is reachable (HTTP %d)", resp.StatusCode),
					"status_code": resp.StatusCode,
				}, nil
			}
			lastErr = fmt.Sprintf("server returned status %d", resp.StatusCode)
		}
		_ = a.configSvc.UpdateChannelHealth(channelID, "unhealthy")
		return map[string]any{
			"success": false,
			"error":   lastErr,
		}, nil
	}

	// Via local gateway: send a minimal chat completion to verify the pipeline
	if !a.gatewaySvc.IsRunning() {
		return map[string]any{
			"success": false,
			"error":   "local gateway is not running, start it first",
		}, nil
	}

	if apiKey == "" {
		return map[string]any{
			"success": false,
			"error":   "no API key configured for this channel",
		}, nil
	}

	token, err := a.localTokenStore.GetOrCreate()
	if err != nil {
		return nil, err
	}

	port := a.gatewaySvc.GetListenPort()
	body := map[string]any{
		"model":      "gpt-4o-mini",
		"messages":   []map[string]string{{"role": "user", "content": "hi"}},
		"max_tokens": 1,
		"stream":     false,
	}
	bodyBytes, _ := json.Marshal(body)

	req, err := http.NewRequest(http.MethodPost,
		fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", port),
		bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		_ = a.configSvc.UpdateChannelHealth(channelID, "unhealthy")
		return map[string]any{
			"success": false,
			"error":   fmt.Sprintf("gateway connectivity test failed: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		_ = a.configSvc.UpdateChannelHealth(channelID, "healthy")
		return map[string]any{
			"success":     true,
			"message":     "channel is reachable via local gateway",
			"status_code": resp.StatusCode,
		}, nil
	}

	_ = a.configSvc.UpdateChannelHealth(channelID, "unhealthy")
	return map[string]any{
		"success":     false,
		"error":       fmt.Sprintf("gateway returned HTTP %d", resp.StatusCode),
		"status_code": resp.StatusCode,
	}, nil
}

func (a *App) DiscoverModels(channelID string) ([]discovery.DiscoveredModel, error) {
	return a.discoverySvc.DiscoverModels(channelID)
}

func (a *App) FetchModelsFromURL(modelsURL, apiKey string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(a.ctx, http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch models: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Extract model IDs from OpenAI-compatible response
	var modelNames []string
	if data, ok := result["data"].([]any); ok {
		for _, item := range data {
			if m, ok := item.(map[string]any); ok {
				if id, ok := m["id"].(string); ok {
					modelNames = append(modelNames, id)
				}
			}
		}
	}

	return map[string]any{
		"models": modelNames,
		"total":  len(modelNames),
	}, nil
}

func (a *App) SyncCustomChannelsToCloud(channels []map[string]any) (map[string]any, error) {
	if !a.authSvc.IsLoggedIn() {
		return nil, fmt.Errorf("not logged in")
	}

	baseURL := a.configSvc.GetPlatformAPIBaseURL()
	token := a.authSvc.GetPlatformToken()

	body := map[string]any{"channels": channels}
	bodyBytes, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(a.ctx, http.MethodPost,
		baseURL+"/tenant-admin/channels/sync-custom", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if resp.StatusCode >= 400 {
		errMsg, _ := result["error"].(string)
		return nil, fmt.Errorf("server error (%d): %s", resp.StatusCode, errMsg)
	}

	return result, nil
}

func (a *App) ListLogs(limit, offset int) ([]logs.RequestLog, error) {
	return a.logSvc.ListLogs(limit, offset)
}

func (a *App) ListLogsFiltered(limit, offset int, status, channelID, timeFrom, timeTo, keyword string) ([]logs.RequestLog, error) {
	return a.logSvc.ListLogsFiltered(limit, offset, status, channelID, timeFrom, timeTo, keyword)
}

func (a *App) ClearLogs() error {
	return a.logSvc.ClearLogs()
}

func (a *App) UpdateDefaultModel(modelName, channelID string) error {
	a.configSvc.SetDefaultModel(modelName, channelID)
	return nil
}

func (a *App) GetDefaultComboName() string {
	return a.configSvc.GetDefaultComboName()
}

func (a *App) SetDefaultComboName(name string) error {
	a.configSvc.SetDefaultComboName(name)
	return nil
}

func (a *App) GetComboByName(name string) config.ModelCombo {
	c, ok := a.configSvc.GetModelCombo(name)
	if !ok {
		return config.ModelCombo{}
	}
	return c
}

func (a *App) GetLocalAccessToken() (string, error) {
	return a.localTokenStore.GetOrCreate()
}

func (a *App) ResetLocalAccessToken() (string, error) {
	token, err := a.localTokenStore.Reset()
	if err != nil {
		return "", err
	}
	a.gatewaySvc.SetAccessToken(token)
	return token, nil
}

func (a *App) SetAutoLaunch(enabled bool) error {
	if err := network.SetAutoLaunch(enabled); err != nil {
		return err
	}
	return a.configSvc.SetAutoLaunch(enabled)
}

func (a *App) UpdateRoutingSettings(strategy string, stickyUses int) error {
	return a.configSvc.UpdateRoutingSettings(strategy, stickyUses)
}

func (a *App) ListModelCombos() []config.ModelCombo {
	return a.configSvc.ListModelCombos()
}

func (a *App) SaveModelCombo(combo config.ModelCombo) error {
	return a.configSvc.SaveModelCombo(combo)
}

func (a *App) DeleteModelCombo(name string) error {
	return a.configSvc.DeleteModelCombo(name)
}

func (a *App) ApplyComboSortPreset(comboName string, preset string) error {
	return a.configSvc.ApplyComboSortPreset(comboName, preset)
}

func (a *App) ApplyRecommendation(toModel string, preset string) error {
	if toModel == "" {
		return fmt.Errorf("recommended model is empty")
	}
	presetName := preset
	if presetName == "" {
		presetName = "budget"
	}
	combo := config.ModelCombo{
		Name:        fmt.Sprintf("推荐方案 - %s", toModel),
		Description: fmt.Sprintf("由智能优化引擎推荐，目标模型：%s，排序预设：%s", toModel, presetName),
		Steps:       []config.ModelComboStep{{ChannelID: "", Model: toModel}},
		Strategy:    "fallback",
		StickyUses:  1,
	}
	err := a.configSvc.SaveModelCombo(combo)
	if err != nil {
		return fmt.Errorf("failed to apply recommendation: %w", err)
	}
	return a.configSvc.ApplyComboSortPreset(combo.Name, presetName)
}

// PreviewComboOptimization returns a detailed preview of an optimization recommendation
// without applying it. Returns the recommendation details, estimated impact, and current vs new step comparison.
func (a *App) PreviewComboOptimization(mode string) map[string]any {
	if mode == "" {
		mode = "value_first"
	}
	plan := a.optimizerSvc.GetOptimizationPlan(mode, optimizer.TaskGeneralChat)
	if plan == nil || len(plan.Recommendations) == 0 {
		return map[string]any{
			"has_recommendations": false,
			"message":             "当前暂无优化建议",
		}
	}

	previews := make([]map[string]any, 0, len(plan.Recommendations))
	for _, rec := range plan.Recommendations {
		currentCombo := a.configSvc.FindComboByModel(rec.FromModel)
		currentSteps := make([]map[string]string, 0)
		if currentCombo != nil {
			for _, step := range currentCombo.Steps {
				currentSteps = append(currentSteps, map[string]string{
					"model":   step.Model,
					"channel": step.ChannelID,
				})
			}
		}

		previews = append(previews, map[string]any{
			"from_model":     rec.FromModel,
			"to_model":       rec.ToModel,
			"model_tag":      rec.ModelTag,
			"channel_id":     rec.ChannelID,
			"channel_name":   rec.ChannelName,
			"savings_usd":    rec.SavingsUSD,
			"quality_diff":   rec.QualityDiff,
			"avg_latency_ms": rec.AvgLatencyMs,
			"error_rate":     rec.ErrorRate,
			"reason":         rec.Reason,
			"current_steps":  currentSteps,
			"proposed_steps": []map[string]string{
				{"model": rec.ToModel, "channel": rec.ChannelID},
			},
		})
	}

	return map[string]any{
		"has_recommendations": true,
		"mode":                plan.Mode,
		"strategy":            plan.Strategy,
		"monthly_savings":     plan.MonthlySavings,
		"recommendations":     previews,
	}
}

// ApplyComboOptimization applies a specific optimization recommendation as a new combo.
// If update_existing is true, it updates the existing combo for the from_model instead of creating a new one.
func (a *App) ApplyComboOptimization(toModel string, preset string, updateExisting bool) error {
	if toModel == "" {
		return fmt.Errorf("target model is required")
	}
	presetName := preset
	if presetName == "" {
		presetName = "budget"
	}

	// Try to find existing combo for the from-model if updateExisting is true
	plan := a.optimizerSvc.GetOptimizationPlan("value_first", optimizer.TaskGeneralChat)
	var fromModel string
	if plan != nil {
		for _, rec := range plan.Recommendations {
			if rec.ToModel == toModel {
				fromModel = rec.FromModel
				break
			}
		}
	}

	if updateExisting && fromModel != "" {
		existingCombo := a.configSvc.FindComboByModel(fromModel)
		if existingCombo != nil {
			existingCombo.Steps = []config.ModelComboStep{
				{ChannelID: "", Model: toModel},
			}
			existingCombo.Description = fmt.Sprintf("由智能优化自动更新，新目标模型：%s", toModel)
			if err := a.configSvc.SaveModelCombo(*existingCombo); err != nil {
				return fmt.Errorf("failed to update combo: %w", err)
			}
			return a.configSvc.ApplyComboSortPreset(existingCombo.Name, presetName)
		}
	}

	// Create new combo
	comboName := fmt.Sprintf("优化方案 - %s", toModel)
	combo := config.ModelCombo{
		Name:        comboName,
		Description: fmt.Sprintf("由智能优化引擎生成，目标模型：%s，排序预设：%s", toModel, presetName),
		Steps:       []config.ModelComboStep{{ChannelID: "", Model: toModel}},
		Strategy:    "fallback",
		StickyUses:  1,
	}
	if err := a.configSvc.SaveModelCombo(combo); err != nil {
		return fmt.Errorf("failed to save combo: %w", err)
	}
	return a.configSvc.ApplyComboSortPreset(comboName, presetName)
}

func (a *App) SyncOptimizationConfigToCloud() error {
	cfg := a.configSvc.GetOptimizationConfig()
	raw, err := json.Marshal(map[string]any{
		"config": map[string]any{
			"mode":                 cfg.Mode,
			"penalty_enabled":      cfg.PenaltyEnabled,
			"penalty_decay_sec":    cfg.PenaltyDecaySec,
			"health_check_enabled": cfg.HealthCheckEnabled,
			"health_check_sec":     cfg.HealthCheckSec,
			"health_max_failures":  cfg.HealthMaxFailures,
			"cooldown_enabled":     cfg.CooldownEnabled,
			"cooldown_sec":         cfg.CooldownSec,
			"sticky_enabled":       cfg.StickyEnabled,
			"sticky_ttl_sec":       cfg.StickyTTLSec,
			"preset_enabled":       cfg.PresetEnabled,
			"default_preset":       cfg.DefaultPreset,
		},
	})
	if err != nil {
		return err
	}
	return a.authSvc.PushCloudOptimizationConfig(string(raw))
}

func (a *App) SyncOptimizationConfigFromCloud() map[string]any {
	raw, err := a.authSvc.FetchCloudOptimizationConfig()
	if err != nil || raw == "" {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil
	}
	cfgMap, ok := parsed["config"].(map[string]any)
	if !ok {
		return nil
	}

	local := a.configSvc.GetOptimizationConfig()
	if v, ok := cfgMap["mode"]; ok {
		if s, ok := v.(string); ok && s != "" {
			local.Mode = s
		}
	}
	if v, ok := cfgMap["penalty_enabled"]; ok {
		local.PenaltyEnabled, _ = v.(bool)
	}
	if v, ok := cfgMap["penalty_decay_sec"]; ok {
		local.PenaltyDecaySec, _ = toInt(v)
	}
	if v, ok := cfgMap["health_check_enabled"]; ok {
		local.HealthCheckEnabled, _ = v.(bool)
	}
	if v, ok := cfgMap["health_check_sec"]; ok {
		local.HealthCheckSec, _ = toInt(v)
	}
	if v, ok := cfgMap["health_max_failures"]; ok {
		local.HealthMaxFailures, _ = toInt(v)
	}
	if v, ok := cfgMap["cooldown_enabled"]; ok {
		local.CooldownEnabled, _ = v.(bool)
	}
	if v, ok := cfgMap["cooldown_sec"]; ok {
		local.CooldownSec, _ = toInt(v)
	}
	if v, ok := cfgMap["sticky_enabled"]; ok {
		local.StickyEnabled, _ = v.(bool)
	}
	if v, ok := cfgMap["sticky_ttl_sec"]; ok {
		local.StickyTTLSec, _ = toInt(v)
	}
	if v, ok := cfgMap["preset_enabled"]; ok {
		local.PresetEnabled, _ = v.(bool)
	}
	if v, ok := cfgMap["default_preset"]; ok {
		if s, ok := v.(string); ok && s != "" {
			local.DefaultPreset = s
		}
	}
	_ = a.configSvc.SetOptimizationConfig(local)

	return map[string]any{
		"mode":                 local.Mode,
		"penalty_enabled":      local.PenaltyEnabled,
		"penalty_decay_sec":    local.PenaltyDecaySec,
		"health_check_enabled": local.HealthCheckEnabled,
		"health_check_sec":     local.HealthCheckSec,
		"health_max_failures":  local.HealthMaxFailures,
		"cooldown_enabled":     local.CooldownEnabled,
		"cooldown_sec":         local.CooldownSec,
		"sticky_enabled":       local.StickyEnabled,
		"sticky_ttl_sec":       local.StickyTTLSec,
		"preset_enabled":       local.PresetEnabled,
		"default_preset":       local.DefaultPreset,
	}
}

func (a *App) FetchModelStats() []map[string]any {
	entries, err := a.authSvc.FetchCloudModelStats()
	if err != nil {
		return nil
	}
	stats := make([]optimizer.ModelStatsInfo, 0, len(entries))
	result := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		stats = append(stats, optimizer.ModelStatsInfo{
			Model:         e.Model,
			TotalRequests: e.TotalRequests,
			TotalErrors:   e.TotalErrors,
			AvgLatencyMs:  e.AvgLatencyMs,
			ErrorRate:     e.ErrorRate,
		})
		result = append(result, map[string]any{
			"model":          e.Model,
			"total_requests": e.TotalRequests,
			"total_errors":   e.TotalErrors,
			"avg_latency_ms": e.AvgLatencyMs,
			"error_rate":     e.ErrorRate,
		})
	}
	a.optimizerSvc.SetCloudModelStats(stats)
	return result
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	default:
		return 0, false
	}
}

func (a *App) ListComboTemplates() []config.ModelCombo {
	return a.configSvc.ListComboTemplates()
}

func (a *App) SaveComboTemplate(template config.ModelCombo) error {
	return a.configSvc.SaveComboTemplate(template)
}

func (a *App) DeleteComboTemplate(name string) error {
	return a.configSvc.DeleteComboTemplate(name)
}

func (a *App) RenameComboTemplate(oldName, newName string) error {
	return a.configSvc.RenameComboTemplate(oldName, newName)
}

func (a *App) CheckUpdate() (map[string]interface{}, error) {
	return updater.CheckUpdate()
}

func (a *App) PerformUpdate() error {
	return updater.PerformUpdate()
}

func (a *App) SetLocale(locale string) error {
	a.configSvc.UpdateSetting("locale", locale)
	return nil
}

func (a *App) GetLocale() string {
	val := a.configSvc.GetSetting("locale")
	if val == "" {
		return "zh-CN"
	}
	return val
}

func (a *App) StartTunnel(tunnelType string) error {
	return a.tunnelMgr.Start(a.ctx, tunnel.TunnelType(tunnelType))
}

func (a *App) StopTunnel() error {
	return a.tunnelMgr.Stop()
}

func (a *App) IsTunnelRunning() bool {
	return a.tunnelMgr.IsRunning()
}

func (a *App) GetTunnelStatus() map[string]any {
	return a.tunnelMgr.GetStatus()
}

func (a *App) GetTunnelURL() string {
	return a.tunnelMgr.GetURL()
}

func (a *App) GetOAuthProviders() []map[string]any {
	providers := oauth.ListOAuthProviders()
	result := make([]map[string]any, 0, len(providers))
	for _, p := range providers {
		result = append(result, map[string]any{
			"name":        p.Name,
			"displayName": p.DisplayName,
			"authURL":     p.AuthURL,
			"iconURL":     p.IconURL,
		})
	}
	return result
}

func (a *App) GetOAuthConnections() []map[string]any {
	providers := oauth.ListOAuthProviders()
	result := make([]map[string]any, 0, len(providers))

	a.oauthFlowMu.Lock()
	defer a.oauthFlowMu.Unlock()

	for _, p := range providers {
		item := map[string]any{
			"name":         p.Name,
			"displayName":  p.DisplayName,
			"iconURL":      p.IconURL,
			"connected":    false,
			"connecting":   false,
			"configured":   false,
			"clientIDMask": "",
			"expiresAt":    nil,
			"error":        "",
		}
		if saved, ok := a.configSvc.GetOAuthProviderConfig(p.Name); ok {
			item["configured"] = true
			item["clientIDMask"] = maskClientID(saved.ClientID)
		}
		if info, err := a.oauthStore.Get(p.Name); err == nil && info != nil {
			item["connected"] = true
			item["expiresAt"] = info.ExpiresAt.Format(time.RFC3339)
		}
		if flow, ok := a.oauthFlows[p.Name]; ok {
			item["connecting"] = flow.Status == "pending"
			if flow.Error != "" {
				item["error"] = flow.Error
			}
		}
		result = append(result, item)
	}
	return result
}

func (a *App) StartOAuthFlow(providerName, clientID, clientSecret, redirectURI string) (string, error) {
	cfg, err := a.resolveOAuthProviderConfig(providerName, clientID, clientSecret, redirectURI)
	if err != nil {
		return "", err
	}
	pkce, err := oauth.GeneratePKCE()
	if err != nil {
		return "", err
	}
	state := fmt.Sprintf("%s-%d", providerName, time.Now().UnixNano())
	flow := &pendingOAuthFlow{
		ProviderName: providerName,
		State:        state,
		PKCE:         pkce,
		Config:       cfg,
		Status:       "pending",
		StartedAt:    time.Now(),
	}

	a.oauthFlowMu.Lock()
	if previous, ok := a.oauthFlows[providerName]; ok && previous.Server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = previous.Server.Shutdown(ctx)
		cancel()
	}
	a.oauthFlowMu.Unlock()

	if strings.TrimSpace(redirectURI) == "" {
		if err := a.createOAuthCallbackServer(flow); err != nil {
			return "", err
		}
	}

	a.oauthFlowMu.Lock()
	a.oauthFlows[providerName] = flow
	a.oauthFlowMu.Unlock()

	return oauth.BuildAuthURL(cfg, state, pkce), nil
}

func (a *App) ExchangeOAuthCode(providerName, code, clientID, clientSecret, redirectURI, codeVerifier string) error {
	cfg, err := a.resolveOAuthProviderConfig(providerName, clientID, clientSecret, redirectURI)
	if err != nil {
		return err
	}
	pkce := &oauth.PKCEFlow{Verifier: strings.TrimSpace(codeVerifier)}
	resp, err := oauth.ExchangeCode(cfg, code, pkce)
	if err != nil {
		return err
	}

	info := oauth.TokenResponseToInfo(resp)
	a.oauthRefresh.RegisterProvider(providerName, cfg)
	return a.oauthStore.Save(providerName, info)
}

func (a *App) GetOAuthToken(providerName string) (string, error) {
	return a.oauthRefresh.GetValidToken(providerName)
}

func (a *App) RevokeOAuthToken(providerName string) error {
	return a.oauthStore.Delete(providerName)
}

func convertPlatformChannels(items []map[string]interface{}) []config.Channel {
	result := make([]config.Channel, 0, len(items))
	for _, item := range items {
		channel := config.Channel{
			ChannelType:            "platform",
			Enabled:                true,
			HealthStatus:           "healthy",
			ProviderSpecificConfig: map[string]string{},
		}
		if value, ok := item["channel_id"].(string); ok {
			channel.ChannelID = value
		}
		if value, ok := item["provider_type"].(string); ok {
			channel.ProviderType = value
		}
		if value, ok := item["display_name"].(string); ok {
			channel.DisplayName = value
		}
		if value, ok := item["base_url"].(string); ok {
			channel.BaseURL = value
		}
		if value, ok := item["enabled"].(bool); ok {
			channel.Enabled = value
		}
		if values, ok := item["models"].([]interface{}); ok {
			models := make([]string, 0, len(values))
			for _, raw := range values {
				model, ok := raw.(map[string]interface{})
				if !ok {
					continue
				}
				if modelName, ok := model["model_name"].(string); ok {
					models = append(models, modelName)
				} else if modelID, ok := model["model_id"].(string); ok {
					models = append(models, modelID)
				}
			}
			channel.Models = models
		}
		result = append(result, channel)
	}
	return result
}

func emptyStringToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (a *App) ListMCPServers() []mcp.MCPServer {
	return a.mcpSvc.ListServers()
}

func (a *App) SaveMCPServer(server mcp.MCPServer) error {
	return a.mcpSvc.SaveServer(server)
}

func (a *App) DeleteMCPServer(name string) error {
	return a.mcpSvc.DeleteServer(name)
}

func (a *App) ToggleMCPServer(name string, enabled bool) error {
	return a.mcpSvc.ToggleServer(name, enabled)
}

func (a *App) ListPromptPresets() []prompts.PromptPreset {
	return a.promptsSvc.ListPresets()
}

func (a *App) SavePromptPreset(preset prompts.PromptPreset) error {
	return a.promptsSvc.SavePreset(preset)
}

func (a *App) DeletePromptPreset(name, targetApp string) error {
	return a.promptsSvc.DeletePreset(name, targetApp)
}

func (a *App) ApplyPromptPreset(name, targetApp string) error {
	return a.promptsSvc.ApplyPreset(name, targetApp)
}

func (a *App) ReadCurrentPrompt(targetApp string) (string, error) {
	return a.promptsSvc.ReadCurrentPrompt(targetApp)
}

func (a *App) ListSkills() []skills.Skill {
	return a.skillsSvc.ListSkills()
}

func (a *App) InstallSkillFromGitHub(repoURL, name string) error {
	return a.skillsSvc.InstallFromGitHub(repoURL, name)
}

func (a *App) InstallSkillFromLocal(srcPath, name string) error {
	return a.skillsSvc.InstallFromLocal(srcPath, name)
}

func (a *App) UninstallSkill(name string) error {
	return a.skillsSvc.UninstallSkill(name)
}

func (a *App) ToggleSkill(name string, enabled bool) error {
	return a.skillsSvc.ToggleSkill(name, enabled)
}

func (a *App) ScanSkillsDir() ([]skills.Skill, error) {
	return a.skillsSvc.ScanSkillsDir()
}

func (a *App) GetDailyUsage(days int) []usage.DailyUsage {
	return a.usageSvc.GetDailyUsage(days)
}

func (a *App) GetTotalUsage() map[string]interface{} {
	return a.usageSvc.GetTotalUsage()
}

func (a *App) RecordUsage(channelID, channelName, model string, inputTokens, outputTokens int64) {
	a.usageSvc.RecordUsage(channelID, channelName, model, inputTokens, outputTokens)
}

func (a *App) ListModelPricing() []usage.ModelPricing {
	return a.usageSvc.ListPricing()
}

func (a *App) SaveModelPricing(pricing []usage.ModelPricing) error {
	return a.usageSvc.SavePricing(pricing)
}

func (a *App) HandleDeepLink(rawURL string) error {
	return a.deeplinkMgr.Handle(rawURL)
}

func (a *App) ListProviderPresets() []presets.ProviderPreset {
	return a.presetsSvc.ListPresets()
}

func (a *App) ListPresetsByCategory(category string) []presets.ProviderPreset {
	return a.presetsSvc.ListByCategory(category)
}

func (a *App) GetPresetByName(name string) *presets.ProviderPreset {
	return a.presetsSvc.GetByName(name)
}

func (a *App) ImportCustomPreset(data []byte) error {
	return a.presetsSvc.ImportCustom(data)
}

func (a *App) GetSyncConfig() sync.SyncConfig {
	return a.syncMgr.GetConfig()
}

func (a *App) UpdateSyncConfig(config sync.SyncConfig) {
	a.syncMgr.UpdateConfig(config)
}

func (a *App) SyncPush() error {
	homeDir, _ := os.UserHomeDir()
	localDir := filepath.Join(homeDir, ".seasagi")
	return a.syncMgr.Push(localDir)
}

func (a *App) SyncPull() error {
	homeDir, _ := os.UserHomeDir()
	localDir := filepath.Join(homeDir, ".seasagi")
	return a.syncMgr.Pull(localDir)
}

func (a *App) GetSyncStatus() sync.SyncStatus {
	return a.syncMgr.GetStatus()
}

func (a *App) ListSessions(app string, limit int) ([]sessions.Session, error) {
	return a.sessionsSvc.ListSessions(app, limit)
}

func (a *App) GetSession(app, sessionID string) (*sessions.Session, error) {
	return a.sessionsSvc.GetSession(app, sessionID)
}

func (a *App) GetSessionMessages(app, sessionID string) ([]sessions.Message, error) {
	return a.sessionsSvc.GetMessages(app, sessionID)
}

func (a *App) SearchSessions(app, query string, limit int) ([]sessions.Session, error) {
	return a.sessionsSvc.SearchSessions(app, query, limit)
}

func (a *App) DeleteSession(app, sessionID string) error {
	return a.sessionsSvc.DeleteSession(app, sessionID)
}

func (a *App) Register(email, password, displayName string) error {
	return a.authSvc.Register(email, password, displayName)
}

func (a *App) GetCloudUsage() (map[string]any, error) {
	usageData, err := a.authSvc.FetchCloudUsage()
	if err != nil {
		return nil, err
	}
	if usageData == nil {
		return nil, nil
	}
	return map[string]any{
		"month_requests":      usageData.MonthRequests,
		"month_input_tokens":  usageData.MonthInputTokens,
		"month_output_tokens": usageData.MonthOutputTokens,
		"total_cost_usd":      usageData.TotalCostUSD,
	}, nil
}

func (a *App) GetCloudBilling() (map[string]any, error) {
	billingData, err := a.authSvc.FetchCloudBilling()
	if err != nil {
		return nil, err
	}
	if billingData == nil {
		return nil, nil
	}
	return map[string]any{
		"plan_id":        billingData.PlanID,
		"plan_name":      billingData.PlanName,
		"price":          billingData.Price,
		"quota":          billingData.Quota,
		"used_quota":     billingData.UsedQuota,
		"renewal_date":   billingData.RenewalDate,
		"relay_enabled":  billingData.RelayEnabled,
		"relay_gateways": billingData.RelayGateways,
	}, nil
}

func (a *App) GetPlans() ([]map[string]any, error) {
	plans, err := a.authSvc.FetchPlans()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(plans))
	for _, p := range plans {
		entry := map[string]any{
			"plan_id":       p.PlanID,
			"name":          p.Name,
			"description":   p.Description,
			"price":         p.Price,
			"monthly_quota": p.MonthlyQuota,
			"max_rpm":       p.MaxRPM,
			"max_tpm":       p.MaxTPM,
			"sort_order":    p.SortOrder,
			"relay_enabled": p.RelayEnabled,
		}
		result = append(result, entry)
	}
	return result, nil
}

func (a *App) GetRelayGateways() ([]map[string]any, error) {
	if !a.authSvc.IsLoggedIn() {
		return nil, fmt.Errorf("not logged in")
	}

	apiBase := a.configSvc.GetPlatformAPIBaseURL()

	reqCtx, cancel := context.WithTimeout(a.ctx, 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, apiBase+"/relay-gateways", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.authSvc.GetPlatformToken())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Data  []map[string]any `json:"data"`
		Error string           `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if resp.StatusCode >= http.StatusBadRequest {
		if strings.TrimSpace(result.Error) != "" {
			return nil, fmt.Errorf(result.Error)
		}
		return nil, fmt.Errorf("fetch relay gateways failed: status %d", resp.StatusCode)
	}
	if result.Data == nil {
		return []map[string]any{}, nil
	}
	return result.Data, nil
}

func (a *App) TestRelayGateway(gatewayID string) (map[string]any, error) {
	if !a.authSvc.IsLoggedIn() {
		return nil, fmt.Errorf("not logged in")
	}
	gatewayID = strings.TrimSpace(gatewayID)
	if gatewayID == "" {
		return map[string]any{
			"success": false,
			"error":   "relay gateway is not selected",
		}, nil
	}

	billingData, err := a.authSvc.FetchCloudBilling()
	if err != nil {
		return nil, err
	}
	if billingData == nil || !billingData.RelayEnabled {
		return map[string]any{
			"success": false,
			"error":   "remote acceleration is not enabled for current plan",
		}, nil
	}

	var target *auth.RelayGateway
	for i := range billingData.RelayGateways {
		gateway := &billingData.RelayGateways[i]
		if strings.TrimSpace(gateway.GatewayID) == gatewayID {
			target = gateway
			break
		}
	}
	if target == nil {
		return map[string]any{
			"success": false,
			"error":   "relay gateway not found",
		}, nil
	}
	if strings.TrimSpace(target.Host) == "" || target.Port <= 0 {
		return map[string]any{
			"success": false,
			"error":   "relay gateway configuration is invalid",
		}, nil
	}

	baseCtx := a.ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	testCtx, cancel := context.WithTimeout(baseCtx, 5*time.Second)
	defer cancel()

	startedAt := time.Now()
	healthzURL := fmt.Sprintf("http://%s/healthz", net.JoinHostPort(strings.TrimSpace(target.Host), fmt.Sprintf("%d", target.Port)))
	req, err := http.NewRequestWithContext(testCtx, http.MethodGet, healthzURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return map[string]any{
			"success":    false,
			"gateway_id": target.GatewayID,
			"host":       target.Host,
			"port":       target.Port,
			"error":      fmt.Sprintf("local relay health check failed: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	var healthz struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&healthz); err != nil {
		return map[string]any{
			"success":    false,
			"gateway_id": target.GatewayID,
			"host":       target.Host,
			"port":       target.Port,
			"error":      fmt.Sprintf("relay healthz response is invalid: %v", err),
		}, nil
	}
	if resp.StatusCode != http.StatusOK || healthz.Status != "ok" {
		return map[string]any{
			"success":    false,
			"gateway_id": target.GatewayID,
			"host":       target.Host,
			"port":       target.Port,
			"error":      fmt.Sprintf("relay healthz check failed: status_code=%d, body_status=%s", resp.StatusCode, healthz.Status),
		}, nil
	}

	a.configSvc.SetSelectedRelayGateway(gatewayID)
	return map[string]any{
		"success":    true,
		"gateway_id": target.GatewayID,
		"name":       target.Name,
		"host":       target.Host,
		"port":       target.Port,
		"latency_ms": time.Since(startedAt).Milliseconds(),
		"message":    "local relay connectivity test succeeded and relay gateway enabled",
	}, nil
}

func (a *App) SaveRelayGateway(gatewayID string) {
	a.configSvc.SetSelectedRelayGateway(gatewayID)
}

func (a *App) GetSelectedRelayGateway() string {
	return a.configSvc.GetConfig().SelectedRelayGateway
}

func (a *App) ChatCompletion(messages []map[string]any, model string) (map[string]any, error) {
	gatewayPort := a.gatewaySvc.GetListenPort()
	if gatewayPort == 0 {
		return nil, fmt.Errorf("local gateway is not running")
	}

	body := map[string]any{
		"model":    model,
		"messages": messages,
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	token, err := a.localTokenStore.GetOrCreate()
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	req, err := http.NewRequestWithContext(a.ctx, http.MethodPost,
		fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", gatewayPort),
		bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gateway request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result map[string]any
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	result["_gateway_status"] = resp.StatusCode
	result["_gateway_port"] = gatewayPort

	// Build curl command for debugging
	result["_curl_command"] = buildCurlCommand(
		fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", gatewayPort),
		"Bearer "+token,
		string(bodyBytes),
	)

	return result, nil
}

func buildCurlCommand(url, authHeader, bodyJSON string) string {
	escapedBody := strings.ReplaceAll(bodyJSON, "'", "'\\''")
	return fmt.Sprintf("curl -X POST '%s' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: %s' \\\n  -d '%s'", url, authHeader, escapedBody)
}

func (a *App) ChatCompletionForChannel(channelID string, messages []map[string]any, model string) (map[string]any, error) {
	ch, ok := a.configSvc.GetChannel(channelID)
	if !ok {
		return nil, fmt.Errorf("channel not found: %s", channelID)
	}

	apiKey := ""
	if len(ch.APIKeys) > 0 {
		apiKey = ch.APIKeys[0]
	} else if ch.APIKey != "" {
		apiKey = ch.APIKey
	}
	if apiKey == "" {
		return nil, fmt.Errorf("no API key configured for channel %s", channelID)
	}

	body := map[string]any{
		"model":    model,
		"messages": messages,
	}
	bodyBytes, _ := json.Marshal(body)

	baseURL := strings.TrimRight(ch.BaseURL, "/")
	req, err := http.NewRequestWithContext(a.ctx, http.MethodPost,
		baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("channel request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result map[string]any
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	result["_channel_id"] = channelID
	result["_channel_name"] = ch.DisplayName
	result["_status_code"] = resp.StatusCode

	// Build curl command for debugging
	result["_curl_command"] = buildCurlCommand(
		baseURL+"/chat/completions",
		"Bearer "+apiKey,
		string(bodyBytes),
	)

	return result, nil
}

func (a *App) GetRecommendedCombos() ([]map[string]any, error) {
	combos, err := a.authSvc.FetchRecommendedCombos()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(combos))
	for _, combo := range combos {
		result = append(result, map[string]any{
			"name":        combo.Name,
			"models":      combo.Models,
			"description": combo.Description,
			"strategy":    combo.Strategy,
		})
	}
	return result, nil
}

func (a *App) GetOfficialComboTemplates() ([]map[string]any, error) {
	templates, err := a.authSvc.FetchOfficialComboTemplates(a.ctx)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(templates))
	for _, tmpl := range templates {
		steps := make([]map[string]any, 0, len(tmpl.Steps))
		for _, step := range tmpl.Steps {
			steps = append(steps, map[string]any{
				"channel_id": step.ChannelID,
				"model":      step.Model,
			})
		}
		result = append(result, map[string]any{
			"name":        tmpl.Name,
			"description": tmpl.Description,
			"tags":        tmpl.Tags,
			"steps":       steps,
			"models":      tmpl.Models,
			"strategy":    tmpl.Strategy,
			"sticky_uses": tmpl.StickyUses,
		})
	}
	return result, nil
}

// FetchCloudCombos retrieves user combos from the cloud server.
func (a *App) FetchCloudCombos() ([]map[string]any, error) {
	combos, err := a.authSvc.FetchCloudCombos()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(combos))
	for _, c := range combos {
		steps := make([]map[string]any, 0, len(c.Steps))
		for _, s := range c.Steps {
			steps = append(steps, map[string]any{
				"channel_id": s.ChannelID,
				"model":      s.Model,
				"step_role":  s.StepRole,
			})
		}
		result = append(result, map[string]any{
			"combo_id":       c.ComboID,
			"scope":          c.Scope,
			"logical_name":   c.LogicalName,
			"display_name":   c.DisplayName,
			"description":    c.Description,
			"tags":           c.Tags,
			"strategy":       c.Strategy,
			"sticky_uses":    c.StickyUses,
			"quick_strategy": c.QuickStrategy,
			"task_profile":   c.TaskProfile,
			"steps":          steps,
			"status":         c.Status,
			"source":         c.Source,
			"version":        c.Version,
			"created_at":     c.CreatedAt,
			"updated_at":     c.UpdatedAt,
		})
	}
	return result, nil
}

// PushCloudCombo creates a user combo on the cloud server.
func (a *App) PushCloudCombo(logicalName, displayName, description, strategy string, stickyUses int, quickStrategy string, taskProfile map[string]any, stepsJSON string) (map[string]any, error) {
	combo, err := a.authSvc.PushCloudCombo(logicalName, displayName, description, strategy, stickyUses, quickStrategy, taskProfile, []byte(stepsJSON))
	if err != nil {
		return nil, err
	}
	if combo == nil {
		return nil, nil
	}
	return map[string]any{
		"combo_id":       combo.ComboID,
		"logical_name":   combo.LogicalName,
		"display_name":   combo.DisplayName,
		"description":    combo.Description,
		"strategy":       combo.Strategy,
		"sticky_uses":    combo.StickyUses,
		"quick_strategy": combo.QuickStrategy,
		"task_profile":   combo.TaskProfile,
		"status":         combo.Status,
		"version":        combo.Version,
	}, nil
}

// UpdateCloudCombo updates a user combo on the cloud server.
func (a *App) UpdateCloudCombo(comboID, displayName, description, strategy string, stickyUses int, status, quickStrategy string, taskProfile map[string]any, stepsJSON string) error {
	return a.authSvc.UpdateCloudCombo(comboID, displayName, description, strategy, stickyUses, status, quickStrategy, taskProfile, []byte(stepsJSON))
}

// DeleteCloudCombo deletes a user combo on the cloud server.
func (a *App) DeleteCloudCombo(comboID string) error {
	return a.authSvc.DeleteCloudCombo(comboID)
}

func (a *App) GetOptimizationPlan(mode string, taskType string) map[string]any {
	if mode == "" {
		mode = "value_first"
	}
	if taskType == "" {
		taskType = optimizer.TaskGeneralChat
	}
	plan := a.optimizerSvc.GetOptimizationPlan(mode, taskType)
	if plan == nil {
		return nil
	}
	recommendations := make([]map[string]any, 0, len(plan.Recommendations))
	for _, rec := range plan.Recommendations {
		recommendations = append(recommendations, map[string]any{
			"from_model":   rec.FromModel,
			"to_model":     rec.ToModel,
			"model_tag":    rec.ModelTag,
			"channel_id":   rec.ChannelID,
			"channel_name": rec.ChannelName,
			"savings_usd":  rec.SavingsUSD,
			"quality_diff": rec.QualityDiff,
			"reason":       rec.Reason,
		})
	}
	return map[string]any{
		"recommendations": recommendations,
		"monthly_savings": plan.MonthlySavings,
		"strategy":        plan.Strategy,
		"mode":            plan.Mode,
		"task_type":       plan.TaskType,
	}
}

func (a *App) GetQuickStrategies() []map[string]any {
	return []map[string]any{
		{
			"alias":        "stable_first",
			"display_name": "稳定优先",
			"description":  "优先选择稳定性高、回退链清晰的模型组合",
			"task_profile": map[string]any{
				"task_type":          optimizer.TaskGeneralChat,
				"priority_providers": []string{"openai", "anthropic", "google"},
				"fallback_order":     []string{"openai", "anthropic", "google"},
				"min_success_rate":   0.98,
			},
			"combo_constraints": map[string]any{
				"min_steps":          2,
				"max_steps":          3,
				"allowed_strategies": []string{"fallback"},
			},
		},
		{
			"alias":        "cost_first",
			"display_name": "成本优先",
			"description":  "优先选择成本更低的模型与提供商组合",
			"task_profile": map[string]any{
				"task_type":            optimizer.TaskGeneralChat,
				"priority_providers":   []string{"openrouter", "google", "openai"},
				"fallback_order":       []string{"openrouter", "google", "openai"},
				"max_cost_per_request": 0.02,
			},
			"combo_constraints": map[string]any{
				"min_steps":          1,
				"max_steps":          3,
				"allowed_strategies": []string{"fallback", "round_robin"},
			},
		},
		{
			"alias":        "speed_first",
			"display_name": "速度优先",
			"description":  "优先选择低延迟模型，适合交互式场景",
			"task_profile": map[string]any{
				"task_type":          optimizer.TaskGeneralChat,
				"priority_providers": []string{"google", "openai", "anthropic"},
				"fallback_order":     []string{"google", "openai", "anthropic"},
				"max_latency_ms":     1500,
			},
			"combo_constraints": map[string]any{
				"min_steps":          1,
				"max_steps":          2,
				"allowed_strategies": []string{"fallback", "round_robin"},
			},
		},
		{
			"alias":        "tools_first",
			"display_name": "工具优先",
			"description":  "优先选择工具调用成功率和结构化输出稳定性更高的模型",
			"task_profile": map[string]any{
				"task_type":          optimizer.TaskToolCalling,
				"priority_providers": []string{"openai", "anthropic", "google", "openrouter"},
				"fallback_order":     []string{"openai", "anthropic", "google", "openrouter"},
				"min_success_rate":   0.97,
			},
			"combo_constraints": map[string]any{
				"min_steps":          2,
				"max_steps":          3,
				"allowed_strategies": []string{"fallback"},
			},
		},
	}
}

func (a *App) GetTaskProfiles() []map[string]any {
	return []map[string]any{
		{
			"task_type":          optimizer.TaskGeneralChat,
			"priority_providers": []string{"openai", "anthropic", "google"},
			"fallback_order":     []string{"openai", "anthropic", "google"},
			"min_success_rate":   0.95,
		},
		{
			"task_type":          optimizer.TaskToolCalling,
			"priority_providers": []string{"openai", "anthropic", "google", "openrouter"},
			"fallback_order":     []string{"openai", "anthropic", "google", "openrouter"},
			"min_success_rate":   0.97,
		},
		{
			"task_type":          optimizer.TaskStructured,
			"priority_providers": []string{"openai", "anthropic", "google"},
			"fallback_order":     []string{"openai", "google", "anthropic"},
			"min_success_rate":   0.96,
		},
		{
			"task_type":          optimizer.TaskLongContext,
			"priority_providers": []string{"google", "anthropic", "openai"},
			"fallback_order":     []string{"google", "anthropic", "openai"},
			"max_latency_ms":     4000,
			"min_success_rate":   0.94,
		},
		{
			"task_type":          optimizer.TaskVision,
			"priority_providers": []string{"openai", "google", "anthropic"},
			"fallback_order":     []string{"openai", "google", "anthropic"},
			"min_success_rate":   0.95,
		},
	}
}

func (a *App) GetUsageSummary() map[string]any {
	summary := a.usageSvc.GetUsageSummary()
	return map[string]any{
		"month_requests":      summary.MonthRequests,
		"month_input_tokens":  summary.MonthInputTokens,
		"month_output_tokens": summary.MonthOutputTokens,
		"month_cost_usd":      summary.MonthCostUSD,
	}
}

func (a *App) GetOptimizationConfig() map[string]any {
	cfg := a.configSvc.GetOptimizationConfig()
	return map[string]any{
		"mode":                 cfg.Mode,
		"penalty_enabled":      cfg.PenaltyEnabled,
		"penalty_decay_sec":    cfg.PenaltyDecaySec,
		"health_check_enabled": cfg.HealthCheckEnabled,
		"health_check_sec":     cfg.HealthCheckSec,
		"health_max_failures":  cfg.HealthMaxFailures,
		"cooldown_enabled":     cfg.CooldownEnabled,
		"cooldown_sec":         cfg.CooldownSec,
		"sticky_enabled":       cfg.StickyEnabled,
		"sticky_ttl_sec":       cfg.StickyTTLSec,
		"preset_enabled":       cfg.PresetEnabled,
		"default_preset":       cfg.DefaultPreset,
	}
}

func (a *App) SetOptimizationConfig(cfg map[string]any) error {
	parsed := config.OptimizationConfig{}
	if v, ok := cfg["mode"]; ok {
		parsed.Mode, _ = v.(string)
	}
	if v, ok := cfg["penalty_enabled"]; ok {
		parsed.PenaltyEnabled, _ = v.(bool)
	}
	if v, ok := cfg["penalty_decay_sec"]; ok {
		parsed.PenaltyDecaySec, _ = v.(int)
	}
	if v, ok := cfg["health_check_enabled"]; ok {
		parsed.HealthCheckEnabled, _ = v.(bool)
	}
	if v, ok := cfg["health_check_sec"]; ok {
		parsed.HealthCheckSec, _ = v.(int)
	}
	if v, ok := cfg["health_max_failures"]; ok {
		parsed.HealthMaxFailures, _ = v.(int)
	}
	if v, ok := cfg["cooldown_enabled"]; ok {
		parsed.CooldownEnabled, _ = v.(bool)
	}
	if v, ok := cfg["cooldown_sec"]; ok {
		parsed.CooldownSec, _ = v.(int)
	}
	if v, ok := cfg["sticky_enabled"]; ok {
		parsed.StickyEnabled, _ = v.(bool)
	}
	if v, ok := cfg["sticky_ttl_sec"]; ok {
		parsed.StickyTTLSec, _ = v.(int)
	}
	if v, ok := cfg["preset_enabled"]; ok {
		parsed.PresetEnabled, _ = v.(bool)
	}
	if v, ok := cfg["default_preset"]; ok {
		parsed.DefaultPreset, _ = v.(string)
	}
	return a.configSvc.SetOptimizationConfig(parsed)
}
