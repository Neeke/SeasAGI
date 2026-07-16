package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type AppConfig struct {
	ListenPort           int                   `json:"listen_port"`
	DefaultModel         string                `json:"default_model"`
	DefaultChannelID     string                `json:"default_channel_id"`
	RoutingStrategy      string                `json:"routing_strategy"`
	StickyChannelUse     int                   `json:"sticky_channel_use"`
	AutoLaunch           bool                  `json:"auto_launch"`
	AutoUpdate           bool                  `json:"auto_update"`
	LogRetentionDays     int                   `json:"log_retention_days"`
	AnalyticsEnabled     bool                  `json:"analytics_enabled"`
	Locale               string                `json:"locale"`
	RTKEnabled           bool                  `json:"rtk_enabled"`
	RTKMaxOutputChars    int                   `json:"rtk_max_output_chars"`
	CavemanEnabled       bool                  `json:"caveman_enabled"`
	CavemanStyle         string                `json:"caveman_style"`
	ModelCombos          []ModelCombo          `json:"model_combos,omitempty"`
	ComboTemplates       []ModelCombo          `json:"combo_templates,omitempty"`
	OAuthProviders       []OAuthProviderConfig `json:"oauth_providers,omitempty"`
	SelectedRelayGateway string                `json:"selected_relay_gateway,omitempty"`
	Optimizations        *OptimizationConfig   `json:"optimizations,omitempty"`
	PlatformAPIBaseURL   string                `json:"platform_api_base_url,omitempty"`
	DefaultComboName     string                `json:"default_combo_name,omitempty"`
}

type OptimizationConfig struct {
	Mode               string `json:"mode"`
	PenaltyEnabled     bool   `json:"penalty_enabled"`
	PenaltyDecaySec    int    `json:"penalty_decay_sec"`
	HealthCheckEnabled bool   `json:"health_check_enabled"`
	HealthCheckSec     int    `json:"health_check_sec"`
	HealthMaxFailures  int    `json:"health_max_failures"`
	CooldownEnabled    bool   `json:"cooldown_enabled"`
	CooldownSec        int    `json:"cooldown_sec"`
	StickyEnabled      bool   `json:"sticky_enabled"`
	StickyTTLSec       int    `json:"sticky_ttl_sec"`
	PresetEnabled      bool   `json:"preset_enabled"`
	DefaultPreset      string `json:"default_preset"`
}

type CandidateProvider struct {
	ChannelID    string `json:"channel_id"`
	Model        string `json:"model"`
	Priority     int    `json:"priority"`
	HealthStatus string `json:"health_status,omitempty"`
}

type ModelComboStep struct {
	ChannelID                  string              `json:"channel_id,omitempty"`
	Model                      string              `json:"model"`
	StepRole                   string              `json:"step_role,omitempty"`
	Providers                  []CandidateProvider `json:"providers,omitempty"`
	Channels                   []string            `json:"channels,omitempty"`
	SelectionPolicy            string              `json:"selection_policy,omitempty"`
	AllowProviderFallback      bool                `json:"allow_provider_fallback,omitempty"`
	AllowCrossProviderFallback bool                `json:"allow_cross_provider_fallback,omitempty"`
}

type ModelCombo struct {
	ComboID       string           `json:"combo_id,omitempty"`
	Name          string           `json:"name"`
	LogicalName   string           `json:"logical_name,omitempty"`
	DisplayName   string           `json:"display_name,omitempty"`
	Description   string           `json:"description,omitempty"`
	Tags          []string         `json:"tags,omitempty"`
	Steps         []ModelComboStep `json:"steps,omitempty"`
	Models        []string         `json:"models,omitempty"`
	Strategy      string           `json:"strategy"`
	StickyUses    int              `json:"sticky_uses"`
	QuickStrategy string           `json:"quick_strategy,omitempty"`
	TaskProfile   map[string]any   `json:"task_profile,omitempty"`
	Status        string           `json:"status,omitempty"`
	Source        string           `json:"source,omitempty"`
	Version       int              `json:"version,omitempty"`
}

type OAuthProviderConfig struct {
	ProviderName string `json:"provider_name"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret,omitempty"`
}

type RetryConfig struct {
	MaxRetries    int    `json:"max_retries"`
	InitialDelay  string `json:"initial_delay"`
	MaxDelay      string `json:"max_delay"`
	RetryableOnly bool   `json:"retryable_only"`
}

type Channel struct {
	ChannelID              string            `json:"channel_id"`
	ChannelType            string            `json:"channel_type"`
	ProviderType           string            `json:"provider_type"`
	DisplayName            string            `json:"display_name"`
	BaseURL                string            `json:"base_url"`
	Enabled                bool              `json:"enabled"`
	HealthStatus           string            `json:"health_status"`
	Source                 string            `json:"source,omitempty"` // "enterprise", "platform", ""
	ProviderSpecificConfig map[string]string `json:"provider_specific_config"`
	SupportedModalities    []string          `json:"supported_modalities,omitempty"`
	Models                 []string          `json:"models,omitempty"`
	APIKey                 string            `json:"api_key,omitempty"`
	APIKeys                []string          `json:"api_keys,omitempty"`
	RetryConfig            *RetryConfig      `json:"retry_config,omitempty"`
}

type Service struct {
	mu       sync.RWMutex
	config   AppConfig
	channels []Channel
	path     string
}

type persistedState struct {
	Config   AppConfig `json:"config"`
	Channels []Channel `json:"channels"`
}

func NewService(cfg AppConfig) *Service {
	svc := &Service{
		config:   cfg,
		channels: []Channel{},
		path:     defaultConfigPath(),
	}
	_ = svc.load()
	svc.ensureOptimizationConfig()
	svc.ensureBuiltinTemplates()
	svc.migrateModelCombos()
	return svc
}

func defaultOptimizationConfig() OptimizationConfig {
	return OptimizationConfig{
		Mode:               "value_first",
		PenaltyEnabled:     true,
		PenaltyDecaySec:    120,
		HealthCheckEnabled: true,
		HealthCheckSec:     300,
		HealthMaxFailures:  3,
		CooldownEnabled:    true,
		CooldownSec:        120,
		StickyEnabled:      true,
		StickyTTLSec:       1800,
		PresetEnabled:      true,
		DefaultPreset:      "budget",
	}
}

func (s *Service) ensureOptimizationConfig() {
	if s.config.Optimizations == nil {
		def := defaultOptimizationConfig()
		s.config.Optimizations = &def
		_ = s.saveLocked()
	}
}

func (s *Service) ensureBuiltinTemplates() {
	s.mu.Lock()
	defer s.mu.Unlock()

	existing := make(map[string]struct{})
	for _, t := range s.config.ComboTemplates {
		existing[t.Name] = struct{}{}
	}

	builtins := []ModelCombo{
		{
			Name:        "gpt-4o-fallback",
			Description: "GPT-4o 主力 + 备用回退，适合生产环境",
			Tags:        []string{"生产", "高可用", "OpenAI"},
			Steps: []ModelComboStep{
				{Model: "gpt-4o"},
				{Model: "gpt-4o-mini"},
			},
			Models:     []string{"gpt-4o", "gpt-4o-mini"},
			Strategy:   "fallback",
			StickyUses: 1,
		},
		{
			Name:        "claude-opus-4-8-fallback",
			Description: "Claude Opus 4.8 主力 + Sonnet 5 回退，企业级智能",
			Tags:        []string{"生产", "企业", "Anthropic", "前沿"},
			Steps: []ModelComboStep{
				{Model: "claude-opus-4-8"},
				{Model: "claude-sonnet-5"},
			},
			Models:     []string{"claude-opus-4-8", "claude-sonnet-5"},
			Strategy:   "fallback",
			StickyUses: 1,
		},
		{
			Name:        "claude-sonnet-round-robin",
			Description: "Claude Sonnet 5 轮询，适合高并发场景",
			Tags:        []string{"生产", "高并发", "Anthropic"},
			Steps: []ModelComboStep{
				{Model: "claude-sonnet-5"},
			},
			Models:     []string{"claude-sonnet-5"},
			Strategy:   "round_robin",
			StickyUses: 3,
		},
		{
			Name:        "fast-cheap-fallback",
			Description: "轻量模型优先，失败回退到更小模型，适合批量任务",
			Tags:        []string{"批量", "低成本"},
			Steps: []ModelComboStep{
				{Model: "gpt-4o-mini"},
				{Model: "gpt-3.5-turbo"},
			},
			Models:     []string{"gpt-4o-mini", "gpt-3.5-turbo"},
			Strategy:   "fallback",
			StickyUses: 1,
		},
	}

	changed := false
	for _, builtin := range builtins {
		if _, ok := existing[builtin.Name]; !ok {
			s.config.ComboTemplates = append(s.config.ComboTemplates, builtin)
			changed = true
		}
	}
	if changed {
		_ = s.saveLocked()
	}
}

func LoadOrDefault() (AppConfig, error) {
	svc := NewService(AppConfig{
		ListenPort:         4318,
		RoutingStrategy:    "fallback",
		StickyChannelUse:   2,
		AutoLaunch:         false,
		AutoUpdate:         true,
		LogRetentionDays:   30,
		AnalyticsEnabled:   false,
		PlatformAPIBaseURL: "http://127.0.0.1:9318/api/v1",
	})
	if err := svc.load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return svc.config, err
	}
	return svc.config, nil
}

// generateComboID creates a unique combo identifier
func generateComboID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// migrateModelCombos migrates existing combos to the unified schema.
// It fills in missing fields (combo_id, logical_name, display_name, status, source, version).
func (s *Service) migrateModelCombos() {
	s.mu.Lock()
	defer s.mu.Unlock()

	changed := false
	for i := range s.config.ModelCombos {
		c := &s.config.ModelCombos[i]

		// Generate combo_id if missing
		if c.ComboID == "" {
			c.ComboID = generateComboID()
			changed = true
		}

		// Set logical_name from name if empty
		if c.LogicalName == "" && c.Name != "" {
			c.LogicalName = strings.ToLower(strings.ReplaceAll(c.Name, " ", "-"))
			changed = true
		}

		// Set display_name from name if empty
		if c.DisplayName == "" && c.Name != "" {
			c.DisplayName = c.Name
			changed = true
		}

		// Set status to active if empty
		if c.Status == "" {
			c.Status = "active"
			changed = true
		}

		// Set source to local if empty
		if c.Source == "" {
			c.Source = "local"
			changed = true
		}

		// Set version to 1 if 0
		if c.Version == 0 {
			c.Version = 1
			changed = true
		}
	}

	if changed {
		_ = s.saveLocked()
	}
}

func (s *Service) GetConfig() AppConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg := s.config
	if cfg.RoutingStrategy == "" {
		cfg.RoutingStrategy = "fallback"
	}
	if cfg.StickyChannelUse <= 0 {
		cfg.StickyChannelUse = 2
	}
	return cfg
}

func (s *Service) GetOptimizationConfig() OptimizationConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.config.Optimizations == nil {
		return defaultOptimizationConfig()
	}
	return *s.config.Optimizations
}

func (s *Service) SetOptimizationConfig(cfg OptimizationConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cfg.Mode == "" {
		cfg.Mode = "value_first"
	}
	s.config.Optimizations = &cfg
	return s.saveLocked()
}

func (s *Service) SetDefaultModel(modelName, channelID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.DefaultModel = modelName
	s.config.DefaultChannelID = channelID
	_ = s.saveLocked()
}

func (s *Service) GetDefaultComboName() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.config.DefaultComboName
}

func (s *Service) SetDefaultComboName(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.DefaultComboName = name
	_ = s.saveLocked()
}

func (s *Service) SetSelectedRelayGateway(gatewayID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.SelectedRelayGateway = gatewayID
	_ = s.saveLocked()
}

func (s *Service) GetPlatformAPIBaseURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.config.PlatformAPIBaseURL == "" {
		return "http://127.0.0.1:9318/api/v1"
	}
	return s.config.PlatformAPIBaseURL
}

func (s *Service) SetPlatformAPIBaseURL(url string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.PlatformAPIBaseURL = url
	return s.saveLocked()
}

func (s *Service) ListChannels() ([]Channel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]Channel, 0, len(s.channels))
	for _, ch := range s.channels {
		result = append(result, sanitizeChannel(ch))
	}
	return result, nil
}

func (s *Service) SaveCustomChannel(ch Channel) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ch.ChannelType = "custom"
	if ch.ChannelID == "" {
		ch.ChannelID = generateChannelID()
	}
	if ch.HealthStatus == "" {
		ch.HealthStatus = "unknown"
	}
	if ch.ProviderSpecificConfig == nil {
		ch.ProviderSpecificConfig = map[string]string{}
	}

	for i := range s.channels {
		if s.channels[i].ChannelID == ch.ChannelID {
			existingModels := s.channels[i].Models
			if len(ch.Models) == 0 {
				ch.Models = existingModels
			}
			s.channels[i] = ch
			return ch.ChannelID, s.saveLocked()
		}
	}

	s.channels = append(s.channels, ch)
	return ch.ChannelID, s.saveLocked()
}

func (s *Service) DeleteCustomChannel(channelID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := s.channels[:0]
	for _, ch := range s.channels {
		if ch.ChannelID != channelID {
			filtered = append(filtered, ch)
		}
	}
	s.channels = filtered
	if s.config.DefaultChannelID == channelID {
		s.config.DefaultChannelID = ""
	}
	return s.saveLocked()
}

func (s *Service) ReorderChannels(orderedIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	idIndex := make(map[string]int, len(orderedIDs))
	for i, id := range orderedIDs {
		idIndex[id] = i
	}

	sorted := make([]Channel, 0, len(s.channels))
	unsorted := make([]Channel, 0)

	for _, ch := range s.channels {
		if _, ok := idIndex[ch.ChannelID]; ok {
			unsorted = append(unsorted, ch)
		} else {
			sorted = append(sorted, ch)
		}
	}

	for i := 0; i < len(unsorted)-1; i++ {
		for j := i + 1; j < len(unsorted); j++ {
			if idIndex[unsorted[i].ChannelID] > idIndex[unsorted[j].ChannelID] {
				unsorted[i], unsorted[j] = unsorted[j], unsorted[i]
			}
		}
	}

	s.channels = append(unsorted, sorted...)
	return s.saveLocked()
}

func (s *Service) SetAutoLaunch(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.AutoLaunch = enabled
	return s.saveLocked()
}

func (s *Service) SetAnalyticsEnabled(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config.AnalyticsEnabled = enabled
	_ = s.saveLocked()
}

func (s *Service) UpdateRoutingSettings(strategy string, stickyUses int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	strategy = strings.TrimSpace(strategy)
	if strategy == "" {
		strategy = "fallback"
	}
	if stickyUses <= 0 {
		stickyUses = 2
	}
	s.config.RoutingStrategy = strategy
	s.config.StickyChannelUse = stickyUses
	return s.saveLocked()
}

func (s *Service) SaveModelCombo(combo ModelCombo) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	combo.Name = strings.TrimSpace(combo.Name)
	if combo.Name == "" {
		return errors.New("combo name is required")
	}
	combo.Description = strings.TrimSpace(combo.Description)
	combo.Tags = normalizeTags(combo.Tags)
	combo.Strategy = strings.TrimSpace(combo.Strategy)
	if combo.Strategy == "" {
		combo.Strategy = "fallback"
	}
	if combo.StickyUses <= 0 {
		combo.StickyUses = 1
	}
	combo.Steps = normalizeComboSteps(combo.Steps)
	if len(combo.Steps) == 0 && len(combo.Models) > 0 {
		models := normalizeModels(combo.Models)
		combo.Steps = make([]ModelComboStep, 0, len(models))
		for _, model := range models {
			combo.Steps = append(combo.Steps, ModelComboStep{Model: model})
		}
	}
	combo.Models = comboModelsFromSteps(combo.Steps)
	if len(combo.Steps) == 0 {
		return errors.New("combo must contain at least one model")
	}

	for i := range s.config.ModelCombos {
		if s.config.ModelCombos[i].Name == combo.Name {
			s.config.ModelCombos[i] = combo
			return s.saveLocked()
		}
	}

	s.config.ModelCombos = append(s.config.ModelCombos, combo)
	return s.saveLocked()
}

func (s *Service) DeleteModelCombo(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := s.config.ModelCombos[:0]
	for _, combo := range s.config.ModelCombos {
		if combo.Name != name {
			filtered = append(filtered, combo)
		}
	}
	s.config.ModelCombos = filtered
	return s.saveLocked()
}

var modelTierMap = map[string]int{
	"gpt-5":                    11,
	"gpt-4o":                   10,
	"gpt-4-turbo":              10,
	"gpt-4":                    10,
	"claude-4-opus":            12,
	"claude-4-sonnet":          11,
	"claude-opus-4-20250514":   10,
	"claude-opus-4-8":          12,
	"claude-3-opus":            10,
	"claude-fable-5":           13,
	"claude-sonnet-5":          11,
	"claude-haiku-4-5":         5,
	"o3":                       10,
	"claude-3-5-sonnet":        8,
	"o3-mini":                  9,
	"o1":                       9,
	"o1-mini":                  9,
	"deepseek-v4-pro":          9,
	"glm-5.1":                  9,
	"claude-sonnet-4-20250514": 8,
	"gemini-2.5-pro":           8,
	"kimi-2.6":                 9,
	"qwen-max":                 8,
	"mistral-large":            8,
	"mistral-medium-3.5":       8,
	"llama-3.1-405b":           8,
	"llama-4-maverick":         8,
	"llama-4-scout":            7,
	"gpt-5-mini":               8,
	"gpt-4o-mini":              5,
	"claude-3-5-haiku":         5,
	"gemini-2.5-flash":         5,
	"deepseek-v4-flash":        7,
	"glm-5":                    8,
	"kimi-2.5":                 8,
	"deepseek-chat":            7, // Deprecated — use deepseek-v4-pro after 2026-07-24
	"deepseek-reasoner":        7, // Deprecated — use deepseek-v4-flash (thinking) after 2026-07-24
	"deepseek-coder":           6,
	"qwen-plus":                7,
	"llama-3.1-70b":            7,
	"gpt-5-nano":               6,
	"gemini-2.0-flash":         7,
	"gemini-1.5-pro":           9,
	"gpt-3.5-turbo":            3,
	"claude-3-haiku":           3,
	"gemini-1.5-flash":         3,
	"minimax-m2.7":             7,
	"minimax-m3":               9,
}

var modelCostMap = map[string]float64{
	"gpt-5":                    20.0,
	"gpt-4-turbo":              10.0,
	"gpt-4o":                   5.0,
	"gpt-4":                    30.0,
	"claude-4-opus":            80.0,
	"claude-4-sonnet":          18.0,
	"claude-opus-4-20250514":   15.0,
	"claude-opus-4-8":          30.0,
	"claude-3-opus":            15.0,
	"claude-fable-5":           60.0,
	"claude-sonnet-5":          18.0,
	"claude-haiku-4-5":         1.0,
	"o3":                       10.0,
	"o3-mini":                  1.1,
	"o1":                       15.0,
	"o1-mini":                  1.1,
	"claude-sonnet-4-20250514": 3.0,
	"claude-3-5-sonnet":        3.0,
	"deepseek-v4-pro":          2.0,
	"gemini-2.5-pro":           1.25,
	"glm-5.1":                  3.0,
	"kimi-2.6":                 4.0,
	"deepseek-chat":            0.27, // Deprecated — use deepseek-v4-pro after 2026-07-24
	"deepseek-reasoner":        0.40, // Deprecated — use deepseek-v4-flash after 2026-07-24
	"deepseek-coder":           0.14,
	"deepseek-v4-flash":        0.40,
	"glm-5":                    2.0,
	"kimi-2.5":                 2.5,
	"gpt-5-mini":               1.2,
	"gpt-4o-mini":              0.15,
	"claude-3-5-haiku":         0.8,
	"gemini-2.5-flash":         0.075,
	"gpt-5-nano":               0.40,
	"gpt-3.5-turbo":            0.5,
	"claude-3-haiku":           0.25,
	"gemini-1.5-flash":         0.075,
	"minimax-m2.7":             1.5,
	"minimax-m3":               1.5,
	"mistral-medium-3.5":       9.0,
	"llama-4-maverick":         1.1,
	"llama-4-scout":            0.4,
}

func modelTier(model string) int {
	if tier, ok := modelTierMap[model]; ok {
		return tier
	}
	for k, v := range modelTierMap {
		if strings.HasPrefix(model, k) {
			return v
		}
	}
	return 5
}

func modelCost(model string) float64 {
	if cost, ok := modelCostMap[model]; ok {
		return cost
	}
	for k, v := range modelCostMap {
		if strings.HasPrefix(model, k) {
			return v
		}
	}
	return 1.0
}

// ModelCost returns the estimated cost per 1K tokens for the given model.
func ModelCost(model string) float64 {
	return modelCost(model)
}

func (s *Service) ApplyComboSortPreset(comboName string, preset string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	preset = strings.ToLower(strings.TrimSpace(preset))
	if preset != "intelligence" && preset != "speed" && preset != "budget" {
		return fmt.Errorf("unknown sort preset: %s (valid: intelligence, speed, budget)", preset)
	}

	idx := -1
	for i, combo := range s.config.ModelCombos {
		if combo.Name == comboName {
			idx = i
			break
		}
	}
	if idx < 0 {
		return fmt.Errorf("combo not found: %s", comboName)
	}

	steps := s.config.ModelCombos[idx].Steps
	if len(steps) <= 1 {
		return nil
	}

	switch preset {
	case "intelligence":
		sort.SliceStable(steps, func(i, j int) bool {
			return modelTier(steps[i].Model) > modelTier(steps[j].Model)
		})
	case "speed":
		sort.SliceStable(steps, func(i, j int) bool {
			return modelTier(steps[i].Model) < modelTier(steps[j].Model)
		})
	case "budget":
		sort.SliceStable(steps, func(i, j int) bool {
			return modelCost(steps[i].Model) < modelCost(steps[j].Model)
		})
	}

	s.config.ModelCombos[idx].Steps = steps
	s.config.ModelCombos[idx].Models = comboModelsFromSteps(steps)
	return s.saveLocked()
}

func (s *Service) ListModelCombos() []ModelCombo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]ModelCombo, 0, len(s.config.ModelCombos))
	for _, combo := range s.config.ModelCombos {
		combo = normalizeComboForRead(combo)
		result = append(result, combo)
	}
	return result
}

func (s *Service) GetModelCombo(name string) (ModelCombo, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, combo := range s.config.ModelCombos {
		if combo.Name == name {
			combo = normalizeComboForRead(combo)
			return combo, true
		}
	}
	return ModelCombo{}, false
}

// FindComboByModel finds a combo that contains the given model in its steps
func (s *Service) FindComboByModel(model string) *ModelCombo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := range s.config.ModelCombos {
		for _, step := range s.config.ModelCombos[i].Steps {
			if step.Model == model {
				c := s.config.ModelCombos[i]
				c = normalizeComboForRead(c)
				return &c
			}
		}
		for _, m := range s.config.ModelCombos[i].Models {
			if m == model {
				c := s.config.ModelCombos[i]
				c = normalizeComboForRead(c)
				return &c
			}
		}
	}
	return nil
}

func (s *Service) SaveComboTemplate(template ModelCombo) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	template.Name = strings.TrimSpace(template.Name)
	if template.Name == "" {
		return errors.New("template name is required")
	}
	template.Description = strings.TrimSpace(template.Description)
	template.Tags = normalizeTags(template.Tags)
	template.Strategy = strings.TrimSpace(template.Strategy)
	if template.Strategy == "" {
		template.Strategy = "fallback"
	}
	if template.StickyUses <= 0 {
		template.StickyUses = 1
	}
	template.Steps = normalizeComboSteps(template.Steps)
	if len(template.Steps) == 0 && len(template.Models) > 0 {
		models := normalizeModels(template.Models)
		template.Steps = make([]ModelComboStep, 0, len(models))
		for _, model := range models {
			template.Steps = append(template.Steps, ModelComboStep{Model: model})
		}
	}
	template.Models = comboModelsFromSteps(template.Steps)
	if len(template.Steps) == 0 {
		return errors.New("template must contain at least one step")
	}

	for i := range s.config.ComboTemplates {
		if s.config.ComboTemplates[i].Name == template.Name {
			s.config.ComboTemplates[i] = template
			return s.saveLocked()
		}
	}

	s.config.ComboTemplates = append(s.config.ComboTemplates, template)
	return s.saveLocked()
}

func (s *Service) DeleteComboTemplate(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := s.config.ComboTemplates[:0]
	for _, template := range s.config.ComboTemplates {
		if template.Name != name {
			filtered = append(filtered, template)
		}
	}
	s.config.ComboTemplates = filtered
	return s.saveLocked()
}

func (s *Service) RenameComboTemplate(oldName, newName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" {
		return errors.New("template names are required")
	}
	for i := range s.config.ComboTemplates {
		if s.config.ComboTemplates[i].Name == oldName {
			s.config.ComboTemplates[i].Name = newName
			return s.saveLocked()
		}
	}
	return errors.New("template not found")
}

func (s *Service) ListComboTemplates() []ModelCombo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]ModelCombo, 0, len(s.config.ComboTemplates))
	for _, template := range s.config.ComboTemplates {
		result = append(result, normalizeComboForRead(template))
	}
	return result
}

func (s *Service) SaveOAuthProviderConfig(cfg OAuthProviderConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg.ProviderName = strings.TrimSpace(cfg.ProviderName)
	cfg.ClientID = strings.TrimSpace(cfg.ClientID)
	cfg.ClientSecret = strings.TrimSpace(cfg.ClientSecret)
	if cfg.ProviderName == "" {
		return errors.New("provider name is required")
	}
	if cfg.ClientID == "" {
		return errors.New("client id is required")
	}

	for i := range s.config.OAuthProviders {
		if s.config.OAuthProviders[i].ProviderName == cfg.ProviderName {
			s.config.OAuthProviders[i] = cfg
			return s.saveLocked()
		}
	}
	s.config.OAuthProviders = append(s.config.OAuthProviders, cfg)
	return s.saveLocked()
}

func (s *Service) GetOAuthProviderConfig(providerName string) (OAuthProviderConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, cfg := range s.config.OAuthProviders {
		if cfg.ProviderName == providerName {
			return cfg, true
		}
	}
	return OAuthProviderConfig{}, false
}

func (s *Service) ListOAuthProviderConfigs() []OAuthProviderConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]OAuthProviderConfig, 0, len(s.config.OAuthProviders))
	for _, cfg := range s.config.OAuthProviders {
		result = append(result, cfg)
	}
	return result
}

func (s *Service) UpdateChannelHealth(channelID, health string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.channels {
		if s.channels[i].ChannelID == channelID {
			s.channels[i].HealthStatus = health
			return s.saveLocked()
		}
	}
	return nil
}

func (s *Service) UpsertPlatformChannels(channels []Channel) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	customChannels := make([]Channel, 0, len(s.channels))
	for _, ch := range s.channels {
		if ch.ChannelType != "platform" {
			customChannels = append(customChannels, ch)
		}
	}

	for _, ch := range channels {
		ch.ChannelType = "platform"
		if ch.HealthStatus == "" {
			ch.HealthStatus = "healthy"
		}
		customChannels = append(customChannels, ch)
	}
	s.channels = customChannels
	return s.saveLocked()
}

func (s *Service) ClearPlatformChannels() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := s.channels[:0]
	for _, ch := range s.channels {
		if ch.ChannelType != "platform" {
			filtered = append(filtered, ch)
		}
	}
	s.channels = filtered
	if s.config.DefaultChannelID != "" {
		found := false
		for _, ch := range s.channels {
			if ch.ChannelID == s.config.DefaultChannelID {
				found = true
				break
			}
		}
		if !found {
			s.config.DefaultChannelID = ""
		}
	}
	return s.saveLocked()
}

func (s *Service) GetChannel(channelID string) (Channel, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, ch := range s.channels {
		if ch.ChannelID == channelID {
			return ch, true
		}
	}
	return Channel{}, false
}

func (s *Service) FirstEnabledChannel(channelType string) (Channel, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, ch := range s.channels {
		if ch.Enabled && (channelType == "" || ch.ChannelType == channelType) {
			return ch, true
		}
	}
	return Channel{}, false
}

func (s *Service) ResolvePreferredChannel() (Channel, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.config.DefaultChannelID != "" {
		for _, ch := range s.channels {
			if ch.ChannelID == s.config.DefaultChannelID && ch.Enabled {
				return ch, true
			}
		}
	}

	for _, ch := range s.channels {
		if ch.ChannelType == "custom" && ch.Enabled {
			return ch, true
		}
	}
	for _, ch := range s.channels {
		if ch.Enabled {
			return ch, true
		}
	}
	return Channel{}, false
}

func (s *Service) ResolveChannelsForModel(model string) ([]Channel, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	normalizedModel := strings.TrimSpace(model)
	if normalizedModel == "" {
		normalizedModel = strings.TrimSpace(s.config.DefaultModel)
	}

	exact := make([]Channel, 0)
	generic := make([]Channel, 0)
	var preferred *Channel

	for _, ch := range s.channels {
		if !ch.Enabled {
			continue
		}

		if s.config.DefaultChannelID != "" && ch.ChannelID == s.config.DefaultChannelID {
			copyChannel := ch
			preferred = &copyChannel
		}

		if supportsModel(ch, normalizedModel) {
			exact = append(exact, ch)
			continue
		}
		if normalizedModel != "" && len(ch.Models) == 0 {
			generic = append(generic, ch)
		}
	}

	ordered := make([]Channel, 0, len(exact)+len(generic))
	if preferred != nil && preferred.Enabled {
		if supportsModel(*preferred, normalizedModel) || (normalizedModel != "" && len(preferred.Models) == 0) {
			ordered = append(ordered, *preferred)
		}
	}

	appendUnique := func(items []Channel) {
		for _, candidate := range items {
			exists := false
			for _, current := range ordered {
				if current.ChannelID == candidate.ChannelID {
					exists = true
					break
				}
			}
			if !exists {
				ordered = append(ordered, candidate)
			}
		}
	}

	appendUnique(exact)
	appendUnique(generic)

	if len(ordered) == 0 && normalizedModel == "" {
		for _, ch := range s.channels {
			if ch.Enabled {
				ordered = append(ordered, ch)
			}
		}
	}

	return ordered, normalizedModel
}

func (s *Service) UpdateChannelModels(channelID string, models []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.channels {
		if s.channels[i].ChannelID == channelID {
			s.channels[i].Models = append([]string(nil), models...)
			if len(models) > 0 {
				s.channels[i].HealthStatus = "healthy"
			}
			return s.saveLocked()
		}
	}
	return nil
}

func (s *Service) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}

	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = state.Config
	s.channels = state.Channels
	return nil
}

func (s *Service) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}

	channels := make([]Channel, 0, len(s.channels))
	for _, ch := range s.channels {
		ch.APIKey = ""
		channels = append(channels, ch)
	}

	state := persistedState{
		Config:   s.config,
		Channels: channels,
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

func (s *Service) UpdateSetting(key string, value interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	switch key {
	case "locale":
		if v, ok := value.(string); ok {
			s.config.Locale = v
		}
	case "auto_update":
		if v, ok := value.(bool); ok {
			s.config.AutoUpdate = v
		}
	case "analytics_enabled":
		if v, ok := value.(bool); ok {
			s.config.AnalyticsEnabled = v
		}
	case "log_retention_days":
		if v, ok := value.(int); ok {
			s.config.LogRetentionDays = v
		}
	}
	return s.saveLocked()
}

func (s *Service) GetSetting(key string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	switch key {
	case "locale":
		return s.config.Locale
	case "auto_update":
		if s.config.AutoUpdate {
			return "true"
		}
		return "false"
	case "analytics_enabled":
		if s.config.AnalyticsEnabled {
			return "true"
		}
		return "false"
	case "log_retention_days":
		return fmt.Sprintf("%d", s.config.LogRetentionDays)
	}
	return ""
}

func sanitizeChannel(ch Channel) Channel {
	ch.APIKey = ""
	return ch
}

func defaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "seasagi-config.json"
	}
	return filepath.Join(home, "Library", "Application Support", "SeasAGI", "config.json")
}

func generateChannelID() string {
	replacer := strings.NewReplacer(" ", "-", "_", "-")
	return "ch_" + replacer.Replace(strings.ToLower(time.Now().Format("20060102150405.000000")))
}

func supportsModel(ch Channel, model string) bool {
	if model == "" {
		return true
	}
	for _, candidate := range ch.Models {
		if candidate == model {
			return true
		}
	}
	return false
}

func normalizeModels(models []string) []string {
	result := make([]string, 0, len(models))
	seen := map[string]struct{}{}
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		result = append(result, model)
	}
	return result
}

func normalizeComboSteps(steps []ModelComboStep) []ModelComboStep {
	result := make([]ModelComboStep, 0, len(steps))
	seen := map[string]struct{}{}
	for _, step := range steps {
		step.ChannelID = strings.TrimSpace(step.ChannelID)
		step.Model = strings.TrimSpace(step.Model)
		if step.Model == "" {
			continue
		}
		key := step.ChannelID + "::" + step.Model
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, step)
	}
	return result
}

func comboModelsFromSteps(steps []ModelComboStep) []string {
	models := make([]string, 0, len(steps))
	for _, step := range steps {
		if step.Model != "" {
			models = append(models, step.Model)
		}
	}
	return models
}

func normalizeComboForRead(combo ModelCombo) ModelCombo {
	combo.Steps = normalizeComboSteps(combo.Steps)
	combo.Description = strings.TrimSpace(combo.Description)
	combo.Tags = normalizeTags(combo.Tags)
	if len(combo.Steps) == 0 && len(combo.Models) > 0 {
		models := normalizeModels(combo.Models)
		for _, model := range models {
			combo.Steps = append(combo.Steps, ModelComboStep{Model: model})
		}
	}
	combo.Models = comboModelsFromSteps(combo.Steps)
	return combo
}

func normalizeTags(tags []string) []string {
	result := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}
	return result
}
