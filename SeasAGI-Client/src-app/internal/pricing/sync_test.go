package pricing

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPricingSyncTransform(t *testing.T) {
	spec := liteLLMSpec{
		InputPricePerToken:  0.000001, // $0.000001/token → $1/1M
		OutputPricePerToken: 0.000002, // $0.000002/token → $2/1M
		Provider:            "openai",
		PerImage:            0.004,
	}

	p := transformToPricing("gpt-4o", spec)
	if p.Model != "gpt-4o" {
		t.Fatalf("expected model gpt-4o, got %s", p.Model)
	}
	if p.InputPer1M != 1.0 {
		t.Fatalf("expected input $1/1M, got %f", p.InputPer1M)
	}
	if p.OutputPer1M != 2.0 {
		t.Fatalf("expected output $2/1M, got %f", p.OutputPer1M)
	}
	if p.PerImage != 0.004 {
		t.Fatalf("expected per_image 0.004, got %f", p.PerImage)
	}
}

func TestPricingSyncNonToken(t *testing.T) {
	spec := liteLLMSpec{
		Provider:         "google",
		SearchUnit:       0.005,
		PerVideoSecond:   0.01,
		OCRSpecPerPage:   0.001,
		PerCharacter:     0.00001,
	}
	p := transformToPricing("gemini-vision", spec)
	if p.SearchUnit != 0.005 {
		t.Fatalf("expected search_unit 0.005, got %f", p.SearchUnit)
	}
	if p.PerVideoSecond != 0.01 {
		t.Fatalf("expected per_video_second 0.01, got %f", p.PerVideoSecond)
	}
	if p.OCRSpecPerPage != 0.001 {
		t.Fatalf("expected ocr_per_page 0.001, got %f", p.OCRSpecPerPage)
	}
}

func TestPricingSyncProviderMap(t *testing.T) {
	spec := liteLLMSpec{Provider: "meta-llama"}
	p := transformToPricing("llama-3", spec)
	if p.Provider != "meta" {
		t.Fatalf("expected provider meta, got %s", p.Provider)
	}

	spec2 := liteLLMSpec{Provider: "together_ai"}
	p2 := transformToPricing("llama-3-together", spec2)
	if p2.Provider != "together" {
		t.Fatalf("expected provider together, got %s", p2.Provider)
	}
}

func TestPricingSyncFetch(t *testing.T) {
	// 模拟 LiteLLM API
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data := map[string]interface{}{
			"gpt-4o": map[string]interface{}{
				"input_cost_per_token":  0.000001,
				"output_cost_per_token": 0.000002,
				"litellm_provider":      "openai",
			},
			"claude-3-sonnet": map[string]interface{}{
				"input_cost_per_token":  0.000003,
				"output_cost_per_token": 0.000015,
				"litellm_provider":      "anthropic",
			},
			"sample_spec": map[string]interface{}{
				"input_cost_per_token": 0,
			},
		}
		json.NewEncoder(w).Encode(data)
	}))
	defer ts.Close()

	mgr := NewPricingSyncManager(ts.URL)
	err := mgr.FetchAndSync()
	if err != nil {
		t.Fatalf("FetchAndSync failed: %v", err)
	}

	if mgr.GetSyncedCount() != 2 {
		t.Fatalf("expected 2 synced models (excluding sample_spec), got %d", mgr.GetSyncedCount())
	}

	status := mgr.GetSyncStatus()
	if !status.Success {
		t.Fatal("sync status should be success")
	}
	if status.ModelsSynced != 2 {
		t.Fatalf("expected 2 models synced, got %d", status.ModelsSynced)
	}
}

func TestPricingSyncThreeLayer(t *testing.T) {
	mgr := NewPricingSyncManager("")

	// 第三层：硬编码默认
	mgr.SetHardcodedDefault("gpt-4", ModelPricing{Model: "gpt-4", InputPer1M: 30.0})

	// 第二层：同步外部
	mgr.mu.Lock()
	mgr.syncedPrices["gpt-4"] = ModelPricing{Model: "gpt-4", InputPer1M: 20.0}
	mgr.mu.Unlock()

	// 第一层：用户覆盖
	mgr.SetUserOverride("gpt-4", ModelPricing{Model: "gpt-4", InputPer1M: 10.0})

	// 应返回用户覆盖
	p, ok := mgr.GetPricing("gpt-4")
	if !ok {
		t.Fatal("expected pricing for gpt-4")
	}
	if p.InputPer1M != 10.0 {
		t.Fatalf("expected user override 10.0, got %f", p.InputPer1M)
	}

	// 移除用户覆盖，应返回同步
	mgr.mu.Lock()
	delete(mgr.userOverrides, "gpt-4")
	mgr.mu.Unlock()
	p, ok = mgr.GetPricing("gpt-4")
	if !ok || p.InputPer1M != 20.0 {
		t.Fatalf("expected synced 20.0, got %f ok=%v", p.InputPer1M, ok)
	}

	// 移除同步，应返回硬编码
	mgr.mu.Lock()
	delete(mgr.syncedPrices, "gpt-4")
	mgr.mu.Unlock()
	p, ok = mgr.GetPricing("gpt-4")
	if !ok || p.InputPer1M != 30.0 {
		t.Fatalf("expected hardcoded 30.0, got %f ok=%v", p.InputPer1M, ok)
	}
}

func TestPricingSyncCaseInsensitive(t *testing.T) {
	mgr := NewPricingSyncManager("")
	mgr.SetUserOverride("GPT-4", ModelPricing{Model: "GPT-4", InputPer1M: 10.0})

	// 大小写不敏感查询
	p, ok := mgr.GetPricing("gpt-4")
	if !ok {
		t.Fatal("expected case insensitive match")
	}
	if p.InputPer1M != 10.0 {
		t.Fatalf("expected 10.0, got %f", p.InputPer1M)
	}
}
