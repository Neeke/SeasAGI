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
                <div className="auth-brand-subtitle">{t("auth.brandSubtitle")}</div>
              </div>
            </div>

            <div className="auth-tabs">
              <button
                className={`auth-tab ${mode === "register" ? "active" : ""}`}
                onClick={() => mode !== "register" && switchMode()}
              >
                {t("auth.register")}
              </button>
              <button
                className={`auth-tab ${mode === "login" ? "active" : ""}`}
                onClick={() => mode !== "login" && switchMode()}
              >
                {t("auth.login")}
              </button>
            </div>

            {mode === "register" ? (
              <p className="auth-desc">{t("auth.registerDesc")}</p>
            ) : (
              <p className="auth-desc">{t("auth.loginDesc")}</p>
            )}

            {error && <div className="error-msg">{error}</div>}

            <form onSubmit={handleSubmit}>
              {mode === "register" && (
                <div className="form-group">
                  <input
                    type="text"
                    placeholder={t("auth.displayNamePlaceholder")}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              )}
              <div className="form-group">
                <input
                  type="email"
                  placeholder={t("settings.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <input
                  type="password"
                  placeholder={t("auth.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <button type="submit" className="btn-primary btn-full" disabled={loading}>
                {loading
                  ? (mode === "register" ? t("auth.registering") : t("auth.loggingIn"))
                  : (mode === "register" ? t("auth.register") : t("auth.login"))}
              </button>
            </form>

            <div className="auth-switch">
              {mode === "register" ? (
                <>{t("auth.hasAccount")}<button type="button" className="link-btn" onClick={switchMode}>{t("auth.goLogin")}</button></>
              ) : (
                <>{t("auth.noAccount")}<button type="button" className="link-btn" onClick={switchMode}>{t("auth.goRegister")}</button></>
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
            <h2>{t("auth.cloudBenefitsTitle")}</h2>
            <p>{t("auth.cloudBenefitsDesc")}</p>
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
