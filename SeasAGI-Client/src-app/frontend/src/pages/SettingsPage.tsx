import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import * as cmd from "../utils/commands";
import { useTranslation } from "../i18n";
import { SUPPORTED_LOCALES, type Locale } from "../i18n/index";
import { getErrorMessage } from "../utils/errors";
import type { OAuthConnection, OAuthProvider } from "../utils/types";

export function SettingsPage() {
  const auth = useAppStore((s) => s.auth);
  const appConfig = useAppStore((s) => s.appConfig);
  const setAuth = useAppStore((s) => s.setAuth);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const { t, locale, setLocale } = useTranslation();

  const [activeTab, setActiveTab] = useState<"account" | "routing">("account");
  const [routingStrategy, setRoutingStrategy] = useState(appConfig?.routing_strategy || "fallback");
  const [stickyUses, setStickyUses] = useState(appConfig?.sticky_channel_use || 3);
  const [platformApiURL, setPlatformApiURL] = useState("");
  const [platformApiError, setPlatformApiError] = useState("");
  const [oauthProviders, setOAuthProviders] = useState<OAuthProvider[]>([]);
  const [oauthConnections, setOAuthConnections] = useState<OAuthConnection[]>([]);
  const [oauthDrafts, setOAuthDrafts] = useState<Record<string, { clientId: string; clientSecret: string }>>({});
  const [oauthError, setOAuthError] = useState("");

  const handleLogout = async () => {
    try {
      await cmd.logout();
      setAuth({ is_logged_in: false, user_id: null, email: null });
    } catch (e) {
      console.error(e);
    }
  };

  const loadOAuthState = async () => {
    try {
      const [providers, connections] = await Promise.all([
        cmd.getOAuthProviders(),
        cmd.getOAuthConnections(),
      ]);
      setOAuthProviders(providers);
      setOAuthConnections(connections);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void loadOAuthState();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const baseUrl = await cmd.getPlatformAPIBaseURL();
        setPlatformApiURL(baseUrl);
      } catch {
        // state unavailable, keep defaults
      }
    })();
  }, []);

  useEffect(() => {
    if (!oauthConnections.some((item) => item.connecting)) return undefined;
    const timer = window.setInterval(() => {
      void loadOAuthState();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [oauthConnections]);

  const handleSaveRouting = async () => {
    try {
      await cmd.updateRoutingSettings(routingStrategy, stickyUses);
      if (appConfig) {
        setAppConfig({ ...appConfig, routing_strategy: routingStrategy, sticky_channel_use: stickyUses });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const rtkEnabled = appConfig?.rtk_enabled ?? true;
  const cavemanEnabled = appConfig?.caveman_enabled ?? false;

  const toggleRtkEnabled = () => {
    if (!appConfig) return;
    setAppConfig({ ...appConfig, rtk_enabled: !rtkEnabled });
  };

  const toggleCavemanEnabled = () => {
    if (!appConfig) return;
    setAppConfig({ ...appConfig, caveman_enabled: !cavemanEnabled });
  };

  const handleToggleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, toggle: () => void) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  };

  const connectionMap = useMemo(() => {
    const result = new Map<string, OAuthConnection>();
    oauthConnections.forEach((item) => result.set(item.name, item));
    return result;
  }, [oauthConnections]);

  return (
    <div className="page settings-page">
      <div className="page-header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p className="page-subtitle">管理账户、语言、OAuth 连接、本地代理与默认路由策略。</p>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric-card">
            <span className="hero-metric-label">登录状态</span>
            <strong className="hero-metric-value">{auth.is_logged_in ? "已登录" : "未登录"}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">OAuth 提供方</span>
            <strong className="hero-metric-value">{oauthProviders.length}</strong>
          </div>
        </div>
      </div>

      <div className="tab-bar settings-tab-bar">
        <button className={activeTab === "account" ? "active" : ""} onClick={() => setActiveTab("account")}>{t("settings.account")}</button>
        <button className={activeTab === "routing" ? "active" : ""} onClick={() => setActiveTab("routing")}>{t("settings.routing")}</button>
      </div>

      {activeTab === "account" && (
        <div className="settings-stack">
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>基础偏好</h2>
              <p className="hint">设置界面语言和本地扩展能力，控制客户端行为偏好。</p>
            </div>
            <div className="form-group">
              <label>{t("settings.language")}</label>
              <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>

            <div
              className={`settings-toggle-card settings-toggle-card-selectable${rtkEnabled ? " is-active" : ""}`}
              role="checkbox"
              aria-checked={rtkEnabled}
              tabIndex={0}
              onClick={toggleRtkEnabled}
              onKeyDown={(event) => handleToggleCardKeyDown(event, toggleRtkEnabled)}
            >
              <div>
                <div className="settings-toggle-title">{t("settings.rtkEnabled")}</div>
                <div className="hint">启用 RTK 能力增强本地运行时支持。</div>
              </div>
              <div className="form-checkbox" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  id="rtkEnabled"
                  checked={rtkEnabled}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(e) => {
                    if (appConfig) setAppConfig({ ...appConfig, rtk_enabled: e.target.checked });
                  }}
                />
                <label htmlFor="rtkEnabled" onClick={(event) => event.stopPropagation()}>启用</label>
              </div>
            </div>

            <div
              className={`settings-toggle-card settings-toggle-card-selectable${cavemanEnabled ? " is-active" : ""}`}
              role="checkbox"
              aria-checked={cavemanEnabled}
              tabIndex={0}
              onClick={toggleCavemanEnabled}
              onKeyDown={(event) => handleToggleCardKeyDown(event, toggleCavemanEnabled)}
            >
              <div>
                <div className="settings-toggle-title">{t("settings.cavemanEnabled")}</div>
                <div className="hint">启用后可选择更精简的输出风格。</div>
              </div>
              <div className="form-row">
                <div className="form-checkbox" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    id="cavemanEnabled"
                    checked={cavemanEnabled}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(e) => {
                      if (appConfig) setAppConfig({ ...appConfig, caveman_enabled: e.target.checked });
                    }}
                  />
                  <label htmlFor="cavemanEnabled" onClick={(event) => event.stopPropagation()}>启用</label>
                </div>
                {cavemanEnabled && (
                  <div className="form-group settings-inline-select" style={{ marginBottom: 0 }}>
                    <select
                      value={appConfig?.caveman_style ?? "concise"}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(e) => {
                        if (appConfig) setAppConfig({ ...appConfig, caveman_style: e.target.value });
                      }}
                    >
                      <option value="concise">Concise</option>
                      <option value="brief">Brief</option>
                      <option value="minimal">Minimal</option>
                      <option value="terse">Terse</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.platformApiUrl")}</h2>
              <p className="hint">{t("settings.platformApiUrlHint")}</p>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <input
                  value={platformApiURL}
                  onChange={(e) => setPlatformApiURL(e.target.value)}
                  placeholder="http://127.0.0.1:9318/api/v1"
                />
              </div>
              <button
                onClick={async () => {
                  try {
                    setPlatformApiError("");
                    await cmd.setPlatformAPIBaseURL(platformApiURL);
                    if (appConfig) {
                      setAppConfig({ ...appConfig, platform_api_base_url: platformApiURL });
                    }
                  } catch (e) {
                    setPlatformApiError(getErrorMessage(e, "保存失败"));
                  }
                }}
                className="btn-primary"
                style={{ height: 40, alignSelf: "flex-end" }}
              >
                {t("settings.platformApiUrlSave")}
              </button>
            </div>
            {platformApiError && <p className="error-msg" style={{ marginTop: 8 }}>{platformApiError}</p>}
          </div>

          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.oauthConnect")}</h2>
              <p className="hint">{t("settings.oauthHint")}</p>
              <p className="hint">{t("settings.oauthCallbackHint", { url: "http://127.0.0.1:43819/oauth/callback" })}</p>
            </div>
            {oauthError && <div className="error-msg" style={{ marginTop: 12 }}>{oauthError}</div>}
            <div className="oauth-provider-list">
              {oauthProviders.map((provider) => {
                const connection = connectionMap.get(provider.name);
                const draft = oauthDrafts[provider.name] || { clientId: "", clientSecret: "" };
                return (
                  <div key={provider.name} className="oauth-provider-card">
                    <div className="oauth-provider-head">
                      <div>
                        <div className="oauth-provider-name">{provider.displayName}</div>
                        <div className="oauth-provider-meta">
                          {connection?.connected
                            ? t("settings.oauthConnected")
                            : connection?.connecting
                              ? t("settings.oauthConnecting")
                              : t("settings.oauthNotConnected")}
                          {connection?.clientIDMask ? ` · ${connection.clientIDMask}` : ""}
                        </div>
                      </div>
                      <span className={`badge ${connection?.connected ? "badge-green" : connection?.connecting ? "badge-yellow" : "badge-blue"}`}>
                        {connection?.connected
                          ? t("settings.oauthConnected")
                          : connection?.connecting
                            ? t("settings.oauthConnecting")
                            : t("settings.oauthReady")}
                      </span>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>{t("settings.oauthClientId")}</label>
                        <input
                          value={draft.clientId}
                          onChange={(e) => setOAuthDrafts((current) => ({
                            ...current,
                            [provider.name]: { ...draft, clientId: e.target.value },
                          }))}
                          placeholder={t("settings.oauthClientIdPlaceholder")}
                        />
                      </div>
                      <div className="form-group">
                        <label>{t("settings.oauthClientSecret")}</label>
                        <input
                          type="password"
                          value={draft.clientSecret}
                          onChange={(e) => setOAuthDrafts((current) => ({
                            ...current,
                            [provider.name]: { ...draft, clientSecret: e.target.value },
                          }))}
                          placeholder={t("settings.oauthClientSecretPlaceholder")}
                        />
                      </div>
                    </div>

                    {connection?.expiresAt && (
                      <p className="hint">{t("settings.oauthExpiresAt", { value: new Date(connection.expiresAt).toLocaleString() })}</p>
                    )}
                    {connection?.error && <p className="error-msg" style={{ marginTop: 12 }}>{connection.error}</p>}

                    <div className="oauth-provider-actions">
                      <button
                        onClick={async () => {
                          try {
                            setOAuthError("");
                            const url = await cmd.startOAuthFlow(provider.name, draft.clientId, draft.clientSecret, "");
                            await loadOAuthState();
                            window.open(url, "_blank", "width=720,height=860");
                          } catch (e) {
                            setOAuthError(getErrorMessage(e, t("settings.oauthConnectFailed")));
                          }
                        }}
                        className="btn-primary btn-sm"
                      >
                        {t("settings.oauthConnect")}
                      </button>
                      {connection?.connected && (
                        <button
                          onClick={async () => {
                            await cmd.revokeOAuthToken(provider.name);
                            await loadOAuthState();
                          }}
                          className="btn-danger btn-sm"
                        >
                          {t("settings.oauthRevoke")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>账户状态</h2>
              <p className="hint">查看当前登录身份，或跳转到登录 / 注册页面。</p>
            </div>
            {auth.is_logged_in ? (
              <div className="settings-inline-actions">
                <span className="auth-email-label" style={{ marginBottom: 0 }}>已登录：{auth.email}</span>
                <button onClick={handleLogout} className="btn-secondary btn-sm">{t("settings.logout")}</button>
              </div>
            ) : (
              <p className="auth-email-label" style={{ marginBottom: 0 }}>
                未登录 — <NavLink to="/auth" className="link-btn">去登录 / 注册</NavLink>
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === "routing" && (
        <div className="settings-stack">
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.routingStrategy")}</h2>
              <p className="hint">设置默认路由策略和 Sticky 次数，控制请求在通道间的分配方式。</p>
            </div>
            <div className="routing-form-grid">
              <div className="form-group">
                <label>{t("settings.defaultStrategy")}</label>
                <select value={routingStrategy} onChange={(e) => setRoutingStrategy(e.target.value)}>
                  <option value="fallback">{t("settings.fallback")}</option>
                  <option value="round_robin">{t("settings.roundRobin")}</option>
                </select>
              </div>
              {routingStrategy === "round_robin" && (
                <div className="form-group">
                  <label>{t("settings.stickyCount")}</label>
                  <input type="number" value={stickyUses} onChange={(e) => setStickyUses(Number(e.target.value))} />
                </div>
              )}
            </div>
            <p className="hint">{routingStrategy === "fallback" ? t("settings.fallbackHint") : t("settings.roundRobinHint")}</p>
          </div>

          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>BYOK 优先策略</h2>
              <p className="hint">BYOK（Bring Your Own Key）让你使用自有 API Key 直接调用模型，不消耗平台配额，避免超额费用。</p>
            </div>
            <div className="byok-status-card">
              <div className="byok-title">💡 BYOK 优先级说明</div>
              <div className="byok-desc">
                <p><strong>使用场景：</strong>当你配置了自定义通道（使用自己的 API Key）时，建议启用 BYOK 优先策略。路由引擎会优先匹配本地 Key 通道，仅当本地 Key 不可用时才使用平台云端通道。</p>
                <p><strong>成本优势：</strong>BYOK 请求不消耗 $9.9 Pro 套餐的 1000 万 Token 配额，适合高用量场景。</p>
                <p><strong>超额保护：</strong>免费版用户配额用完后可通过 BYOK 继续使用，无需升级套餐。</p>
                <p><strong>在用量页中：</strong>本地用量和云端用量已分开统计。你可以在用量页查看配额消耗，并结合路由策略建议优化调用方式。</p>
              </div>
            </div>
            <label className="toggle-row settings-toggle-block">
              <span>优先使用 BYOK（本地 Key）</span>
              <input type="checkbox" checked={true} onChange={() => {}} />
            </label>
          </div>

          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.autoLaunch")}</h2>
              <p className="hint">控制应用随系统启动的行为，便于长期驻留本地网关。</p>
            </div>
            <div className="settings-inline-actions">
              <button onClick={() => cmd.setAutoLaunch(true)} className="btn-secondary">{t("settings.turnOn")}</button>
              <button onClick={() => cmd.setAutoLaunch(false)} className="btn-secondary">{t("settings.turnOff")}</button>
            </div>
          </div>
          <div className="settings-save-row">
            <button onClick={handleSaveRouting} className="btn-primary">{t("settings.saveRouting")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
