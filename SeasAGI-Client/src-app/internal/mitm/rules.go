package mitm

import "sync"

// Rules 管理需要拦截的域名规则集。线程安全。
type Rules struct {
	mu   sync.RWMutex
	set  map[string]bool
	list []string // 有序列表（供前端展示）
}

// NewRules 创建空规则集。
func NewRules() *Rules {
	return &Rules{
		set:  make(map[string]bool),
		list: []string{},
	}
}

// NewDefaultRules 创建预置 6 个 AI API 域名的规则集。
func NewDefaultRules() *Rules {
	r := NewRules()
	for _, d := range []string{
		"api.openai.com",
		"api.anthropic.com",
		"generativelanguage.googleapis.com",
		"api.deepseek.com",
		"api.x.ai",
		"openrouter.ai",
	} {
		r.Add(d)
	}
	return r
}

// Match 检查 host 是否命中拦截规则（精确匹配）。
func (r *Rules) Match(host string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.set[host]
}

// Add 添加拦截域名。幂等。
func (r *Rules) Add(domain string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.set[domain] {
		return
	}
	r.set[domain] = true
	r.list = append(r.list, domain)
}

// Remove 移除拦截域名。幂等。
func (r *Rules) Remove(domain string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.set[domain] {
		return
	}
	delete(r.set, domain)
	for i, d := range r.list {
		if d == domain {
			r.list = append(r.list[:i], r.list[i+1:]...)
			break
		}
	}
}

// List 返回有序域名列表副本。
func (r *Rules) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]string, len(r.list))
	copy(result, r.list)
	return result
}

// Count 返回当前规则数量。
func (r *Rules) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.list)
}
