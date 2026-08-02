package mitm

import "strings"

// TargetDescriptor 声明式 MITM 目标描述符。
type TargetDescriptor struct {
	ID              string
	Name            string
	Icon            string
	Color           string
	Hosts           []string
	Port            int
	EndpointPatterns []string
	DefaultModels   []TargetModel
	Viability       string // "supported" / "investigating" / "deprecated"
}

// TargetModel 目标支持的默认模型。
type TargetModel struct {
	ID    string
	Name  string
	Alias string
}

// ZedTarget Zed IDE MITM 目标。
var ZedTarget = TargetDescriptor{
	ID:               "zed",
	Name:             "Zed",
	Icon:             "bolt",
	Color:            "#EF4444",
	Hosts:            []string{"api.zed.dev"},
	Port:             443,
	EndpointPatterns: []string{"/v1/chat/completions"},
	DefaultModels: []TargetModel{
		{ID: "claude-3.5-sonnet", Name: "Claude 3.5 Sonnet", Alias: "claude-3.5-sonnet"},
		{ID: "gpt-4o", Name: "GPT-4o", Alias: "gpt-4o"},
	},
	Viability: "supported",
}

// CursorTarget Cursor IDE MITM 目标。
var CursorTarget = TargetDescriptor{
	ID:               "cursor",
	Name:             "Cursor",
	Icon:             "cursor",
	Color:            "#000000",
	Hosts:            []string{"api2.cursor.sh"},
	Port:             443,
	EndpointPatterns: []string{"/copilot/chat/completions", "/chat/completions"},
	DefaultModels: []TargetModel{
		{ID: "claude-3.5-sonnet", Name: "Claude 3.5 Sonnet", Alias: "claude-3.5-sonnet"},
		{ID: "gpt-4o", Name: "GPT-4o", Alias: "gpt-4o"},
	},
	Viability: "supported",
}

// CodexTarget Codex CLI MITM 目标。
var CodexTarget = TargetDescriptor{
	ID:               "codex",
	Name:             "Codex",
	Icon:             "terminal",
	Color:            "#10A37F",
	Hosts:            []string{"api.openai.com"},
	Port:             443,
	EndpointPatterns: []string{"/v1/responses", "/v1/chat/completions"},
	DefaultModels: []TargetModel{
		{ID: "gpt-4o", Name: "GPT-4o", Alias: "gpt-4o"},
		{ID: "o3", Name: "o3", Alias: "o3"},
	},
	Viability: "supported",
}

// CopilotTarget GitHub Copilot MITM 目标。
var CopilotTarget = TargetDescriptor{
	ID:               "copilot",
	Name:             "GitHub Copilot",
	Icon:             "copilot",
	Color:            "#24292E",
	Hosts:            []string{"api.githubcopilot.com"},
	Port:             443,
	EndpointPatterns: []string{"/chat/completions", "/v1/chat/completions"},
	DefaultModels: []TargetModel{
		{ID: "gpt-4o", Name: "GPT-4o", Alias: "gpt-4o"},
		{ID: "claude-3.5-sonnet", Name: "Claude 3.5 Sonnet", Alias: "claude-3.5-sonnet"},
	},
	Viability: "supported",
}

// ClaudeCodeTarget Claude Code MITM 目标。
var ClaudeCodeTarget = TargetDescriptor{
	ID:               "claude-code",
	Name:             "Claude Code",
	Icon:             "code",
	Color:            "#D97757",
	Hosts:            []string{"api.anthropic.com"},
	Port:             443,
	EndpointPatterns: []string{"/v1/messages"},
	DefaultModels: []TargetModel{
		{ID: "claude-3.5-sonnet", Name: "Claude 3.5 Sonnet", Alias: "claude-3.5-sonnet"},
		{ID: "claude-3-opus", Name: "Claude 3 Opus", Alias: "claude-3-opus"},
	},
	Viability: "supported",
}

// TraeTarget Trae IDE MITM 目标。
var TraeTarget = TargetDescriptor{
	ID:               "trae",
	Name:             "Trae",
	Icon:             "trae",
	Color:            "#7C3AED",
	Hosts:            []string{"api.trae.ai"},
	Port:             443,
	EndpointPatterns: []string{"/v1/chat/completions"},
	DefaultModels: []TargetModel{
		{ID: "claude-3.5-sonnet", Name: "Claude 3.5 Sonnet", Alias: "claude-3.5-sonnet"},
	},
	Viability: "investigating",
}

// AllTargets 所有 MITM 目标列表（有序）。
var AllTargets = []TargetDescriptor{
	CursorTarget,
	CopilotTarget,
	CodexTarget,
	ZedTarget,
	ClaudeCodeTarget,
	TraeTarget,
}

// ResolveTarget 根据 hostname 查找目标（大小写不敏感精确匹配）。
func ResolveTarget(hostname string) *TargetDescriptor {
	if hostname == "" {
		return nil
	}
	h := strings.ToLower(hostname)
	for i := range AllTargets {
		for _, host := range AllTargets[i].Hosts {
			if strings.ToLower(host) == h {
				return &AllTargets[i]
			}
		}
	}
	return nil
}

// ConnectionRoute 路由决策。
type ConnectionRoute struct {
	Kind   string // "bypass" / "target" / "passthrough"
	Target *TargetDescriptor
}

// RouteConnection 决定 CONNECT/TLS 连接的路由。
// 优先级：bypass list > known target host > passthrough。
func RouteConnection(hostname string, bypassList []string) ConnectionRoute {
	for _, b := range bypassList {
		if strings.EqualFold(b, hostname) {
			return ConnectionRoute{Kind: "bypass"}
		}
	}

	target := ResolveTarget(hostname)
	if target != nil {
		return ConnectionRoute{Kind: "target", Target: target}
	}

	return ConnectionRoute{Kind: "passthrough"}
}

// GetTargetByID 根据 ID 获取目标。
func GetTargetByID(id string) *TargetDescriptor {
	for i := range AllTargets {
		if AllTargets[i].ID == id {
			return &AllTargets[i]
		}
	}
	return nil
}

// IsEndpointMatch 检查请求路径是否匹配目标的 endpoint patterns。
func IsEndpointMatch(target *TargetDescriptor, path string) bool {
	for _, pattern := range target.EndpointPatterns {
		if strings.HasPrefix(path, pattern) {
			return true
		}
	}
	return false
}
