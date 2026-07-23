package channel

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/SeasAGI/SeasAGI-Server/platform-api/internal/database"
	"github.com/SeasAGI/SeasAGI-Server/platform-api/internal/i18n"
	"github.com/SeasAGI/SeasAGI-Server/platform-api/internal/secure"
)

type Channel struct {
	ChannelID       string      `json:"channel_id"`
	ChannelType     string      `json:"channel_type"`
	ProviderType    string      `json:"provider_type"`
	DisplayName     string      `json:"display_name"`
	BaseURL         string      `json:"base_url"`
	Enabled         bool        `json:"enabled"`
	Models          []ModelInfo `json:"models"`
	SortOrder       int         `json:"sort_order"`
	Weight          int         `json:"weight,omitempty"`
	Priority        int         `json:"priority,omitempty"`
	GrayPercent     int         `json:"gray_percent,omitempty"`
	ReadOnly        bool        `json:"read_only,omitempty"`
	EncryptedAPIKey string      `json:"encrypted_api_key,omitempty"`
}

type ModelInfo struct {
	ModelID    string `json:"model_id"`
	ModelName  string `json:"model_name"`
	Capability string `json:"capability"`
}

type CreateChannelRequest struct {
	ChannelID    string      `json:"channel_id" binding:"required"`
	ChannelType  string      `json:"channel_type"`
	ProviderType string      `json:"provider_type" binding:"required"`
	DisplayName  string      `json:"display_name" binding:"required"`
	BaseURL      string      `json:"base_url" binding:"required"`
	Enabled      *bool       `json:"enabled"`
	Models       []ModelInfo `json:"models"`
	SortOrder    int         `json:"sort_order"`
	APIKey       string      `json:"api_key"`
}

type UpdateChannelRequest struct {
	ChannelType  *string     `json:"channel_type"`
	ProviderType *string     `json:"provider_type"`
	DisplayName  *string     `json:"display_name"`
	BaseURL      *string     `json:"base_url"`
	Enabled      *bool       `json:"enabled"`
	Models       []ModelInfo `json:"models"`
	SortOrder    *int        `json:"sort_order"`
	APIKey       *string     `json:"api_key"`
}

func ListChannels(c *gin.Context) {
	channels, err := fetchAllChannels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"object": "list",
		"data":   channels,
	})
}

func GetChannel(c *gin.Context) {
	channelID := c.Param("id")

	ch, err := fetchChannel(channelID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.TFromContext(c, "channel.notFound")})
		return
	}

	c.JSON(http.StatusOK, ch)
}

func CreateChannel(c *gin.Context) {
	var req CreateChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := 1
	if req.Enabled != nil && !*req.Enabled {
		enabled = 0
	}
	if req.ChannelType == "" {
		req.ChannelType = "platform"
	}

	_, err := database.DB.Exec(
		`INSERT INTO channels (channel_id, channel_type, provider_type, display_name, base_url, enabled, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		req.ChannelID, req.ChannelType, req.ProviderType, req.DisplayName, req.BaseURL, enabled, req.SortOrder,
	)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	if req.APIKey != "" {
		encrypted, err := secure.EncryptString(req.APIKey)
		if err == nil {
			_, _ = database.DB.Exec(
				`INSERT INTO channel_strategies (channel_id, encrypted_api_key, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
				 ON CONFLICT(channel_id) DO UPDATE SET encrypted_api_key=excluded.encrypted_api_key, updated_at=CURRENT_TIMESTAMP`,
				req.ChannelID, encrypted,
			)
		}
	}

	for _, m := range req.Models {
		capability := m.Capability
		if capability == "" {
			capability = "chat"
		}
		database.DB.Exec(
			`INSERT OR IGNORE INTO channel_models (channel_id, model_id, model_name, capability)
			 VALUES (?, ?, ?, ?)`,
			req.ChannelID, m.ModelID, m.ModelName, capability,
		)
	}

	ch, _ := fetchChannel(req.ChannelID)
	c.JSON(http.StatusCreated, ch)
}

func UpdateChannel(c *gin.Context) {
	channelID := c.Param("id")

	var req UpdateChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	existing, err := fetchChannel(channelID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.TFromContext(c, "channel.notFound")})
		return
	}

	channelType := existing.ChannelType
	if req.ChannelType != nil {
		channelType = *req.ChannelType
	}
	providerType := existing.ProviderType
	if req.ProviderType != nil {
		providerType = *req.ProviderType
	}
	displayName := existing.DisplayName
	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}
	baseURL := existing.BaseURL
	if req.BaseURL != nil {
		baseURL = *req.BaseURL
	}
	enabled := existing.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	sortOrder := existing.SortOrder
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}

	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	_, err = database.DB.Exec(
		`UPDATE channels SET channel_type=?, provider_type=?, display_name=?, base_url=?, enabled=?, sort_order=?, updated_at=CURRENT_TIMESTAMP
		 WHERE channel_id=?`,
		channelType, providerType, displayName, baseURL, enabledInt, sortOrder, channelID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.APIKey != nil {
		encrypted, err := secure.EncryptString(*req.APIKey)
		if err == nil {
			_, _ = database.DB.Exec(
				`INSERT INTO channel_strategies (channel_id, encrypted_api_key, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
				 ON CONFLICT(channel_id) DO UPDATE SET encrypted_api_key=excluded.encrypted_api_key, updated_at=CURRENT_TIMESTAMP`,
				channelID, encrypted,
			)
		}
	}

	if req.Models != nil {
		database.DB.Exec("DELETE FROM channel_models WHERE channel_id=?", channelID)
		for _, m := range req.Models {
			capability := m.Capability
			if capability == "" {
				capability = "chat"
			}
			database.DB.Exec(
				`INSERT OR IGNORE INTO channel_models (channel_id, model_id, model_name, capability)
				 VALUES (?, ?, ?, ?)`,
				channelID, m.ModelID, m.ModelName, capability,
			)
		}
	}

	ch, _ := fetchChannel(channelID)
	c.JSON(http.StatusOK, ch)
}

func DeleteChannel(c *gin.Context) {
	channelID := c.Param("id")

	result, err := database.DB.Exec("DELETE FROM channels WHERE channel_id=?", channelID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": i18n.TFromContext(c, "channel.notFound")})
		return
	}

	database.DB.Exec("DELETE FROM channel_models WHERE channel_id=?", channelID)
	c.JSON(http.StatusOK, gin.H{"message": "channel deleted"})
}

func fetchAllChannels() ([]Channel, error) {
	rows, err := database.DB.Query(
		`SELECT c.channel_id, c.channel_type, c.provider_type, c.display_name, c.base_url, c.enabled, c.sort_order,
		 COALESCE(s.weight, 100), COALESCE(s.priority, 0), COALESCE(s.gray_percent, 0), COALESCE(s.read_only, 0), COALESCE(s.encrypted_api_key, '')
		 FROM channels c
		 LEFT JOIN channel_strategies s ON c.channel_id = s.channel_id
		 ORDER BY COALESCE(s.priority, c.sort_order), c.channel_id`,
	)
	if err != nil {
		return nil, err
	}

	var channels []Channel
	for rows.Next() {
		var ch Channel
		var enabledInt, readOnlyInt int
		if err := rows.Scan(&ch.ChannelID, &ch.ChannelType, &ch.ProviderType, &ch.DisplayName, &ch.BaseURL, &enabledInt, &ch.SortOrder, &ch.Weight, &ch.Priority, &ch.GrayPercent, &readOnlyInt, &ch.EncryptedAPIKey); err != nil {
			return nil, err
		}
		ch.Enabled = enabledInt == 1
		ch.ReadOnly = readOnlyInt == 1
		channels = append(channels, ch)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	// Read model rows after the outer query is fully drained and closed.
	for i := range channels {
		channels[i].Models, _ = fetchModelsForChannel(channels[i].ChannelID)
	}

	if channels == nil {
		channels = []Channel{}
	}
	return channels, nil
}

func fetchChannel(channelID string) (*Channel, error) {
	var ch Channel
	var enabledInt, readOnlyInt int
	err := database.DB.QueryRow(
		`SELECT c.channel_id, c.channel_type, c.provider_type, c.display_name, c.base_url, c.enabled, c.sort_order,
		 COALESCE(s.weight, 100), COALESCE(s.priority, 0), COALESCE(s.gray_percent, 0), COALESCE(s.read_only, 0), COALESCE(s.encrypted_api_key, '')
		 FROM channels c
		 LEFT JOIN channel_strategies s ON c.channel_id = s.channel_id
		 WHERE c.channel_id=?`,
		channelID,
	).Scan(&ch.ChannelID, &ch.ChannelType, &ch.ProviderType, &ch.DisplayName, &ch.BaseURL, &enabledInt, &ch.SortOrder, &ch.Weight, &ch.Priority, &ch.GrayPercent, &readOnlyInt, &ch.EncryptedAPIKey)
	if err == sql.ErrNoRows {
		return nil, err
	}
	if err != nil {
		return nil, err
	}

	ch.Enabled = enabledInt == 1
	ch.ReadOnly = readOnlyInt == 1
	ch.Models, _ = fetchModelsForChannel(ch.ChannelID)
	return &ch, nil
}

func fetchModelsForChannel(channelID string) ([]ModelInfo, error) {
	rows, err := database.DB.Query(
		`SELECT model_id, model_name, capability FROM channel_models WHERE channel_id=? ORDER BY model_id`,
		channelID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var models []ModelInfo
	for rows.Next() {
		var m ModelInfo
		if err := rows.Scan(&m.ModelID, &m.ModelName, &m.Capability); err != nil {
			return nil, err
		}
		models = append(models, m)
	}

	if models == nil {
		models = []ModelInfo{}
	}
	return models, nil
}
