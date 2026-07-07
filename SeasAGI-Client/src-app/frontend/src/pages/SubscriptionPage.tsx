import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { useAppStore } from "../stores/appStore";
import { createCheckoutSession, getPlans, openInBrowser } from "../utils/commands";

interface PlanInfo {
  plan_id: string;
  name: string;
  description: string;
  price: number;
  monthly_quota: number;
  max_rpm: number;
  max_tpm: number;
  sort_order: number;
  relay_enabled?: boolean;
}

const PLAN_AUDIENCES: Record<string, { zh: string; en: string }> = {
  free: { zh: "适合尝鲜、BYOK 用户", en: "For trial & BYOK users" },
  pro: { zh: "适合个人开发者", en: "For individual developers" },
  teams: { zh: "适合小团队与工作室", en: "For small teams & studios" },
  enterprise: { zh: "适合企业采购", en: "For enterprise procurement" },
};

const PLAN_VALUES: Record<string, { zh: string; en: string }> = {
  free: { zh: "本地优先 · 无限使用", en: "Local-first · Unlimited use" },
  pro: { zh: "效率 · 分析 · 云增值", en: "Efficiency · Analytics · Cloud" },
  teams: { zh: "协作 · 共享 · 集中管理", en: "Collaboration · Sharing · Control" },
  enterprise: { zh: "治理 · 审计 · SLA", en: "Governance · Audit · SLA" },
};

export function SubscriptionPage() {
  const { t, locale } = useTranslation();
  const auth = useAppStore((s) => s.auth);
  const cloudBilling = useAppStore((s) => s.cloudBilling);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [teamSeats, setTeamSeats] = useState<Record<string, number>>({});

  const isZh = locale === "zh-CN";

  useEffect(() => {
    (async () => {
      try {
        const items = await getPlans();
        setPlans(items.map((p: any) => ({
          plan_id: p.plan_id,
          name: p.name,
          description: p.description,
          price: p.price,
          monthly_quota: p.monthly_quota,
          max_rpm: p.max_rpm,
          max_tpm: p.max_tpm,
          sort_order: p.sort_order || 0,
          relay_enabled: p.relay_enabled,
        })));
      } catch {
        setPlans([]);
      }
      setLoading(false);
    })();
  }, []);

  const handleSubscribe = async (planId: string, quantity?: number) => {
    if (!auth.is_logged_in) {
      setMessageType("error");
      setMessage(isZh ? "请先登录" : "Please log in first");
      return;
    }
    setSubscribing(planId);
    setMessage(null);
    try {
      const result = await createCheckoutSession(planId, quantity || 1);
      const url = result?.checkout_url;
      if (url) {
        setMessageType("success");
        setMessage(isZh ? "正在打开支付页面..." : "Opening payment page...");
        await openInBrowser(url);
      } else {
        setMessageType("success");
        setMessage(isZh ? `已切换到 ${planId} 套餐` : `Switched to ${planId} plan`);
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (e: any) {
      setMessageType("error");
      setMessage(e.message || (isZh ? "操作失败" : "Operation failed"));
    }
    setSubscribing(null);
  };

  if (loading) return <div className="page"><div className="loading">{isZh ? "加载中..." : "Loading..."}</div></div>;

  const currentPlan = cloudBilling?.plan_id || "free";

  const sorted = [...plans].sort((a, b) => a.sort_order - b.sort_order).filter(p => p.plan_id !== "enterprise");

  return (
    <div className="page subscription-page">
      <div className="page-header">
        <div>
          <h1>{t("subscription.title")}</h1>
          <p className="page-subtitle">{isZh ? "选择适合你的套餐，开始高效管理 AI 调用。" : "Choose the right plan for your needs."}</p>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric-card">
            <span className="hero-metric-label">{isZh ? "当前套餐" : "Current Plan"}</span>
            <strong className="hero-metric-value">{currentPlan}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">{isZh ? "可选套餐" : "Available Plans"}</span>
            <strong className="hero-metric-value">{plans.length}</strong>
          </div>
        </div>
      </div>

      {message && (
        <div className="status-card" style={{ marginBottom: 16, padding: 12, borderColor: messageType === "error" ? "var(--red)" : "var(--green)" }}>
          {message}
        </div>
      )}

      <div className="section section-card">
        <div className="section-heading">
          <h2>{isZh ? "套餐列表" : "Plans"}</h2>
          <p className="hint">{isZh ? "根据团队规模和需求选择最适合的方案。" : "Pick the plan that fits your needs."}</p>
        </div>
        <div className="plan-cards">
        {sorted.map((plan) => {
          const isCurrent = currentPlan === plan.plan_id;
          const audience = PLAN_AUDIENCES[plan.plan_id] || { zh: "", en: "" };
          const value = PLAN_VALUES[plan.plan_id] || { zh: "", en: "" };
          const isEnterprise = plan.plan_id === "enterprise";
          const isFree = plan.plan_id === "free";
          const isTeams = plan.plan_id === "teams";
          const seats = teamSeats[plan.plan_id] || 3;
          const totalPrice = plan.price * seats;

          return (
            <div key={plan.plan_id} className={`plan-card ${isCurrent ? "plan-current" : ""} ${isEnterprise ? "plan-enterprise" : ""}`}>
              <div className="plan-card-header">
                <h2 className="plan-name">{plan.name}</h2>
                {isCurrent && <span className="badge badge-green">{isZh ? "当前套餐" : "Current"}</span>}
              </div>
              {isEnterprise ? (
                <div className="plan-price">
                  <span className="plan-amount">{isZh ? "联系销售" : "Contact Sales"}</span>
                </div>
              ) : isTeams ? (
                <div className="plan-price">
                  <span className="plan-amount">${plan?.price || 0}</span>
                  <span className="plan-period">/seat/mo</span>
                </div>
              ) : (
                <div className="plan-price">
                  <span className="plan-amount">${plan?.price || 0}</span>
                  <span className="plan-period">{isFree ? "" : "/mo"}</span>
                </div>
              )}
              <div className="plan-audience">{isZh ? audience.zh : audience.en}</div>
              <div className="plan-value-tag">{isZh ? value.zh : value.en}</div>
              <p className="plan-desc">{isZh ? plan.description : plan.description}</p>
              <ul className="plan-features">
                <li><strong>{plan?.monthly_quota ? (plan.monthly_quota >= 1000000 ? `${(plan.monthly_quota / 1000000).toFixed(0)}M` : plan.monthly_quota.toLocaleString()) : (isEnterprise ? (isZh ? "自定义配额" : "Custom quota") : (isZh ? "无限" : "Unlimited"))}</strong> {isZh ? "月请求配额" : "monthly requests"}</li>
                <li>{isZh ? "最大" : "Max"} RPM: <strong>{plan?.max_rpm || 0}</strong></li>
                <li>{isZh ? "最大" : "Max"} TPM: <strong>{plan?.max_tpm?.toLocaleString() || 0}</strong></li>
                {plan.relay_enabled && <li className="feature-yes">{isZh ? "✓ 云端中继通道" : "✓ Cloud relay channels"}</li>}
                {!plan.relay_enabled && !isFree && <li className="feature-no">{isZh ? "✗ 云端中继" : "✗ Cloud relay"}</li>}
              </ul>
              {isEnterprise ? (
                <button
                  className="btn-outline"
                  onClick={() => openInBrowser("https://github.com/neeke/seasagi/issues")}
                  style={{ width: "100%" }}
                >
                  {isZh ? "📞 联系销售" : "📞 Contact Sales"}
                </button>
              ) : isFree ? (
                <a
                  href="https://github.com/neeke/seasagi"
                  className="btn-outline"
                  style={{ width: "100%", justifyContent: "center", display: "flex", textDecoration: "none" }}
                >
                  {isZh ? "💻 免费使用" : "💻 Get Started Free"}
                </a>
              ) : isTeams ? (
                <div style={{ width: "100%" }}>
                  <div className="seat-selector">
                    <button
                      className="seat-btn"
                      onClick={() => setTeamSeats(prev => ({ ...prev, [plan.plan_id]: Math.max(1, (prev[plan.plan_id] || 3) - 1) }))}
                      disabled={seats <= 1}
                    >−</button>
                    <span className="seat-count">{seats} {isZh ? "席位" : "seats"}</span>
                    <button
                      className="seat-btn"
                      onClick={() => setTeamSeats(prev => ({ ...prev, [plan.plan_id]: Math.min(50, (prev[plan.plan_id] || 3) + 1) }))}
                      disabled={seats >= 50}
                    >+</button>
                  </div>
                  <div className="seat-total">${totalPrice.toFixed(2)}/mo {isZh ? "总计" : "total"}</div>
                  <button
                    className={isCurrent ? "btn-secondary" : "btn-primary"}
                    onClick={() => handleSubscribe(plan.plan_id, seats)}
                    disabled={subscribing === plan.plan_id || isCurrent}
                    style={{ width: "100%", marginTop: 8 }}
                  >
                    {subscribing === plan.plan_id ? (isZh ? "处理中..." : "Processing...") :
                     isCurrent ? (isZh ? "当前套餐" : "Current Plan") :
                     `${isZh ? "订阅" : "Subscribe"} $${totalPrice.toFixed(2)}/mo`}
                  </button>
                </div>
              ) : (
                <button
                  className={isCurrent ? "btn-secondary" : "btn-primary"}
                  onClick={() => handleSubscribe(plan.plan_id)}
                  disabled={subscribing === plan.plan_id || isCurrent}
                  style={{ width: "100%" }}
                >
                  {subscribing === plan.plan_id ? (isZh ? "处理中..." : "Processing...") :
                   isCurrent ? (isZh ? "当前套餐" : "Current Plan") :
                   `Subscribe $${plan.price}/mo`}
                </button>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
