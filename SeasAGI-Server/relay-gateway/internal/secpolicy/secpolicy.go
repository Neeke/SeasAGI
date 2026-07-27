package secpolicy

import (
	"log"
	"os"
	"strings"
)

// weakPatterns are substrings that indicate a placeholder or default secret.
var weakPatterns = []string{
	"change-me",
	"default",
	"xxxxxxxx",
	"sk_test_xxx",
	"placeholder",
	"your-",
	"example",
}

// minSecretLength is the minimum acceptable length for production secrets.
const minSecretLength = 16

// ValidateStartup checks configured secrets for weak/default values.
// In production mode (GIN_MODE != "debug"), it logs a fatal error and exits
// if any weak secret is detected. In debug mode, it only logs warnings.
func ValidateStartup() {
	secrets := []string{
		"JWT_SECRET",
		"JWT_REFRESH_SECRET",
	}

	isDebug := os.Getenv("GIN_MODE") == "debug"
	weak := false

	for _, name := range secrets {
		val := os.Getenv(name)
		reason := weakSecretReason(name, val)
		if reason != "" {
			if isDebug {
				log.Printf("WARNING: weak secret %s: %s", name, reason)
			} else {
				log.Printf("FATAL: weak secret %s: %s", name, reason)
				weak = true
			}
		}
	}

	if weak && !isDebug {
		log.Fatal("Startup aborted: weak or default secrets detected in production mode. Set strong secrets in your .env file before starting.")
	}
}

// weakSecretReason returns a non-empty string if the secret value is weak.
func weakSecretReason(name, val string) string {
	if val == "" {
		return "not set (empty)"
	}
	if len(val) < minSecretLength {
		return "too short (minimum 16 characters)"
	}
	valLower := strings.ToLower(val)
	for _, pattern := range weakPatterns {
		if strings.Contains(valLower, pattern) {
			return "contains weak pattern '" + pattern + "' — looks like a placeholder or default value"
		}
	}
	return ""
}
