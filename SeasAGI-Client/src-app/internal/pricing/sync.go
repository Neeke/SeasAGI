package pricing

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ModelPricing 模型定价信息。
type ModelPricing struct {
	Model          string  // 模型名
	Provider       string  // 提供商
	InputPer1M     float64 // 输入 $/1M tokens
	OutputPer1M    float64 // 输出 $/1M tokens
	PerImage       float64 // 每张图片
	PerVideoSecond float64 // 每秒视频
	PerCharacter   float64 // 每字符
	SearchUnit     float64 // 每搜索单元
	OCRSpecPerPage float64 // 每页 OCR
}

// LiteLLMProviderMap LiteLLM provider 名到 SeasAGI provider 名的映射。
var LiteLLMProviderMap = map[string]string{
	"openai": "openai",
	"anthropic": "anthropic",
	"google": "gemini",
	"mistral": "mistral",
	"deepseek": "deepseek",
	"meta-llama": "meta",
	"cohere": "cohere",
	"ai21": "ai21",
	"together_ai": "together",
	"fireworks_ai": "fireworks",
	"groq": "groq",
	"perplexity": "perplexity",
	"azure_ai": "azure",
	"amazon": "aws",
	"ai21.ai21": "ai21",
	"meta.llama": "meta",
	"amazon.nova": "aws",
	"google.gemini": "gemini",
	"mistral.mistral": "mistral",
	"cohere.command": "cohere",
}

// PricingSyncManager 定价同步管理器。
type PricingSyncManager struct {
	mu               sync.RWMutex
	syncedPrices     map[string]ModelPricing   // synced key → pricing
	userOverrides    map[string]ModelPricing   // user override key → pricing
	hardcodedDefaults map[string]ModelPricing   // hardcoded key → pricing
	syncStatus       SyncStatus
	httpClient       *http.Client
	sourceURL        string
}

// SyncStatus 同步状态。
type SyncStatus struct {
	LastSyncAt   time.Time
	Success      bool
	ModelsSynced int
	Error        string
}

// NewPricingSyncManager 创建定价同步管理器。
func NewPricingSyncManager(sourceURL string) *PricingSyncManager {
	if sourceURL == "" {
		sourceURL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
	}
	return &PricingSyncManager{
		syncedPrices:      make(map[string]ModelPricing),
		userOverrides:     make(map[string]ModelPricing),
		hardcodedDefaults: make(map[string]ModelPricing),
		httpClient:        &http.Client{Timeout: 30 * time.Second},
		sourceURL:         sourceURL,
	}
}

// SetUserOverride 设置用户定价覆盖。
func (m *PricingSyncManager) SetUserOverride(model string, pricing ModelPricing) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.userOverrides[strings.ToLower(model)] = pricing
}

// SetHardcodedDefault 设置硬编码默认定价。
func (m *PricingSyncManager) SetHardcodedDefault(model string, pricing ModelPricing) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hardcodedDefaults[strings.ToLower(model)] = pricing
}

// GetPricing 获取模型定价（三层解析：用户覆盖 > 同步外部 > 硬编码默认）。
func (m *PricingSyncManager) GetPricing(model string) (ModelPricing, bool) {
	key := strings.ToLower(model)
	m.mu.RLock()
	defer m.mu.RUnlock()

	// 第一层：用户覆盖
	if p, ok := m.userOverrides[key]; ok {
		return p, true
	}
	// 第二层：同步外部
	if p, ok := m.syncedPrices[key]; ok {
		return p, true
	}
	// 第三层：硬编码默认
	if p, ok := m.hardcodedDefaults[key]; ok {
		return p, true
	}
	return ModelPricing{}, false
}

// FetchAndSync 从 LiteLLM 拉取并同步定价。
func (m *PricingSyncManager) FetchAndSync() error {
	resp, err := m.httpClient.Get(m.sourceURL)
	if err != nil {
		m.mu.Lock()
		m.syncStatus = SyncStatus{Success: false, Error: err.Error()}
		m.mu.Unlock()
		return fmt.Errorf("fetch pricing: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pricing source returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read pricing body: %w", err)
	}

	// 解析 LiteLLM 格式
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return fmt.Errorf("parse pricing JSON: %w", err)
	}

	count := 0
	synced := make(map[string]ModelPricing)
	for modelName, data := range raw {
		if modelName == "sample_spec" {
			continue
		}
		var spec liteLLMSpec
		if err := json.Unmarshal(data, &spec); err != nil {
			continue
		}
		pricing := transformToPricing(modelName, spec)
		synced[strings.ToLower(modelName)] = pricing
		count++
	}

	m.mu.Lock()
	m.syncedPrices = synced
	m.syncStatus = SyncStatus{LastSyncAt: time.Now(), Success: true, ModelsSynced: count}
	m.mu.Unlock()

	return nil
}

// liteLLMSpec LiteLLM 定价格式。
type liteLLMSpec struct {
	InputPricePerToken  float64 `json:"input_cost_per_token"`
	OutputPricePerToken float64 `json:"output_cost_per_token"`
	Provider            string  `json:"litellm_provider"`
	// 非 token 计价维度
	PerImage       float64 `json:"output_cost_per_image"`
	PerVideoSecond float64 `json:"output_cost_per_video_second"`
	PerCharacter   float64 `json:"output_cost_per_character"`
	SearchUnit     float64 `json:"output_cost_per_search_unit"`
	OCRSpecPerPage float64 `json:"output_cost_per_ocr_page"`
}

// transformToPricing 将 LiteLLM spec 转换为 ModelPricing。
func transformToPricing(modelName string, spec liteLLMSpec) ModelPricing {
	provider := spec.Provider
	if mapped, ok := LiteLLMProviderMap[provider]; ok {
		provider = mapped
	}

	return ModelPricing{
		Model:          modelName,
		Provider:       provider,
		InputPer1M:     spec.InputPricePerToken * 1_000_000,
		OutputPer1M:    spec.OutputPricePerToken * 1_000_000,
		PerImage:       spec.PerImage,
		PerVideoSecond: spec.PerVideoSecond,
		PerCharacter:   spec.PerCharacter,
		SearchUnit:     spec.SearchUnit,
		OCRSpecPerPage: spec.OCRSpecPerPage,
	}
}

// GetSyncStatus 返回同步状态。
func (m *PricingSyncManager) GetSyncStatus() SyncStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.syncStatus
}

// GetSyncedCount 返回已同步的模型数。
func (m *PricingSyncManager) GetSyncedCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.syncedPrices)
}

// StartPeriodicSync 启动定时同步。
func (m *PricingSyncManager) StartPeriodicSync(interval time.Duration) (stop func()) {
	if interval <= 0 {
		interval = 86400 * time.Second // 默认 24h
	}

	ticker := time.NewTicker(interval)
	done := make(chan struct{})

	go func() {
		// 启动时立即同步一次
		_ = m.FetchAndSync()
		for {
			select {
			case <-ticker.C:
				_ = m.FetchAndSync()
			case <-done:
				ticker.Stop()
				return
			}
		}
	}()

	return func() { close(done) }
}
