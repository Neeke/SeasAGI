import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import * as cmd from "../utils/commands";
import { useTranslation } from "../i18n";
import { SUPPORTED_LOCALES, type Locale } from "../i18n/index";
import { getErrorMessage } from "../utils/errors";
import type { OAuthConnection, OAuthProvider, MITMStatus } from "../utils/types";

export function SettingsPage() {
  const auth = useAppStore((s) => s.auth);
  const appConfig = useAppStore((s) => s.appConfig);
  const setAuth = useAppStore((s) => s.setAuth);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const { t, locale, setLocale } = useTranslation();

  const [activeTab, setActiveTab] = useState<"account" | "routing" | "rtk" | "caveman" | "mitm">("account");
  const [routingStrategy, setRoutingStrategy] = useState(appConfig?.routing_strategy || "fallback");
  const [stickyUses, setStickyUses] = useState(appConfig?.sticky_channel_use || 3);
  const [platformApiURL, setPlatformApiURL] = useState("");
  const [platformApiError, setPlatformApiError] = useState("");
  const [oauthProviders, setOAuthProviders] = useState<OAuthProvider[]>([]);
  const [oauthConnections, setOAuthConnections] = useState<OAuthConnection[]>([]);
  const [oauthDrafts, setOAuthDrafts] = useState<Record<string, { clientId: string; clientSecret: string }>>({});
  const [oauthError, setOAuthError] = useState("");
  const [mitmStatus, setMitmStatus] = useState<MITMStatus | null>(null);
  const [mitmRules, setMitmRules] = useState<string[]>([]);
  const [mitmNewRule, setMitmNewRule] = useState("");
  const [mitmError, setMitmError] = useState("");
  const [mitmToggling, setMitmToggling] = useState(false);
  const [mitmDomainTests, setMitmDomainTests] = useState<Record<string, { loading: boolean; result: Record<string, any> | null }>>({});

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

  const loadMITMState = async () => {
    try {
      const [status, rules] = await Promise.all([
        cmd.getMITMStatus(),
        cmd.getMITMRules(),
      ]);
      setMitmStatus(status);
      setMitmRules(rules);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void loadOAuthState();
    void loadMITMState();
  }, []);

  useEffect(() => {
    if (activeTab !== "mitm") return undefined;
    const timer = window.setInterval(() => {
      void loadMITMState();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

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
          <p className="page-subtitle">{t("settings.subtitle")}</p>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric-card">
            <span className="hero-metric-label">{t("settings.metricLoginStatus")}</span>
            <strong className="hero-metric-value">{auth.is_logged_in ? t("settings.loggedIn") : t("settings.notLoggedIn")}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">{t("settings.metricOauthProviders")}</span>
            <strong className="hero-metric-value">{oauthProviders.length}</strong>
          </div>
        </div>
      </div>

      <div className="tab-bar settings-tab-bar">
        <button className={activeTab === "account" ? "active" : ""} onClick={() => setActiveTab("account")}>{t("settings.account")}</button>
        <button className={activeTab === "routing" ? "active" : ""} onClick={() => setActiveTab("routing")}>{t("settings.routing")}</button>
        <button className={activeTab === "rtk" ? "active" : ""} onClick={() => setActiveTab("rtk")}>{t("settings.rtkTab")}</button>
        <button className={activeTab === "caveman" ? "active" : ""} onClick={() => setActiveTab("caveman")}>{t("settings.cavemanTab")}</button>
        <button className={activeTab === "mitm" ? "active" : ""} onClick={() => setActiveTab("mitm")}>MITM</button>
      </div>

      {activeTab === "account" && (
        <div className="settings-stack">
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.sectionBasic")}</h2>
              <p className="hint">{t("settings.sectionBasicHint")}</p>
            </div>
            <div className="form-group">
              <label>{t("settings.language")}</label>
              <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
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
                    setPlatformApiError(getErrorMessage(e, t("settings.saveFailed")));
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
              <h2>{t("settings.accountStatus")}</h2>
              <p className="hint">{t("settings.accountStatusHint")}</p>
            </div>
            {auth.is_logged_in ? (
              <div className="settings-inline-actions">
                <span className="auth-email-label" style={{ marginBottom: 0 }}>{t("settings.loggedInAs", { email: auth.email || "" })}</span>
                <button onClick={handleLogout} className="btn-secondary btn-sm">{t("settings.logout")}</button>
              </div>
            ) : (
              <p className="auth-email-label" style={{ marginBottom: 0 }}>
                {t("settings.notLoggedInDash")} <NavLink to="/auth" className="link-btn">{t("settings.goLoginRegister")}</NavLink>
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === "rtk" && (
        <div className="settings-stack">
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.rtkEnabled")}</h2>
              <p className="hint">{t("settings.rtkSectionHint")}</p>
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
                <div className="hint">{t("settings.rtkHint")}</div>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="badge badge-blue">{t("settings.rtkBadgeCompression")}</span>
                  <span className="badge badge-green">{t("settings.rtkBadgeRuntime")}</span>
                </div>
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
                <label htmlFor="rtkEnabled" onClick={(event) => event.stopPropagation()}>{t("settings.enable")}</label>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "caveman" && (
        <div className="settings-stack">
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.cavemanEnabled")}</h2>
              <p className="hint">{t("settings.cavemanSectionHint")}</p>
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
                <div className="hint">{t("settings.cavemanHint")}</div>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="badge badge-blue">{t("settings.cavemanBadgeOutput")}</span>
                  <span className="badge badge-yellow">{t("settings.cavemanBadgeStyle")}</span>
                </div>
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
                  <label htmlFor="cavemanEnabled" onClick={(event) => event.stopPropagation()}>{t("settings.enable")}</label>
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
                      <option value="concise">{t("settings.cavemanStyleConcise")}</option>
                      <option value="brief">{t("settings.cavemanStyleBrief")}</option>
                      <option value="minimal">{t("settings.cavemanStyleMinimal")}</option>
                      <option value="terse">{t("settings.cavemanStyleTerse")}</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "routing" && (
        <div className="settings-stack">
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.routingStrategy")}</h2>
              <p className="hint">{t("settings.routingHint")}</p>
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
              <h2>{t("settings.byokTitle")}</h2>
              <p className="hint">{t("settings.byokHint")}</p>
            </div>
            <div className="byok-status-card">
              <div className="byok-title">{t("settings.byokInfoTitle")}</div>
              <div className="byok-desc">
                <p><strong>{t("settings.byokScenarioLabel")}</strong>{t("settings.byokScenarioText")}</p>
                <p><strong>{t("settings.byokCostLabel")}</strong>{t("settings.byokCostText")}</p>
                <p><strong>{t("settings.byokProtectionLabel")}</strong>{t("settings.byokProtectionText")}</p>
                <p><strong>{t("settings.byokUsageLabel")}</strong>{t("settings.byokUsageText")}</p>
              </div>
            </div>
            <label className="toggle-row settings-toggle-block">
              <span>{t("settings.byokToggle")}</span>
              <input type="checkbox" checked={true} onChange={() => {}} />
            </label>
          </div>

          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>{t("settings.autoLaunch")}</h2>
              <p className="hint">{t("settings.autoLaunchHint")}</p>
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

      {activeTab === "mitm" && (
        <div className="settings-stack">
          {/* 一键开关 */}
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>MITM Proxy</h2>
              <p className="hint">一键接管 LLM API 流量，自动路由到本地网关。</p>
            </div>
            {mitmError && <div className="error-msg" style={{ marginTop: 12 }}>{mitmError}</div>}
            <div
              className={`settings-toggle-card settings-toggle-card-selectable${mitmStatus?.state === "running" ? " is-active" : ""}`}
              role="switch"
              aria-checked={mitmStatus?.state === "running"}
              tabIndex={0}
              onClick={async () => {
                if (mitmToggling) return;
                const isRunning = mitmStatus?.state === "running";
                setMitmToggling(true);
                try {
                  setMitmError("");
                  if (isRunning) {
                    await cmd.stopMITM();
                  } else {
                    await cmd.startMITM();
                  }
                  await loadMITMState();
                } catch (e) {
                  setMitmError(getErrorMessage(e, isRunning ? "停止失败" : "启动失败"));
                } finally {
                  setMitmToggling(false);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                (event.currentTarget as HTMLElement).click();
              }}
            >
              <div>
                <div className="settings-toggle-title">
                  {mitmToggling ? "切换中..." : mitmStatus?.state === "running" ? "已启用" : "未启用"}
                </div>
                <div className="hint">
                  {mitmStatus?.state === "running"
                    ? `代理端口 ${mitmStatus.proxy_port} · CA ${mitmStatus.ca_installed ? "已安装" : "未安装"} · 系统代理 ${mitmStatus.system_proxy ? "已设置" : "未设置"}`
                    : "点击开启一键接管 AI API 流量"}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className={`badge ${mitmStatus?.system_proxy_active ? "badge-green" : "badge-red"}`}>
                    {mitmStatus?.system_proxy_active ? t("settings.mitmProxyActive") : t("settings.mitmProxyInactive")}
                  </span>
                  {mitmStatus?.residual_system_proxy && (
                    <span className="badge badge-yellow">{t("settings.mitmResidualProxy")}</span>
                  )}
                </div>
                {mitmStatus?.last_error && (
                  <div className="error-msg" style={{ marginTop: 8 }}>{mitmStatus.last_error}</div>
                )}
              </div>
              <div className="form-checkbox" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={mitmStatus?.state === "running"}
                  readOnly
                  style={{ width: 20, height: 20 }}
                />
              </div>
            </div>
          </div>

          {/* 域名配置 + 连通性检查 */}
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>接管域名</h2>
              <p className="hint">被接管的域名流量将通过 MITM 代理转发到本地网关，点击「测试」检查连通性。</p>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <input
                  value={mitmNewRule}
                  onChange={(e) => setMitmNewRule(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mitmNewRule.trim()) {
                      (e.currentTarget as HTMLElement).blur();
                    }
                  }}
                  placeholder="api.example.com"
                />
              </div>
              <button
                onClick={async () => {
                  if (!mitmNewRule.trim()) return;
                  try {
                    setMitmError("");
                    await cmd.addMITMRule(mitmNewRule.trim());
                    setMitmNewRule("");
                    await loadMITMState();
                  } catch (e) {
                    setMitmError(getErrorMessage(e, "添加域名失败"));
                  }
                }}
                className="btn-primary btn-sm"
                style={{ height: 40, alignSelf: "flex-end" }}
              >
                添加
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              {mitmRules.length === 0 && (
                <p className="hint">暂无接管域名，请添加需要拦截的 API 域名。</p>
              )}
              {mitmRules.map((domain) => {
                const testState = mitmDomainTests[domain];
                const testResult = testState?.result;
                return (
                  <div key={domain} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span className="hint" style={{ marginBottom: 0, minWidth: 180, fontFamily: "monospace" }}>{domain}</span>
                    {testState?.loading && <span className="badge badge-yellow">测试中...</span>}
                    {testResult && !testState?.loading && (
                      <>
                        <span className={`badge ${testResult.reachable ? "badge-green" : "badge-red"}`}>
                          {testResult.reachable ? `可达 ${testResult.status_code}` : "不可达"}
                        </span>
                        {testResult.intercepted && <span className="badge badge-blue">已接管</span>}
                        {testResult.latency_ms > 0 && <span className="hint" style={{ marginBottom: 0 }}>{testResult.latency_ms}ms</span>}
                        {testResult.error && <span className="hint" style={{ marginBottom: 0, color: "var(--error, #e53e3e)" }}>{String(testResult.error).slice(0, 60)}</span>}
                      </>
                    )}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                      <button
                        onClick={async () => {
                          setMitmDomainTests((prev) => ({ ...prev, [domain]: { loading: true, result: null } }));
                          try {
                            const result = await cmd.testMITMDomain(domain);
                            setMitmDomainTests((prev) => ({ ...prev, [domain]: { loading: false, result } }));
                          } catch (e) {
                            setMitmDomainTests((prev) => ({ ...prev, [domain]: { loading: false, result: { reachable: false, error: String(e) } } }));
                          }
                        }}
                        className="btn-secondary btn-sm"
                        disabled={mitmStatus?.state !== "running" || testState?.loading}
                      >
                        测试
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            setMitmError("");
                            await cmd.removeMITMRule(domain);
                            setMitmDomainTests((prev) => {
                              const next = { ...prev };
                              delete next[domain];
                              return next;
                            });
                            await loadMITMState();
                          } catch (e) {
                            setMitmError(getErrorMessage(e, "移除域名失败"));
                          }
                        }}
                        className="btn-danger btn-sm"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 拦截日志 */}
          {mitmStatus?.state === "running" && (
            <MITMInterceptLog />
          )}

          {/* CLI 兼容提示 */}
          <div className="tab-content section-card">
            <div className="section-heading">
              <h2>CLI 兼容</h2>
              <p className="hint">终端/CLI 工具如不读取系统代理，可手动设置环境变量。</p>
            </div>
            <MITMEnvHint running={mitmStatus?.state === "running"} />
          </div>
        </div>
      )}
    </div>
  );
}

function MITMInterceptLog() {
  const [intercepts, setIntercepts] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const data = await cmd.getMITMRecentIntercepts(20);
        setIntercepts(data || []);
      } catch {
        // ignore
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  if (intercepts.length === 0) {
    return null;
  }

  return (
    <div className="tab-content section-card">
      <div className="section-heading">
        <h2>拦截日志</h2>
        <p className="hint">最近 20 条被接管的请求（每 3 秒刷新）</p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, #333)" }}>
              <th style={{ padding: "4px 8px" }}>时间</th>
              <th style={{ padding: "4px 8px" }}>方法</th>
              <th style={{ padding: "4px 8px" }}>域名</th>
              <th style={{ padding: "4px 8px" }}>路径</th>
              <th style={{ padding: "4px 8px" }}>状态</th>
              <th style={{ padding: "4px 8px" }}>延迟</th>
            </tr>
          </thead>
          <tbody>
            {intercepts.slice().reverse().map((entry, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-light, #222)" }}>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary, #888)" }}>
                  {entry.time ? new Date(entry.time).toLocaleTimeString() : "-"}
                </td>
                <td style={{ padding: "4px 8px" }}>{entry.method || "-"}</td>
                <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{entry.host || "-"}</td>
                <td style={{ padding: "4px 8px", fontFamily: "monospace", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{entry.path || "-"}</td>
                <td style={{ padding: "4px 8px" }}>
                  <span className={`badge ${entry.status >= 200 && entry.status < 400 ? "badge-green" : "badge-red"}`}>
                    {entry.status || "-"}
                  </span>
                </td>
                <td style={{ padding: "4px 8px" }}>{entry.duration_ms ? `${entry.duration_ms.toFixed(1)}ms` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MITMEnvHint({ running }: { running: boolean }) {
  const [hint, setHint] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!running) return;
    void (async () => {
      try {
        const result = await cmd.getMITMEnvHint();
        setHint(result);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [running]);

  if (!running || !hint) {
    return <p className="hint">启动 MITM 代理后显示 CLI 环境变量设置命令。</p>;
  }

  return (
    <div>
      <p className="hint">Shell: <strong>{hint.shell}</strong></p>
      <div className="form-row" style={{ marginTop: 8 }}>
        <code style={{ flex: 1, padding: 8, background: "var(--bg-code, #1e1e1e)", borderRadius: 4, fontSize: 13, overflowX: "auto", whiteSpace: "nowrap" }}>
          {hint.export_cmds}
        </code>
        <button
          onClick={() => navigator.clipboard?.writeText(hint.export_cmds)}
          className="btn-secondary btn-sm"
          style={{ height: 40 }}
        >
          复制
        </button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>停止后取消设置：</p>
      <div className="form-row" style={{ marginTop: 4 }}>
        <code style={{ flex: 1, padding: 8, background: "var(--bg-code, #1e1e1e)", borderRadius: 4, fontSize: 13, overflowX: "auto", whiteSpace: "nowrap" }}>
          {hint.unset_cmds}
        </code>
        <button
          onClick={() => navigator.clipboard?.writeText(hint.unset_cmds)}
          className="btn-secondary btn-sm"
          style={{ height: 40 }}
        >
          复制
        </button>
      </div>
    </div>
  );
}
