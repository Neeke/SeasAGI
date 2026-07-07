import { useState, useEffect, useCallback } from "react";
import * as cmd from "../utils/commands";
import { useAppStore } from "../stores/appStore";

interface ComboRouteMetricsItem {
  combo_name: string;
  total_requests: number;
  total_fallbacks: number;
  step1_success: number;
  last_step_fallback: number;
  step1_hit_rate: number;
  last_step_hit_rate: number;
  avg_attempts: number;
  task_type?: string;
}

export function ExecAnalysisPage() {
  const [metrics, setMetrics] = useState<ComboRouteMetricsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedCombo, setSelectedCombo] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<"all" | "chat" | "tools">("all");
  const { providerHealth, setProviderHealth } = useAppStore();

  const loadMetrics = useCallback(async () => {
    try {
      const data = await cmd.getComboRouteMetrics();
      setMetrics(data || []);
      setError("");
    } catch (e: any) {
      setError(e.message || "加载失败");
    }
    setLoading(false);
  }, []);

  const loadProviderHealth = useCallback(async () => {
    try {
      const data = await cmd.getProviderHealthSummary();
      setProviderHealth(data || []);
    } catch {}
  }, [setProviderHealth]);

  useEffect(() => {
    loadMetrics();
    loadProviderHealth();
  }, [loadMetrics, loadProviderHealth]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => { loadMetrics(); loadProviderHealth(); }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadMetrics, loadProviderHealth]);

  const formatPct = (v: number) => (v * 100).toFixed(1) + "%";
  const formatNum = (v: number) => v.toLocaleString();

  const filteredMetrics = taskFilter === "all" ? metrics : metrics.filter((m) => m.task_type === taskFilter);
  const selected = filteredMetrics.find((m) => m.combo_name === selectedCombo);
  const sorted = [...filteredMetrics].sort((a, b) => b.total_requests - a.total_requests);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>执行分析</h1>
          <p className="page-subtitle">各 Combo 方案的运行时指标与回退统计</p>
        </div>
        <div className="action-bar">
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value as any)} style={{ fontSize: 13, padding: "4px 8px", borderRadius: 4 }}>
            <option value="all">全部类型</option>
            <option value="chat">Chat</option>
            <option value="tools">Tools</option>
          </select>
          <label className="toggle-row" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <span>自动刷新（5秒）</span>
          </label>
          <button className="btn-sm" onClick={loadMetrics} disabled={loading}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {!loading && metrics.length === 0 && !error && (
        <div className="empty-state">
          暂无运行时指标数据。发送 API 请求后自动产生。
        </div>
      )}

      {/* Summary Cards */}
      {metrics.length > 0 && (
        <div className="metrics-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-label">监测 Combo 数</div>
            <div className="stat-value">{metrics.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">总请求数</div>
            <div className="stat-value">{formatNum(metrics.reduce((s, m) => s + m.total_requests, 0))}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">总回退次数</div>
            <div className="stat-value">{formatNum(metrics.reduce((s, m) => s + m.total_fallbacks, 0))}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">综合 Step1 命中率</div>
            <div className="stat-value">
              {(() => {
                const total = metrics.reduce((s, m) => s + m.total_requests, 0);
                const hits = metrics.reduce((s, m) => s + m.step1_success, 0);
                return total > 0 ? formatPct(hits / total) : "-";
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Combo List with bar chart */}
      {sorted.length > 0 && (
        <div className="section section-card">
          <h2 className="section-title">Combo 命中率概览</h2>
          <div className="combo-metrics-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.map((m) => (
              <div
                key={m.combo_name}
                className={`combo-metrics-row ${selectedCombo === m.combo_name ? "selected" : ""}`}
                onClick={() => setSelectedCombo(selectedCombo === m.combo_name ? null : m.combo_name)}
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: selectedCombo === m.combo_name ? "var(--accent-light)" : "var(--bg-tertiary)",
                  cursor: "pointer",
                  transition: "var(--transition)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <strong style={{ fontSize: 14 }}>{m.combo_name}</strong>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {formatNum(m.total_requests)} 请求 · {formatNum(m.total_fallbacks)} 回退
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ color: "var(--green)" }}>Step1 命中率</span>
                      <span>{formatPct(m.step1_hit_rate)}</span>
                    </div>
                    <div style={{ height: 6, background: "var(--bg-primary)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${m.step1_hit_rate * 100}%`, height: "100%", background: "var(--green)", borderRadius: 3, transition: "width 0.3s" }} />
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ color: "var(--yellow)" }}>末步命中率</span>
                      <span>{formatPct(m.last_step_hit_rate)}</span>
                    </div>
                    <div style={{ height: 6, background: "var(--bg-primary)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${m.last_step_hit_rate * 100}%`, height: "100%", background: "var(--yellow)", borderRadius: 3, transition: "width 0.3s" }} />
                    </div>
                  </div>
                  <div style={{ minWidth: 80, textAlign: "right" }}>
                    <span className="text-muted">平均尝试 </span>
                    <strong>{m.avg_attempts.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <div className="section section-card">
          <h2 className="section-title">{selected.combo_name} — 详细指标</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <div className="stat-card">
              <div className="stat-label">总请求</div>
              <div className="stat-value">{formatNum(selected.total_requests)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Step1 成功</div>
              <div className="stat-value">{formatNum(selected.step1_success)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">回退次数</div>
              <div className="stat-value">{formatNum(selected.total_fallbacks)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">末步回退</div>
              <div className="stat-value">{formatNum(selected.last_step_fallback)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Step1 命中率</div>
              <div className="stat-value" style={{ color: selected.step1_hit_rate > 0.8 ? "var(--green)" : "var(--yellow)" }}>
                {formatPct(selected.step1_hit_rate)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">末步命中率</div>
              <div className="stat-value" style={{ color: selected.last_step_hit_rate > 0.5 ? "var(--green)" : "var(--red)" }}>
                {formatPct(selected.last_step_hit_rate)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">平均尝试次数</div>
              <div className="stat-value">{selected.avg_attempts.toFixed(2)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">评估</div>
              <div className="stat-value" style={{ fontSize: 13 }}>
                {selected.step1_hit_rate > 0.9
                  ? "优秀 🟢"
                  : selected.step1_hit_rate > 0.7
                  ? "良好 🟡"
                  : selected.step1_hit_rate > 0.5
                  ? "需优化 🟠"
                  : "不佳 🔴"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Provider Health Summary */}
      {providerHealth.length > 0 && (
        <div className="section section-card">
          <h2 className="section-title">Provider 健康度概览</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            {providerHealth.map((p) => (
              <div key={p.provider_id} style={{ padding: "10px 14px", borderRadius: "var(--radius-sm)", background: "var(--bg-tertiary)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{p.provider_id}</strong>
                  <span style={{ fontSize: 11, color: p.circuit_open_count > 0 ? "var(--red)" : "var(--green)" }}>
                    {p.circuit_open_count > 0 ? `熔断×${p.circuit_open_count}` : "正常"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
                  <span>成功率 {formatPct(p.avg_success_rate)}</span>
                  <span>延迟 {p.avg_latency_ms.toFixed(0)}ms</span>
                  <span>惩罚 {p.avg_penalty_score.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
