import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import * as cmd from "../utils/commands";
import { useTranslation } from "../i18n";

type AuthMode = "login" | "register";

const PLAN_BENEFITS = [
  {
    tier: "Free",
    price: "免费",
    audience: "适合尝鲜",
    features: ["本地无限使用", "BYOK 支持", "基础路由", "用量统计"],
  },
  {
    tier: "Pro",
    price: "$9.9/月",
    audience: "适合个人开发者",
    features: ["1 千万 Token 配额", "云端中继通道", "模型优化建议", "用量分析面板"],
    accent: true,
  },
  {
    tier: "Teams",
    price: "$24.9/席位/月",
    audience: "适合小团队",
    features: ["5 千万共享配额", "团队协作空间", "共享策略模板", "集中管理与看板"],
  },
  {
    tier: "Enterprise",
    price: "联系销售",
    audience: "适合企业采购",
    features: ["审计日志与合规", "自定义策略", "SLA 保障", "私有化部署"],
  },
];

export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAppStore((s) => s.setAuth);
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        await cmd.register(email, password, displayName || email.split("@")[0]);
      } else {
        await cmd.login(email, password);
      }
      const authState = await cmd.getAuthState();
      setAuth(authState);
      navigate("/");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message :
        typeof err === "string" ? err :
        err && typeof err === "object" && "message" in err ? String((err as {message: string}).message) :
        err && typeof err === "object" && "error" in err ? String((err as {error: string}).error) :
        "操作失败，请重试";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
  };

  return (
    <div className="auth-page-wide">
      <div className="auth-layout">
        <div className="auth-form-panel">
          <div className="auth-card">
            <div className="auth-brand">
              <div className="auth-brand-mark">S</div>
              <div>
                <div className="auth-brand-title">SeasAGI</div>
                <div className="auth-brand-subtitle">云端同步 · 智能路由 · 用量分析</div>
              </div>
            </div>

            <div className="auth-tabs">
              <button
                className={`auth-tab ${mode === "register" ? "active" : ""}`}
                onClick={() => mode !== "register" && switchMode()}
              >
                注册
              </button>
              <button
                className={`auth-tab ${mode === "login" ? "active" : ""}`}
                onClick={() => mode !== "login" && switchMode()}
              >
                登录
              </button>
            </div>

            {mode === "register" ? (
              <p className="auth-desc">注册云端账户，解锁用量分析、模型推荐与多端同步能力</p>
            ) : (
              <p className="auth-desc">登录已有账户，同步云端配置和用量数据</p>
            )}

            {error && <div className="error-msg">{error}</div>}

            <form onSubmit={handleSubmit}>
              {mode === "register" && (
                <div className="form-group">
                  <input
                    type="text"
                    placeholder="显示名称（可选）"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              )}
              <div className="form-group">
                <input
                  type="email"
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <input
                  type="password"
                  placeholder="密码（至少6位）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <button type="submit" className="btn-primary btn-full" disabled={loading}>
                {loading
                  ? (mode === "register" ? "注册中..." : "登录中...")
                  : (mode === "register" ? "注册" : "登录")}
              </button>
            </form>

            <div className="auth-switch">
              {mode === "register" ? (
                <>已有账户？<button type="button" className="link-btn" onClick={switchMode}>去登录</button></>
              ) : (
                <>没有账户？<button type="button" className="link-btn" onClick={switchMode}>去注册</button></>
              )}
            </div>

            <div className="auth-skip">
              <div className="auth-divider"><span>{t("auth.enterLocalMode")}</span></div>
              <p className="auth-local-desc">{t("auth.localModeDesc")}</p>
              <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
                {t("auth.enterLocalMode")}
              </button>
            </div>
          </div>
        </div>

        <div className="auth-benefits-panel">
          <div className="auth-benefits-header">
            <h2>注册后可获得的云端权益</h2>
            <p>无论选择哪个套餐，你都拥有本地无限使用权。云端账户额外解锁以下能力。</p>
          </div>
          <div className="auth-benefits-grid">
            {PLAN_BENEFITS.map((plan) => (
              <div key={plan.tier} className={`auth-benefit-card ${plan.accent ? "auth-benefit-accent" : ""}`}>
                <div className="auth-benefit-head">
                  <span className="auth-benefit-tier">{plan.tier}</span>
                  <span className="auth-benefit-price">{plan.price}</span>
                </div>
                <div className="auth-benefit-audience">{plan.audience}</div>
                <ul className="auth-benefit-features">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
