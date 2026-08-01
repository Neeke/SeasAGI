package providers

import "strings"

// FamilyFallbackMap 模型家族回退映射
type FamilyFallbackMap struct {
	families map[string][]string
}

// NewFamilyFallbackMap 创建内置模型家族回退映射
func NewFamilyFallbackMap() *FamilyFallbackMap {
	m := &FamilyFallbackMap{families: make(map[string][]string)}
	// OpenAI 家族
	m.AddFamily("gpt-4", []string{"gpt-4-turbo", "gpt-4o"})
	m.AddFamily("gpt-4o", []string{"gpt-4o-mini", "gpt-4-turbo"})
	m.AddFamily("gpt-4o-mini", []string{"gpt-4o", "gpt-5-nano"})
	m.AddFamily("gpt-5", []string{"gpt-5-mini", "gpt-4o"})
	m.AddFamily("gpt-5-mini", []string{"gpt-5-nano", "gpt-4o-mini"})
	// Anthropic 家族
	m.AddFamily("claude-3-opus", []string{"claude-3-5-sonnet", "claude-3-sonnet"})
	m.AddFamily("claude-4-opus", []string{"claude-4-sonnet", "claude-3-5-sonnet"})
	m.AddFamily("claude-4-sonnet", []string{"claude-3-5-sonnet", "claude-3-haiku"})
	m.AddFamily("claude-3-5-sonnet", []string{"claude-3-haiku", "claude-3-sonnet"})
	m.AddFamily("claude-3-sonnet", []string{"claude-3-haiku"})
	m.AddFamily("claude-3-haiku", []string{"claude-3-5-sonnet"})
	// Google 家族
	m.AddFamily("gemini-1.5-pro", []string{"gemini-1.5-flash", "gemini-2.0-flash"})
	m.AddFamily("gemini-2.0-flash", []string{"gemini-1.5-flash", "gemini-2.5-flash"})
	m.AddFamily("gemini-2.5-pro", []string{"gemini-2.5-flash", "gemini-1.5-pro"})
	m.AddFamily("gemini-2.5-flash", []string{"gemini-2.0-flash", "gemini-1.5-flash"})
	// DeepSeek 家族
	m.AddFamily("deepseek-chat", []string{"deepseek-v4-flash", "deepseek-coder"})
	m.AddFamily("deepseek-v4-pro", []string{"deepseek-v4-flash", "deepseek-chat"})
	m.AddFamily("deepseek-coder", []string{"deepseek-v4-flash", "deepseek-chat"})
	// 通义千问家族
	m.AddFamily("qwen-max", []string{"qwen-plus"})
	m.AddFamily("qwen-plus", []string{"qwen-turbo", "qwen-max"})
	// Mistral 家族
	m.AddFamily("mistral-large", []string{"mistral-medium", "mistral-small"})
	// Llama 家族
	m.AddFamily("llama-3.1-405b", []string{"llama-3.1-70b"})
	m.AddFamily("llama-3.1-70b", []string{"llama-3.1-8b"})
	return m
}

// AddFamily 添加模型家族映射
func (m *FamilyFallbackMap) AddFamily(model string, fallbacks []string) {
	model = strings.ToLower(model)
	for i, f := range fallbacks {
		fallbacks[i] = strings.ToLower(f)
	}
	m.families[model] = fallbacks
}

// GetFallbacks 获取模型的家族回退列表
func (m *FamilyFallbackMap) GetFallbacks(model string) []string {
	model = strings.ToLower(model)
	if fallbacks, ok := m.families[model]; ok {
		return fallbacks
	}
	return nil
}

// HasFamily 检查模型是否有家族回退
func (m *FamilyFallbackMap) HasFamily(model string) bool {
	model = strings.ToLower(model)
	_, ok := m.families[model]
	return ok
}

// FindClosestMatch 从可用模型列表中找到最接近的家族成员
func (m *FamilyFallbackMap) FindClosestMatch(model string, available []string) string {
	fallbacks := m.GetFallbacks(model)
	if fallbacks == nil {
		return ""
	}
	availMap := make(map[string]bool)
	for _, a := range available {
		availMap[strings.ToLower(a)] = true
	}
	for _, f := range fallbacks {
		if availMap[f] {
			return f
		}
	}
	return ""
}
