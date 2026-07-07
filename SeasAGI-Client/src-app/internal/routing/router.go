package routing

import (
	"crypto/sha1"
	"fmt"
	"sync"
	"time"

	"seasagi/internal/config"
)

type RoutingError struct {
	Type    string
	Message string
}

func (e *RoutingError) Error() string {
	return e.Message
}

type Resolver struct {
	mu        sync.Mutex
	state     map[string]rotationState
	sessions  map[string]sessionEntry
	configSvc *config.Service
}

type PlanStep struct {
	Channel       config.Channel
	UpstreamModel string
	StepRole      string `json:"step_role,omitempty"` // primary / backup / last_resort
}

type rotationState struct {
	Index int
	Count int
}

type sessionEntry struct {
	Step      PlanStep
	ExpiresAt time.Time
}

const (
	sessionTTL      = 30 * time.Minute
	cleanupInterval = 10 * time.Minute
)

func NewResolver(configSvc *config.Service) *Resolver {
	r := &Resolver{
		state:     map[string]rotationState{},
		sessions:  map[string]sessionEntry{},
		configSvc: configSvc,
	}
	go r.cleanupLoop()
	return r
}

func (r *Resolver) cleanupLoop() {
	ticker := time.NewTicker(cleanupInterval)
	for range ticker.C {
		r.mu.Lock()
		now := time.Now()
		for key, entry := range r.sessions {
			if now.After(entry.ExpiresAt) {
				delete(r.sessions, key)
			}
		}
		r.mu.Unlock()
	}
}

func (r *Resolver) GetSessionKey(messages []map[string]any) string {
	for _, msg := range messages {
		role, _ := msg["role"].(string)
		if role == "user" {
			content, _ := msg["content"].(string)
			if content == "" {
				if arr, ok := msg["content"].([]any); ok && len(arr) > 0 {
					if first, ok := arr[0].(map[string]any); ok {
						content, _ = first["text"].(string)
					}
				}
			}
			if content != "" {
				h := sha1.Sum([]byte(content))
				return fmt.Sprintf("%x", h[:8])
			}
			break
		}
	}
	return ""
}

func (r *Resolver) RecordSessionStep(sessionKey string, step PlanStep) {
	if sessionKey == "" {
		return
	}
	r.mu.Lock()
	r.sessions[sessionKey] = sessionEntry{
		Step:      step,
		ExpiresAt: time.Now().Add(sessionTTL),
	}
	r.mu.Unlock()
}

func (r *Resolver) GetSessionStep(sessionKey string) (PlanStep, bool) {
	if sessionKey == "" {
		return PlanStep{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, exists := r.sessions[sessionKey]
	if !exists || time.Now().After(entry.ExpiresAt) {
		if exists {
			delete(r.sessions, sessionKey)
		}
		return PlanStep{}, false
	}
	return entry.Step, true
}

func (r *Resolver) ReorderBySession(candidates []PlanStep, sessionKey string) []PlanStep {
	if sessionKey == "" || len(candidates) <= 1 {
		return candidates
	}

	lastStep, exists := r.GetSessionStep(sessionKey)
	if !exists {
		return candidates
	}

	preferredIdx := -1
	for i, step := range candidates {
		if step.Channel.ChannelID == lastStep.Channel.ChannelID &&
			step.UpstreamModel == lastStep.UpstreamModel {
			preferredIdx = i
			break
		}
	}

	if preferredIdx <= 0 {
		return candidates
	}

	ordered := make([]PlanStep, 0, len(candidates))
	ordered = append(ordered, candidates[preferredIdx])
	ordered = append(ordered, candidates[:preferredIdx]...)
	ordered = append(ordered, candidates[preferredIdx+1:]...)
	return ordered
}

// ResolveChatPlan resolves a model (or combo) into an ordered list of PlanSteps.
// taskType indicates the type of request: "chat", "tools", "json", "long_context".
func (r *Resolver) ResolveChatPlan(model string, taskType string) (string, []PlanStep, error) {
	if combo, ok := r.configSvc.GetModelCombo(model); ok {
		steps := r.resolveComboSteps(combo)
		if len(steps) == 0 {
			return combo.Name, nil, &RoutingError{Type: "routing_error", Message: fmt.Sprintf("combo %q has no available routes", combo.Name)}
		}

		// Apply task-type-specific sorting
		steps = r.sortByTaskType(steps, taskType)

		strategy := combo.Strategy
		if strategy == "" {
			strategy = r.configSvc.GetConfig().RoutingStrategy
		}
		if strategy != "round_robin" || len(steps) <= 1 {
			return combo.Name, steps, nil
		}
		return combo.Name, r.rotateSteps(combo.Name, steps, combo.StickyUses), nil
	}

	candidates, normalizedModel := r.configSvc.ResolveChannelsForModel(model)
	if len(candidates) == 0 {
		if normalizedModel == "" {
			return "", nil, &RoutingError{Type: "routing_error", Message: "no enabled channel configured"}
		}
		return normalizedModel, nil, &RoutingError{Type: "routing_error", Message: fmt.Sprintf("no enabled channel can serve model %q", normalizedModel)}
	}

	steps := make([]PlanStep, 0, len(candidates))
	for _, candidate := range candidates {
		steps = append(steps, PlanStep{
			Channel:       candidate,
			UpstreamModel: normalizedModel,
		})
	}

	// Apply task-type-specific sorting for non-combo paths
	steps = r.sortByTaskType(steps, taskType)

	cfg := r.configSvc.GetConfig()
	if cfg.RoutingStrategy != "round_robin" || len(steps) <= 1 {
		return normalizedModel, steps, nil
	}

	return normalizedModel, r.rotateSteps(normalizedModel, steps, cfg.StickyChannelUse), nil
}

func (r *Resolver) resolveComboSteps(combo config.ModelCombo) []PlanStep {
	steps := make([]PlanStep, 0, len(combo.Steps))
	for i, comboStep := range combo.Steps {
		role := comboStep.StepRole
		if role == "" {
			switch i {
			case 0:
				role = "primary"
			case len(combo.Steps) - 1:
				role = "last_resort"
			default:
				role = "backup"
			}
		}

		// Expand step-internal candidates from providers[] or channels[]
		candidates := r.expandStepCandidates(comboStep)
		if len(candidates) == 0 {
			// Fall back to single-channel resolution
			_ = r.appendSingleChannelStep(&steps, comboStep, role)
			continue
		}

		// Apply selection policy to order candidates within this step
		candidates = r.sortCandidatesByPolicy(candidates, comboStep.SelectionPolicy)

		// Add all expanded candidates as individual PlanSteps, each tagged with step index
		for _, candidate := range candidates {
			step := PlanStep{
				Channel:       candidate.channel,
				UpstreamModel: candidate.model,
				StepRole:      role,
			}
			steps = append(steps, step)
		}
	}
	return steps
}

type expandedCandidate struct {
	channel config.Channel
	model   string
}

// expandStepCandidates expands a step's providers[] or channels[] into concrete candidates
func (r *Resolver) expandStepCandidates(step config.ModelComboStep) []expandedCandidate {
	if len(step.Providers) > 0 {
		candidates := make([]expandedCandidate, 0, len(step.Providers))
		for _, provider := range step.Providers {
			ch, ok := r.configSvc.GetChannel(provider.ChannelID)
			if !ok || !ch.Enabled {
				continue
			}
			model := provider.Model
			if model == "" {
				model = step.Model
			}
			candidates = append(candidates, expandedCandidate{
				channel: ch,
				model:   model,
			})
		}
		// Sort by provider priority (lower number = higher priority)
		if len(candidates) > 1 {
			priorityMap := make(map[string]int, len(step.Providers))
			for _, p := range step.Providers {
				priorityMap[p.ChannelID+"\x00"+p.Model] = p.Priority
			}
			// Only sort if priorities are set
			hasPriority := false
			for _, p := range step.Providers {
				if p.Priority != 0 {
					hasPriority = true
					break
				}
			}
			if hasPriority {
				sorted := make([]expandedCandidate, len(candidates))
				copy(sorted, candidates)
				for i := 0; i < len(sorted); i++ {
					for j := i + 1; j < len(sorted); j++ {
						pi := priorityMap[sorted[i].channel.ChannelID+"\x00"+sorted[i].model]
						pj := priorityMap[sorted[j].channel.ChannelID+"\x00"+sorted[j].model]
						if pi > pj {
							sorted[i], sorted[j] = sorted[j], sorted[i]
						}
					}
				}
				candidates = sorted
			}
		}
		return candidates
	}

	if len(step.Channels) > 0 {
		candidates := make([]expandedCandidate, 0, len(step.Channels))
		for _, channelID := range step.Channels {
			ch, ok := r.configSvc.GetChannel(channelID)
			if !ok || !ch.Enabled {
				continue
			}
			// Use the channel's model or the step model
			model := step.Model
			if model == "" && len(ch.Models) > 0 {
				model = ch.Models[0]
			}
			candidates = append(candidates, expandedCandidate{
				channel: ch,
				model:   model,
			})
		}
		return candidates
	}

	return nil
}

// sortCandidatesByPolicy reorders candidates based on the selection policy
// stability: prefer channels with "healthy" status first
// cost: prefer channels with lower cost (via provider_type heuristics)
// latency: prefer channels with faster response (by type - platform vs custom)
// throughput: prefer channels with higher model availability
func (r *Resolver) sortCandidatesByPolicy(candidates []expandedCandidate, policy string) []expandedCandidate {
	if len(candidates) <= 1 || policy == "" {
		return candidates
	}

	sorted := make([]expandedCandidate, len(candidates))
	copy(sorted, candidates)

	switch policy {
	case "stability":
		// Healthy channels first, then unknown, then unhealthy last
		for i := 0; i < len(sorted); i++ {
			for j := i + 1; j < len(sorted); j++ {
				hi := healthScore(sorted[i].channel.HealthStatus)
				hj := healthScore(sorted[j].channel.HealthStatus)
				if hi < hj {
					sorted[i], sorted[j] = sorted[j], sorted[i]
				}
			}
		}
	case "cost":
		// Custom channels typically cheaper than platform
		for i := 0; i < len(sorted); i++ {
			for j := i + 1; j < len(sorted); j++ {
				ci := costScore(sorted[i].channel.ChannelType)
				cj := costScore(sorted[j].channel.ChannelType)
				if ci > cj {
					sorted[i], sorted[j] = sorted[j], sorted[i]
				}
			}
		}
	case "latency":
		// Custom channels first (typically lower latency)
		for i := 0; i < len(sorted); i++ {
			for j := i + 1; j < len(sorted); j++ {
				li := latencyScore(sorted[i].channel.ChannelType)
				lj := latencyScore(sorted[j].channel.ChannelType)
				if li > lj {
					sorted[i], sorted[j] = sorted[j], sorted[i]
				}
			}
		}
	case "throughput":
		// Platform channels often have higher throughput
		for i := 0; i < len(sorted); i++ {
			for j := i + 1; j < len(sorted); j++ {
				ti := throughputScore(sorted[i].channel.ChannelType)
				tj := throughputScore(sorted[j].channel.ChannelType)
				if ti < tj {
					sorted[i], sorted[j] = sorted[j], sorted[i]
				}
			}
		}
	}

	return sorted
}

func healthScore(status string) int {
	switch status {
	case "healthy":
		return 2
	case "unknown":
		return 1
	default:
		return 0
	}
}

func costScore(channelType string) int {
	// custom channels are typically cheaper than platform channels
	if channelType == "custom" {
		return 2
	}
	return 1
}

func latencyScore(channelType string) int {
	// custom channels are typically lower latency
	if channelType == "custom" {
		return 2
	}
	return 1
}

func throughputScore(channelType string) int {
	// platform channels typically have higher throughput
	if channelType == "platform" {
		return 2
	}
	return 1
}

func (r *Resolver) appendSingleChannelStep(steps *[]PlanStep, comboStep config.ModelComboStep, role string) bool {
	if comboStep.ChannelID != "" {
		if channel, ok := r.configSvc.GetChannel(comboStep.ChannelID); ok && channel.Enabled {
			*steps = append(*steps, PlanStep{
				Channel:       channel,
				UpstreamModel: comboStep.Model,
				StepRole:      role,
			})
			return true
		}
	}

	channels, normalizedModel := r.configSvc.ResolveChannelsForModel(comboStep.Model)
	if normalizedModel == "" {
		normalizedModel = comboStep.Model
	}
	if len(channels) == 0 {
		return false
	}
	*steps = append(*steps, PlanStep{
		Channel:       channels[0],
		UpstreamModel: normalizedModel,
		StepRole:      role,
	})
	return true
}

func (r *Resolver) rotateSteps(model string, candidates []PlanStep, stickyLimit int) []PlanStep {
	if stickyLimit <= 0 {
		stickyLimit = 1
	}

	key := model
	if key == "" {
		key = "__default__"
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	current := r.state[key]
	index := 0
	if len(candidates) > 0 {
		index = current.Index % len(candidates)
	}

	ordered := make([]PlanStep, 0, len(candidates))
	ordered = append(ordered, candidates[index:]...)
	ordered = append(ordered, candidates[:index]...)

	current.Count++
	if current.Count >= stickyLimit {
		current.Index = (index + 1) % len(candidates)
		current.Count = 0
	} else {
		current.Index = index
	}
	r.state[key] = current
	return ordered
}

// sortByTaskType reorders plan steps based on the request task type.
// For "tools" requests, channels with better tool-calling support are prioritized first.
// For other task types, the original order is preserved.
func (r *Resolver) sortByTaskType(steps []PlanStep, taskType string) []PlanStep {
	if len(steps) <= 1 || taskType == "" || taskType == "chat" {
		return steps
	}

	switch taskType {
	case "tools":
		// For tools requests, prioritize channels known for good tool-calling support
		// OpenAI, Anthropic, and other tool-capable providers first
		toolFriendly := make([]PlanStep, 0, len(steps))
		others := make([]PlanStep, 0, len(steps))
		for _, step := range steps {
			pt := step.Channel.ProviderType
			if pt == "openai" || pt == "anthropic" || pt == "google" || pt == "openrouter" {
				toolFriendly = append(toolFriendly, step)
			} else {
				others = append(others, step)
			}
		}
		return append(toolFriendly, others...)

	case "json", "structured_output":
		// For JSON/structured output, prefer providers with reliable JSON mode
		jsonFriendly := make([]PlanStep, 0, len(steps))
		others := make([]PlanStep, 0, len(steps))
		for _, step := range steps {
			pt := step.Channel.ProviderType
			if pt == "openai" || pt == "anthropic" || pt == "google" {
				jsonFriendly = append(jsonFriendly, step)
			} else {
				others = append(others, step)
			}
		}
		return append(jsonFriendly, others...)

	case "long_context":
		// For long context, prefer providers/platform channels known for large context windows
		longCtx := make([]PlanStep, 0, len(steps))
		others := make([]PlanStep, 0, len(steps))
		for _, step := range steps {
			if step.Channel.ChannelType == "platform" {
				longCtx = append(longCtx, step)
			} else {
				others = append(others, step)
			}
		}
		return append(longCtx, others...)

	default:
		return steps
	}
}
