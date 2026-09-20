package rtk

import (
	"reflect"
	"testing"
)

func TestCavemanInjectDisabled(t *testing.T) {
	msgs := []map[string]any{{"role": "user", "content": "hello"}}
	got := CavemanInjectIntoCanonical(msgs, false, "concise")
	if len(got) != 1 || got[0]["content"] != "hello" {
		t.Errorf("disabled inject should keep messages unchanged, got %v", got)
	}
}

func TestCavemanInjectNoSystem(t *testing.T) {
	msgs := []map[string]any{
		{"role": "user", "content": "hi"},
		{"role": "assistant", "content": "yo"},
	}
	got := CavemanInjectIntoCanonical(msgs, true, "concise")
	if len(got) != 3 {
		t.Fatalf("expected 3 messages after prepend, got %d", len(got))
	}
	if got[0]["role"] != "system" {
		t.Errorf("first message should be system, got %v", got[0]["role"])
	}
	if !reflect.DeepEqual(got[1], msgs[0]) || !reflect.DeepEqual(got[2], msgs[1]) {
		t.Error("original messages order/content must be preserved")
	}
}

func TestCavemanInjectExistingSystem(t *testing.T) {
	msgs := []map[string]any{{"role": "system", "content": "You are helpful."}}
	got := CavemanInjectIntoCanonical(msgs, true, "brief")
	if len(got) != 1 {
		t.Fatalf("expected 1 message, got %d", len(got))
	}
	want := "You are helpful.\n\n" + cavemanPrompts[CavemanStyleBrief]
	if got[0]["content"] != want {
		t.Errorf("content = %q, want %q", got[0]["content"], want)
	}

	// 幂等：已含标记不重复追加
	got2 := CavemanInjectIntoCanonical(got, true, "brief")
	if got2[0]["content"] != want {
		t.Errorf("inject should be idempotent, got %q", got2[0]["content"])
	}
}

func TestCavemanInjectNonStringSystemContent(t *testing.T) {
	orig := []any{map[string]any{"type": "text", "text": "sys"}}
	msgs := []map[string]any{{"role": "system", "content": orig}}
	got := CavemanInjectIntoCanonical(msgs, true, "concise")
	if !reflect.DeepEqual(got[0]["content"], orig) {
		t.Errorf("non-string system content must be preserved, got %v", got[0]["content"])
	}
}

func TestNewCavemanInjectorInvalidStyle(t *testing.T) {
	ci := NewCavemanInjector(true, "bogus")
	if ci.Style != CavemanStyleConcise {
		t.Errorf("invalid style should fall back to concise, got %s", ci.Style)
	}
}

func TestListCavemanStyles(t *testing.T) {
	styles := ListCavemanStyles()
	if len(styles) != len(cavemanPrompts) {
		t.Errorf("expected %d styles, got %d", len(cavemanPrompts), len(styles))
	}
}
