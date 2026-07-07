package protocol

import (
	"strings"
)

type ReasoningInjector struct{}

var reasoningProviders = map[string]bool{
	"deepseek":   true,
	"deepseek-r1": true,
	"kimi":       true,
	"moonshot":   true,
	"qwen-qwq":   true,
	"qwq":        true,
}

func NeedsReasoningContent(providerType string, modelName string) bool {
	if reasoningProviders[providerType] {
		return true
	}
	lowerModel := strings.ToLower(modelName)
	for key := range reasoningProviders {
		if strings.Contains(lowerModel, key) {
			return true
		}
	}
	if strings.Contains(lowerModel, "deepseek-r1") ||
		strings.Contains(lowerModel, "deepseek-reasoner") ||
		strings.Contains(lowerModel, "qwq") ||
		strings.Contains(lowerModel, "kimi") ||
		strings.Contains(lowerModel, "moonshot") {
		return true
	}
	return false
}

func InjectReasoningPlaceholder(messages []map[string]any) []map[string]any {
	if len(messages) == 0 {
		return messages
	}

	lastIdx := len(messages) - 1
	lastMsg := messages[lastIdx]

	role, _ := lastMsg["role"].(string)
	if role != "assistant" {
		return messages
	}

	_, hasReasoning := lastMsg["reasoning_content"]
	if hasReasoning {
		return messages
	}

	content, _ := lastMsg["content"].(string)
	if content == "" {
		messages[lastIdx]["reasoning_content"] = ""
	}

	return messages
}

func ExtractReasoningFromResponse(body map[string]any) (reasoning string, cleanBody map[string]any) {
	cleanBody = make(map[string]any, len(body))
	for k, v := range body {
		cleanBody[k] = v
	}

	choices, ok := body["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return "", cleanBody
	}

	choice, ok := choices[0].(map[string]any)
	if !ok {
		return "", cleanBody
	}

	message, ok := choice["message"].(map[string]any)
	if !ok {
		return "", cleanBody
	}

	rc, ok := message["reasoning_content"].(string)
	if !ok || rc == "" {
		return "", cleanBody
	}

	cleanChoices := make([]interface{}, len(choices))
	for i, c := range choices {
		cleanChoices[i] = c
	}

	cleanChoice := make(map[string]any, len(choice))
	for k, v := range choice {
		cleanChoice[k] = v
	}

	cleanMessage := make(map[string]any, len(message))
	for k, v := range message {
		cleanMessage[k] = v
	}
	delete(cleanMessage, "reasoning_content")

	cleanChoice["message"] = cleanMessage
	cleanChoices[0] = cleanChoice
	cleanBody["choices"] = cleanChoices

	return rc, cleanBody
}

func MergeReasoningIntoContent(body map[string]any, reasoning string) map[string]any {
	if reasoning == "" {
		return body
	}

	result := make(map[string]any, len(body))
	for k, v := range body {
		result[k] = v
	}

	choices, ok := body["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return result
	}

	choice, ok := choices[0].(map[string]any)
	if !ok {
		return result
	}

	message, ok := choice["message"].(map[string]any)
	if !ok {
		return result
	}

	content, _ := message["content"].(string)
	mergedContent := "<think>\n" + reasoning + "\n</think>\n" + content

	newChoices := make([]interface{}, len(choices))
	for i, c := range choices {
		newChoices[i] = c
	}

	newChoice := make(map[string]any, len(choice))
	for k, v := range choice {
		newChoice[k] = v
	}

	newMessage := make(map[string]any, len(message))
	for k, v := range message {
		newMessage[k] = v
	}
	newMessage["content"] = mergedContent

	newChoice["message"] = newMessage
	newChoices[0] = newChoice
	result["choices"] = newChoices

	return result
}
