package security

import (
	"regexp"
)

// PIIMasker detects and masks Personally Identifiable Information (PII).
// All masking is opt-in — the caller decides whether to enable it.
type PIIMasker struct {
	enabled    bool
	patterns   []PIIPattern
}

// PIIPattern defines a PII type and its masking rule.
type PIIPattern struct {
	Name    string
	Pattern *regexp.Regexp
	Mask    string // replacement template, uses $1 for capture group if needed
}

// NewPIIMasker creates a masker with built-in patterns for common PII types.
func NewPIIMasker(enabled bool) *PIIMasker {
	m := &PIIMasker{
		enabled: enabled,
		patterns: []PIIPattern{
			{
				Name:    "email",
				Pattern: regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`),
				Mask:    "[EMAIL]",
			},
			{
				Name:    "phone_intl",
				Pattern: regexp.MustCompile(`\+\d{1,3}[\s.-]?\d{1,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}`),
				Mask:    "[PHONE]",
			},
			{
				Name:    "phone_us",
				Pattern: regexp.MustCompile(`\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b`),
				Mask:    "[PHONE]",
			},
			{
				Name:    "credit_card_visa",
				Pattern: regexp.MustCompile(`\b4\d{3}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b`),
				Mask:    "[CREDIT_CARD]",
			},
			{
				Name:    "credit_card_mc",
				Pattern: regexp.MustCompile(`\b5[1-5]\d{2}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b`),
				Mask:    "[CREDIT_CARD]",
			},
			{
				Name:    "credit_card_amex",
				Pattern: regexp.MustCompile(`\b3[47]\d{2}[\s.-]?\d{6}[\s.-]?\d{5}\b`),
				Mask:    "[CREDIT_CARD]",
			},
			{
				Name:    "ssn_us",
				Pattern: regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`),
				Mask:    "[SSN]",
			},
			{
				Name:    "id_cn",
				Pattern: regexp.MustCompile(`\b\d{15}(\d{2}[\dXx])?\b`),
				Mask:    "[ID_NUMBER]",
			},
			{
				Name:    "ipv4",
				Pattern: regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`),
				Mask:    "[IP]",
			},
			{
				Name:    "api_key_sk",
				Pattern: regexp.MustCompile(`\bsk-[a-zA-Z0-9]{20,}\b`),
				Mask:    "[API_KEY]",
			},
		},
	}
	return m
}

// Mask applies all PII patterns to the input text and returns the masked result.
// If the masker is disabled, the original text is returned unchanged.
func (m *PIIMasker) Mask(input string) string {
	if !m.enabled {
		return input
	}
	result := input
	for _, p := range m.patterns {
		result = p.Pattern.ReplaceAllString(result, p.Mask)
	}
	return result
}

// MaskMessages masks PII in all message contents.
func (m *PIIMasker) MaskMessages(messages []map[string]interface{}) {
	if !m.enabled {
		return
	}
	for _, msg := range messages {
		if content, ok := msg["content"].(string); ok {
			msg["content"] = m.Mask(content)
		}
	}
}

// IsEnabled returns whether the masker is active.
func (m *PIIMasker) IsEnabled() bool {
	return m.enabled
}

// SetEnabled enables or disables the masker.
func (m *PIIMasker) SetEnabled(enabled bool) {
	m.enabled = enabled
}

// AddPattern adds a custom PII pattern.
func (m *PIIMasker) AddPattern(name, pattern, mask string) error {
	p, err := regexp.Compile(pattern)
	if err != nil {
		return err
	}
	m.patterns = append(m.patterns, PIIPattern{Name: name, Pattern: p, Mask: mask})
	return nil
}

// DetectedPII returns the types of PII found in the input without masking.
type DetectedPII struct {
	Type  string
	Value string
}

// Detect returns a list of detected PII items in the input.
func (m *PIIMasker) Detect(input string) []DetectedPII {
	var detections []DetectedPII
	for _, p := range m.patterns {
		matches := p.Pattern.FindAllString(input, -1)
		for _, match := range matches {
			detections = append(detections, DetectedPII{Type: p.Name, Value: match})
		}
	}
	return detections
}
