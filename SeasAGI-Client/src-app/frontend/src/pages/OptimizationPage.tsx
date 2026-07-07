import { useState, useEffect, useMemo } from "react";
import { getOptimizationPlan, getOptimizationConfig, setOptimizationConfig, applyRecommendation, syncOptimizationConfigToCloud, syncOptimizationConfigFromCloud, getCloudBilling } from "../utils/commands";
import type { OptimizationPlan, OptimizationConfig, CloudBilling, ModelCombo, TaskProfile } from "../utils/types";
import { useAppStore } from "../stores/appStore";

const MODE_LABELS: Record<string, string> = {
  quality_first: "质量优先",
  value_first: "性价比优先",
  auto_strategy: "自动策略",
};

const MODE_DESCS: Record<string, string> = {
  quality_first: "优先推荐质量更高的模型，适合对输出质量有严格要求的场景",
  value_first: "优先推荐性价比最优的模型，在保证质量的前提下最大限度降低成本",
  auto_strategy: "智能分析用量数据，自动选择最适合当前使用模式的优化策略",
};

const TASK_TYPE_META: Record<string, { title: string; subtitle: string; hint: string }> = {
  general_chat: {
    title: "通用建议",
    subtitle: "适合问答、写作、总结等日常对话场景",
    hint: "优先平衡质量、成本和稳定性。",
  },
  tool_calling: {
    title: "工具调用建议",
    subtitle: "适合函数调用、外部 API 编排和 Agent 执行场景",
    hint: "优先考虑工具调用成功率、参数兼容性和多轮稳定性。",
  },
  structured_output: {
    title: "结构化输出建议",
    subtitle: "适合 JSON、表单填充和机器可读输出场景",
    hint: "优先考虑格式稳定性和结构化约束遵循能力。",
  },
  long_context: {
    title: "长上下文建议",
    subtitle: "适合长文档、多轮会话和知识库整合场景",
    hint: "优先考虑上下文容量、长文本稳定性和连续推理表现。",
  },
  vision: {
    title: "视觉理解建议",
    subtitle: "适合图像理解、视觉问答和多模态分析场景",
    hint: "优先考虑图文混合理解与多模态兼容能力。",
  },
};

const HIGH_COST_MODELS = new Set([
  "gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-4.1-mini",
  "claude-3-5-sonnet", "claude-3-opus",
  "gemini-2.0-pro", "gemini-2.5-pro",
]);

function isHighCost(model: string): boolean {
  for (const prefix of HIGH_COST_MODELS) {
    if (model.startsWith(prefix)) return true;
  }
  return false;
}

function ModeIcon({ mode }: { mode: string }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (mode === "quality_first") {
    return <svg {...props}><path d="M12 4l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L5.2 9l4.7-.7L12 4z" /></svg>;
  }
  if (mode === "value_first") {
    return <svg {...props}><path d="M12 3v18" /><path d="M16.5 7.5c0-1.7-1.8-3-4.5-3s-4.5 1.3-4.5 3 1.8 3 4.5 3 4.5 1.3 4.5 3-1.8 3-4.5 3-4.5-1.3-4.5-3" /></svg>;
  }
  return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M9 9h6v6H9z" /><path d="M9 2.5v3" /><path d="M15 2.5v3" /><path d="M9 18.5v3" /><path d="M15 18.5v3" /></svg>;
}

export function OptimizationPage({ embedded, taskType = "general_chat" }: { embedded?: boolean; taskType?: TaskProfile["task_type"] }) {
  const [plan, setPlan] = useState<OptimizationPlan | null>(null);
  const [config, setConfig] = useState<OptimizationConfig | null>(null);
  const [billing, setBilling] = useState<CloudBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [activeMode, setActiveMode] = useState("value_first");
  const [applying, setApplying] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [appliedRecs, setAppliedRecs] = useState<Set<string>>(new Set());
  const currentTaskMeta = TASK_TYPE_META[taskType] || TASK_TYPE_META.general_chat;
  const taskSections = useMemo(
    () =>
      Object.entries(TASK_TYPE_META).map(([key, meta]) => ({
        key,
        ...meta,
        active: key === taskType,
      })),
    [taskType],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [cfg, p, b] = await Promise.all([
          getOptimizationConfig(),
          getOptimizationPlan("value_first", taskType),
          getCloudBilling().catch(() => null),
        ]);
        setConfig(cfg);
        setPlan(p);
        setBilling(b);
        setActiveMode(cfg.mode || "value_first");
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [taskType]);

  const switchMode = async (mode: string) => {
    setLoading(true);
    setActiveMode(mode);
    try {
      const p = await getOptimizationPlan(mode, taskType);
      setPlan(p);
      if (config) {
        const updated = { ...config, mode };
        setConfig(updated);
        await setOptimizationConfig({ mode } as Record<string, any>);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = async (patch: Partial<OptimizationConfig>) => {
    if (!config) return;
    setSaving(true);
    const updated = { ...config, ...patch };
    setConfig(updated);
    try {
      await setOptimizationConfig(updated as Record<string, any>);
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (toModel: string) => {
    setApplying(toModel);
    try {
      await applyRecommendation(toModel, config?.default_preset || "budget");
      setAppliedRecs((prev) => new Set(prev).add(toModel));
    } catch {
    } finally {
      setApplying(null);
    }
  };

  const handleSyncToCloud = async () => {
    setSyncMsg("正在同步到云端...");
    try {
      await syncOptimizationConfigToCloud();
      setSyncMsg("✓ 已同步到云端");
    } catch {
      setSyncMsg("✗ 同步失败，请确认已登录");
    }
    setTimeout(() => setSyncMsg(null), 3000);
  };

  const handleSyncFromCloud = async () => {
    setSyncMsg("正在从云端同步...");
    try {
      const result = await syncOptimizationConfigFromCloud();
      if (result) {
        setConfig(result);
        setActiveMode(result.mode || "value_first");
        const p = await getOptimizationPlan(result.mode || "value_first", taskType);
        setPlan(p);
        setSyncMsg("✓ 已从云端同步");
      } else {
        setSyncMsg("✗ 云端无配置或同步失败");
      }
    } catch {
      setSyncMsg("✗ 同步失败，请确认已登录");
    }
    setTimeout(() => setSyncMsg(null), 3000);
  };

  if (loading && !plan) return <div className="page"><div className="loading">正在分析用量数据...</div></div>;

  const currentPlanID = billing?.plan_id || "free";
  const isFree = currentPlanID === "free";
  const isPro = currentPlanID === "pro";

  const planLabel: Record<string, string> = {
    free: "Free",
    pro: "Pro",
    teams: "Teams",
    enterprise: "Enterprise",
  };

  const content = (
    <>
      <div className="plan-context-banner">
        <span className="plan-context-icon">💡</span>
        <span className="plan-context-text">
          当前场景：{currentTaskMeta.title}。{currentTaskMeta.hint}
          <br />
          {isFree && "当前为 Free 套餐，推荐以 BYOK 优先使用本地 Key 调用。云端通道超额后将被限制，建议升级到 Pro 获取云端通道和更高配额。"}
          {isPro && "当前为 Pro 套餐。推荐使用 BYOK + 云端通道均衡模式。高成本模型（GPT-4、Claude Sonnet 等）超额后需使用 BYOK 或升级 Teams。"}
          {!isFree && !isPro && `当前为 ${planLabel[currentPlanID]} 套餐，可自由使用云端通道与高级模型，不受超额限制。`}
        </span>
      </div>

      <div className="section section-card">
        <div className="section-heading-row">
          <h2 className="section-title">任务类型分区</h2>
          <div className="section-meta-text">当前高亮场景会驱动推荐排序与建议文案</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {taskSections.map((section) => (
            <div
              key={section.key}
              style={{
                border: section.active ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: section.active ? "var(--bg-tertiary)" : "var(--bg-card)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{section.title}</div>
              <div className="text-muted">{section.subtitle}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="section section-card">
        <h2 className="section-title">优化模式</h2>
        <div className="mode-picker">
          {["quality_first", "value_first", "auto_strategy"].map((mode) => (
            <button
              key={mode}
              className={`mode-btn ${activeMode === mode ? "active" : ""}`}
              onClick={() => switchMode(mode)}
              disabled={loading}
            >
              <span className="mode-icon"><ModeIcon mode={mode} /></span>
              <span className="mode-label">{MODE_LABELS[mode]}</span>
              <span className="mode-desc">{MODE_DESCS[mode]}</span>
            </button>
          ))}
        </div>
      </div>

      {plan && plan.recommendations.length > 0 && (
        <div className="section section-card">
          <div className="section-heading-row">
            <h2 className="section-title">{currentTaskMeta.title}</h2>
            <div className="strategy-badge">
              策略：{plan.strategy === "cost_optimized" ? "成本优先" : plan.strategy === "balanced" ? "均衡推荐" : `${MODE_LABELS[plan.mode] || plan.mode}`}
            </div>
            <div className="section-meta-text">{currentTaskMeta.subtitle}</div>
          </div>
          <div className="rec-list">
            {plan.recommendations.map((rec, idx) => {
              const recIsHighCost = isHighCost(rec.to_model);
              const needsUpgrade = recIsHighCost && (isFree || isPro);
              const useBYOK = isFree && rec.channel_name && rec.channel_name !== "local";

              return (
                <div key={idx} className="rec-card">
                  <div className="rec-main">
                    <div className="rec-content">
                      <div className="rec-header">
                        <span className="rec-from">{rec.from_model}</span>
                        <span className="rec-arrow">→</span>
                        <span className="rec-to">{rec.to_model}</span>
                        {rec.model_tag === "open" && <span className="tag tag-open">开源</span>}
                        {rec.model_tag !== "open" && <span className="tag tag-closed">闭源</span>}
                        {recIsHighCost && <span className="tag tag-highcost">高成本</span>}
                        {useBYOK && <span className="tag tag-byok">建议 BYOK</span>}
                        {needsUpgrade && (
                          <span className="tag tag-premium">
                            {isFree ? "升级 Pro+" : "升级 Teams+"}
                          </span>
                        )}
                      </div>
                      <div className="rec-info">
                        <span className="rec-channel">通道：{rec.channel_name || "未指定"}</span>
                        <span className="rec-sep">·</span>
                        <span className="rec-quality">
                          质量：{rec.quality_diff === "equivalent_or_better" ? "同等或更好" : rec.quality_diff === "better" ? "更好" : "可接受"}
                        </span>
                        {rec.avg_latency_ms > 0 && (
                          <>
                            <span className="rec-sep">·</span>
                            <span className="rec-latency">
                              延迟：{rec.avg_latency_ms < 1000 ? `${Math.round(rec.avg_latency_ms)}ms` : `${(rec.avg_latency_ms / 1000).toFixed(1)}s`}
                            </span>
                          </>
                        )}
                        {rec.error_rate > 0 && (
                          <>
                            <span className="rec-sep">·</span>
                            <span className="rec-error">
                              错误率：{(rec.error_rate * 100).toFixed(1)}%
                            </span>
                          </>
                        )}
                      </div>
                      <div className="rec-reason">{rec.reason}</div>
                      {needsUpgrade && (
                        <div className="rec-plan-hint">
                          ⚠ 该模型在当前套餐超额后不可用。建议{isFree ? "升级到 Pro 或使用 BYOK 调用" : "升级到 Teams 或使用 BYOK 调用"}
                        </div>
                      )}
                      {useBYOK && (
                        <div className="rec-plan-hint rec-plan-hint-byok">
                          💡 BYOK 推荐：使用自有 API Key 调用该模型，可避免消耗平台配额和超额费用
                        </div>
                      )}
                    </div>
                    <div className="rec-side">
                      {rec.savings_usd > 0 ? (
                        <span className="rec-save green">省 ${rec.savings_usd.toFixed(2)}/月</span>
                      ) : (
                        <span className="rec-save blue">升级 +${(-rec.savings_usd).toFixed(2)}/月</span>
                      )}
                      <div className="rec-actions">
                        <button
                          className={`btn-rec-apply ${appliedRecs.has(rec.to_model) ? "applied" : ""}`}
                          onClick={() => handleApply(rec.to_model)}
                          disabled={applying === rec.to_model}
                        >
                          {applying === rec.to_model ? "应用中..." : appliedRecs.has(rec.to_model) ? "✓ 已应用" : "应用推荐"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 多步回退 Combo 建议 */}
      {plan && plan.recommendations.length >= 2 && (
        <div className="section section-card">
          <div className="section-heading-row">
            <h2 className="section-title">多步回退 Combo 建议</h2>
            <span className="badge badge-new">新功能</span>
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>
            基于优化分析生成的完整回退方案，优先级排序：主模型 → 备用模型 → 保底模型
          </p>

          {(() => {
            const recs = plan.recommendations;
            const steps = recs.slice(0, 3).map((r, i) => ({
              role: i === 0 ? "primary" : i === 1 ? "backup" : "last_resort" as "primary" | "backup" | "last_resort",
              model: r.to_model,
              channelName: r.channel_name || "",
              quality: r.quality_diff,
              reason: r.reason,
            }));
            const stepLabels: Record<string, string> = { primary: "主模型", backup: "备用模型", last_resort: "保底模型" };
            const comboName = `智能推荐 ${currentTaskMeta.title} ${activeMode === "quality_first" ? "质量优先" : activeMode === "value_first" ? "性价比" : "自动"}方案`;
            const isApplied = appliedRecs.size > 0 && appliedRecs.has(comboName);

            return (
              <div className="combo-suggestion-card">
                <div className="combo-suggestion-steps">
                  {steps.map((s, si) => (
                    <div key={si} className={`combo-suggestion-step ${s.role}`}>
                      <div className="combo-suggestion-step-role">{stepLabels[s.role]}</div>
                      <div className="combo-suggestion-step-model">{s.model}</div>
                      {s.channelName && <div className="combo-suggestion-step-channel">通道：{s.channelName}</div>}
                      <div className="combo-suggestion-step-reason">{s.reason}</div>
                      {si < steps.length - 1 && <div className="combo-suggestion-arrow">↓ 回退 ↓</div>}
                    </div>
                  ))}
                </div>
                <div className="combo-suggestion-actions">
                  <button
                    className="btn-primary"
                    disabled={isApplied || loading}
                    onClick={async () => {
                      setLoading(true);
                      try {
                        const setCombos = useAppStore.getState().setCombos;
                        const existing = useAppStore.getState().combos;
                        const newCombo: ModelCombo = {
                          name: comboName,
                          models: steps.map(s => s.model),
                          steps: steps.map(s => ({ model: s.model, step_role: s.role })),
                          strategy: "fallback",
                          sticky_uses: 1,
                          task_profile: { task_type: taskType, priority_providers: [], fallback_order: [] },
                        };
                        const updated = [...existing, newCombo];
                        setCombos(updated);
                        appliedRecs.add(comboName);
                        setAppliedRecs(new Set(Array.from(appliedRecs)));
                      } catch {}
                      setLoading(false);
                    }}
                  >
                    {isApplied ? "✓ 已应用" : "应用为 Combo"}
                  </button>
                  <span className="hint" style={{ marginLeft: 8 }}>共 {steps.length} 步回退方案</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {plan && plan.recommendations.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon empty-icon-check">OK</div>
          <p>{currentTaskMeta.title}下当前模型组合已处于较优状态，暂无优化建议。</p>
        </div>
      )}

      <div className="section section-card">
        <div className="section-heading-row">
          <h2 className="section-title">策略配置</h2>
          <div className="config-toolbar">
            <button className="btn-outline" onClick={() => setShowConfig(!showConfig)}>
              {showConfig ? "收起" : "展开"}策略配置
            </button>
            <button className="btn-outline" onClick={handleSyncToCloud}>
              同步到云端
            </button>
            <button className="btn-outline" onClick={handleSyncFromCloud}>
              从云端恢复
            </button>
            {syncMsg && <span className="sync-msg">{syncMsg}</span>}
          </div>
        </div>
        {showConfig && config && (
          <div className="opt-config-panel">
            <div className="config-group">
              <h4>动态 429 惩罚降级</h4>
              <label className="toggle-row">
                <span>启用惩罚降级</span>
                <input type="checkbox" checked={config.penalty_enabled} onChange={(e) => updateConfig({ penalty_enabled: e.target.checked })} />
              </label>
              <label className="input-row">
                <span>衰减间隔（秒）</span>
                <input type="number" value={config.penalty_decay_sec} min={30} max={600} onChange={(e) => updateConfig({ penalty_decay_sec: parseInt(e.target.value) || 120 })} disabled={!config.penalty_enabled} />
              </label>
            </div>

            <div className="config-group">
              <h4>Key 健康检查</h4>
              <label className="toggle-row">
                <span>启用健康检查</span>
                <input type="checkbox" checked={config.health_check_enabled} onChange={(e) => updateConfig({ health_check_enabled: e.target.checked })} />
              </label>
              <label className="input-row">
                <span>探活间隔（秒）</span>
                <input type="number" value={config.health_check_sec} min={60} max={3600} onChange={(e) => updateConfig({ health_check_sec: parseInt(e.target.value) || 300 })} disabled={!config.health_check_enabled} />
              </label>
              <label className="input-row">
                <span>最大连续失败</span>
                <input type="number" value={config.health_max_failures} min={1} max={20} onChange={(e) => updateConfig({ health_max_failures: parseInt(e.target.value) || 3 })} disabled={!config.health_check_enabled} />
              </label>
            </div>

            <div className="config-group">
              <h4>Key 级冷却</h4>
              <label className="toggle-row">
                <span>启用冷却机制</span>
                <input type="checkbox" checked={config.cooldown_enabled} onChange={(e) => updateConfig({ cooldown_enabled: e.target.checked })} />
              </label>
              <label className="input-row">
                <span>冷却时长（秒）</span>
                <input type="number" value={config.cooldown_sec} min={10} max={600} onChange={(e) => updateConfig({ cooldown_sec: parseInt(e.target.value) || 120 })} disabled={!config.cooldown_enabled} />
              </label>
            </div>

            <div className="config-group">
              <h4>会话粘滞路由</h4>
              <label className="toggle-row">
                <span>启用会话粘滞</span>
                <input type="checkbox" checked={config.sticky_enabled} onChange={(e) => updateConfig({ sticky_enabled: e.target.checked })} />
              </label>
              <label className="input-row">
                <span>粘滞 TTL（秒）</span>
                <input type="number" value={config.sticky_ttl_sec} min={60} max={86400} onChange={(e) => updateConfig({ sticky_ttl_sec: parseInt(e.target.value) || 1800 })} disabled={!config.sticky_enabled} />
              </label>
            </div>

            <div className="config-group">
              <h4>Fallback 排序预设</h4>
              <label className="toggle-row">
                <span>启用排序预设</span>
                <input type="checkbox" checked={config.preset_enabled} onChange={(e) => updateConfig({ preset_enabled: e.target.checked })} />
              </label>
              <label className="input-row">
                <span>默认预设</span>
                <select value={config.default_preset} onChange={(e) => updateConfig({ default_preset: e.target.value })} disabled={!config.preset_enabled}>
                  <option value="intelligence">智能优先</option>
                  <option value="budget">成本优先</option>
                  <option value="speed">速度优先</option>
                </select>
              </label>
            </div>

            {saving && <div className="saving-hint">保存中...</div>}
          </div>
        )}
      </div>
    </>
  );

  return embedded ? content : <div className="page optimization-page">{content}</div>;
}
