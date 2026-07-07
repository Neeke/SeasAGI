import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import { getCloudUsage, getCloudBilling, getUsageSummary, getPlatformAPIBaseURL, getPlatformToken } from "../utils/commands";
import type { CloudUsage, CloudBilling, UsageSummary, OverageRecord } from "../utils/types";

export function UsagePage() {
  const navigate = useNavigate();
  const setCloudBilling = useAppStore((s) => s.setCloudBilling);
  const setCloudUsageStore = useAppStore((s) => s.setCloudUsage);
  const [cloudUsage, setCloudUsage] = useState<CloudUsage | null>(null);
  const [billing, setBilling] = useState<CloudBilling | null>(null);
  const [localSummary, setLocalSummary] = useState<UsageSummary | null>(null);
  const [overage, setOverage] = useState<OverageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOverageInfo, setShowOverageInfo] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [cu, cb, ls] = await Promise.all([
          getCloudUsage().catch(() => null),
          getCloudBilling().catch(() => null),
          getUsageSummary().catch(() => null),
        ]);
        setCloudUsage(cu);
        setBilling(cb);
        setCloudUsageStore(cu);
        if (cb) setCloudBilling(cb);
        setLocalSummary(ls);

        try {
          const [baseURL, token] = await Promise.all([getPlatformAPIBaseURL(), getPlatformToken()]);
          const resp = await fetch(`${baseURL}/usage/overage/user`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (resp.ok) {
            const data: OverageRecord = await resp.json();
            setOverage(data);
          }
        } catch {
          // overage data is optional
        }
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const quotaUsed = billing ? billing.used_quota : 0;
  const quotaTotal = billing ? billing.quota : 0;
  const quotaPercent = quotaTotal > 0 ? Math.min(100, (quotaUsed / quotaTotal) * 100) : 0;
  const localOverage = billing && billing.price > 0 ? Math.max(0, quotaUsed - quotaTotal) : 0;
  const hasOverage = localOverage > 0 || (overage && overage.overage_requests > 0);
  const overageCost = overage ? overage.overage_cost : 0;

  const suggestions = useMemo(() => {
    const list: { id: string; type: "quota" | "collab" | "govern"; title: string; desc: string; action: string; severity: "info" | "warning" | "danger" }[] = [];
    const planId = billing?.plan_id || "free";
    const pct = quotaPercent;
    const hasHighOverage = hasOverage && (localOverage > 100 || (overage?.overage_requests || 0) > 100);

    if (planId === "free") {
      if (pct > 60 || hasHighOverage) {
        list.push({
          id: "free-pro-quota",
          type: "quota",
          title: "配额即将用尽，升级 Pro 获取更多额度",
          desc: `当前已使用 ${pct.toFixed(0)}% 的免费配额。Pro 套餐仅 $9.9/月，享 1 千万 Token 云端配额、中继通道与用量分析。`,
          action: "查看 Pro 套餐",
          severity: pct > 85 ? "danger" : "warning",
        });
      }
      if (pct > 30) {
        list.push({
          id: "free-collab",
          type: "collab",
          title: "团队协作？升级 Teams",
          desc: "如需与团队成员共享通道与配置，Teams 套餐 $24.9/席位/月，享 5 千万 Token 共享配额与集中管理。",
          action: "了解 Teams",
          severity: "info",
        });
      }
    } else if (planId === "pro") {
      if (pct > 70 || hasHighOverage) {
        list.push({
          id: "pro-teams-quota",
          type: "quota",
          title: "配额消耗较高，升级 Teams 获取更大空间",
          desc: `当前已使用 ${pct.toFixed(0)}% 的 Pro 配额。Teams 套餐 $24.9/席位/月，享 5 千万 Token 共享配额。`,
          action: "查看 Teams 套餐",
          severity: pct > 85 ? "danger" : "warning",
        });
      }
      if (pct > 40) {
        list.push({
          id: "pro-teams-collab",
          type: "collab",
          title: "与团队共享？Teams 更合适",
          desc: "Pro 为个人使用设计。如需多人共享通道、策略模板与用量看板，升级 Teams 可享统一管理与协作能力。",
          action: "了解 Teams 协作",
          severity: "info",
        });
      }
    } else if (planId === "teams") {
      if (pct > 80) {
        list.push({
          id: "teams-enterprise-govern",
          type: "govern",
          title: "企业治理需求？联系 Enterprise 方案",
          desc: `当前共享配额已使用 ${pct.toFixed(0)}%。Enterprise 提供审计日志、自定义策略、SLA 保障与私有化部署。`,
          action: "联系销售",
          severity: pct > 90 ? "danger" : "warning",
        });
      }
    }

    return list.filter((s) => !dismissedSuggestions.includes(s.id));
  }, [billing, quotaPercent, hasOverage, localOverage, overage, dismissedSuggestions]);

  const dismissSuggestion = (id: string) => {
    setDismissedSuggestions((prev) => [...prev, id]);
  };

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div className="page usage-page">
      <div className="page-header">
        <div>
          <h1>用量 & 账单</h1>
          <p className="page-subtitle">查看本月调用统计、云端用量、配额消耗和费用归因。</p>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric-card">
            <span className="hero-metric-label">本地请求</span>
            <strong className="hero-metric-value">{(localSummary?.month_requests ?? 0).toLocaleString()}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">云端费用</span>
            <strong className="hero-metric-value">{cloudUsage ? `$${cloudUsage.total_cost_usd.toFixed(2)}` : "--"}</strong>
          </div>
          {billing && (
            <div className="hero-metric-card">
              <span className="hero-metric-label">{billing.plan_name}</span>
              <strong className="hero-metric-value">{billing.price > 0 ? `$${billing.price}/mo` : "Free"}</strong>
            </div>
          )}
        </div>
      </div>

      {billing && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>订阅配额</h2>
            <p className="hint">当前套餐 {billing.plan_name} 的配额消耗情况。</p>
          </div>
          <div className="usage-quota-card">
            <div className="usage-quota-header">
              <span className="usage-quota-label">
                已使用 {quotaUsed.toLocaleString()} / {quotaTotal.toLocaleString()}
                {billing.relay_enabled && <span className="badge badge-blue" style={{ marginLeft: 8 }}>中继可用</span>}
              </span>
              <span className="usage-quota-pct">{quotaPercent.toFixed(0)}%</span>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill ${quotaPercent > 85 ? "fill-danger" : quotaPercent > 60 ? "fill-warning" : ""}`}
                style={{ width: `${quotaPercent}%` }}
              />
              {hasOverage && (
                <div
                  className="progress-fill fill-overage"
                  style={{
                    width: `${Math.min(100, ((localOverage || overage?.overage_requests || 0) / quotaTotal) * 100)}%`,
                    left: `${Math.min(100, quotaPercent)}%`,
                  }}
                />
              )}
            </div>
            {hasOverage && (
              <div className="usage-overage-hint">
                超额请求: <strong>{(localOverage || overage?.overage_requests || 0).toLocaleString()}</strong>
                {overageCost > 0 && (
                  <span style={{ marginLeft: 12 }}>
                    预估超额费用: <strong>${overageCost.toFixed(4)}</strong>
                  </span>
                )}
                <button className="link-btn" onClick={() => setShowOverageInfo(!showOverageInfo)} style={{ marginLeft: 8 }}>
                  {showOverageInfo ? "收起" : "了解超额策略"}
                </button>
                {showOverageInfo && (
                  <div className="usage-overage-detail" style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    超额部分按按需计费（约 $0.002/请求）。建议使用 BYOK（自备 Key）或升级到 Teams 方案获取更多配额以及高级模型访问权限。
                    在"路由设置"中可切换"BYOK 优先"策略以控制云端成本。
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {billing && billing.relay_enabled && billing.relay_gateways && billing.relay_gateways.length > 0 && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>中继通道</h2>
            <p className="hint">当前套餐可用的云端中继网关。</p>
          </div>
          <div className="relay-gw-list">
            {billing.relay_gateways.map((gw) => (
              <div key={gw.gateway_id} className="relay-gw-item">
                <span className="relay-gw-name">{gw.name}</span>
                <span className="relay-gw-region">{gw.region}</span>
                <span className="relay-gw-host">{gw.host}:{gw.port}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {localSummary && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>本地用量</h2>
            <p className="hint">按当前客户端本地记录的请求量、Token 与费用估算展示。这些请求通过你的自有 API Key 发出，不消耗平台额度。</p>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">月请求量</div>
              <div className="stat-value blue">{localSummary.month_requests.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Input Tokens</div>
              <div className="stat-value">{localSummary.month_input_tokens.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Output Tokens</div>
              <div className="stat-value">{localSummary.month_output_tokens.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">本月费用</div>
              <div className="stat-value green">${localSummary.month_cost_usd.toFixed(2)}</div>
            </div>
          </div>
          <div className="usage-cost-hint">
            费用为基于模型定价估算的本地 API 调用成本，非 SeasAGI 平台收费。
          </div>
          <div className="attribution-hint">
            <strong>请求归因：</strong>
            <span style={{ color: "var(--green)" }}>■ 本地/BYOK</span> — 使用自有 API Key，不消耗套餐配额 &nbsp;
            <span style={{ color: "var(--accent)" }}>■ 平台</span> — 使用平台通道，消耗月度配额 &nbsp;
            <span style={{ color: "var(--orange)" }}>■ 中继</span> — 使用云端中继转发，消耗月度配额
          </div>
        </div>
      )}

      {cloudUsage && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>云端用量</h2>
            <p className="hint">展示当前登录用户在平台侧累计的月度调用与费用。包含中继通道与平台通道使用量。</p>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">月请求量</div>
              <div className="stat-value blue">{cloudUsage.month_requests.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Input Tokens</div>
              <div className="stat-value">{cloudUsage.month_input_tokens?.toLocaleString() || "N/A"}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Output Tokens</div>
              <div className="stat-value">{cloudUsage.month_output_tokens?.toLocaleString() || "N/A"}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">总费用 (USD)</div>
              <div className="stat-value green">${cloudUsage.total_cost_usd.toFixed(2)}</div>
            </div>
          </div>
          {overage && overage.overage_requests > 0 && (
            <div className="usage-cost-hint" style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              其中超额请求: <strong>{overage.overage_requests.toLocaleString()}</strong>，超额费用: <strong>${overage.overage_cost.toFixed(4)}</strong>
            </div>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="section">
          <div className="section-heading">
            <h2>升级建议</h2>
            <p className="hint">根据当前套餐与使用情况推荐的升级方案。</p>
          </div>
          <div className="upgrade-suggestions">
            {suggestions.map((s) => (
              <div key={s.id} className={`upgrade-card upgrade-${s.severity}`}>
                <div className="upgrade-card-body">
                  <div className="upgrade-card-header">
                    <span className={`upgrade-icon ${s.type}`}>
                      {s.type === "quota" ? "📊" : s.type === "collab" ? "👥" : "🏢"}
                    </span>
                    <div>
                      <div className="upgrade-card-title">{s.title}</div>
                      <div className="upgrade-card-desc">{s.desc}</div>
                    </div>
                  </div>
                  <div className="upgrade-card-actions">
                    <button className="btn-primary btn-sm" onClick={() => navigate("/subscription")}>
                      {s.action}
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => dismissSuggestion(s.id)}>
                      忽略
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {billing && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>路由策略建议</h2>
            <p className="hint">根据当前套餐和使用情况推荐的配置。</p>
          </div>
          <div className="billing-card">
            <div className="billing-row">
              <span className="billing-label">推荐策略</span>
              <span className="billing-value">{billing.price > 0 ? "均衡模式（BYOK + 云端通道）" : "BYOK 优先（本地 Key）"}</span>
            </div>
            <div className="billing-row">
              <span className="billing-label">高成本模型</span>
              <span className="billing-value">
                {billing.plan_id === "free" || billing.plan_id === "pro"
                  ? "超额后需使用 BYOK 或升级 Teams"
                  : "套餐内已包含"}
              </span>
            </div>
            <div className="billing-row">
              <span className="billing-label">升级建议</span>
              <span className="billing-value">
                {billing.plan_id === "free"
                  ? "Pro $9.9/月起，享云端通道与 1 千万 Token 配额"
                  : billing.plan_id === "pro"
                  ? "Teams $24.9/席位，享团队协作与 5 千万 Token 配额"
                  : "Enterprise 联系销售获取定制方案"}
              </span>
            </div>
          </div>
        </div>
      )}

      {!cloudUsage && !localSummary && (
        <div className="empty-state">暂无用量数据，开始使用后数据将自动统计。</div>
      )}
    </div>
  );
}
