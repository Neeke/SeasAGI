import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";
import { getCloudBilling, getRuntimeStatus } from "../utils/commands";
import { formatPlanTier, normalizePlanTier } from "../utils/plan";
import { useConfigSync } from "../hooks/useConfigSync";
import { ConfigSyncIndicator } from "./ConfigSyncIndicator";
import seasagiIcon from "../assets/seasagi-icon.png";

type AppIconName =
  | "home"
  | "channels"
  | "combo"
  | "optimization"
  | "playground"
  | "usage"
  | "key"
  | "subscription"
  | "logs"
  | "settings"
  | "sun"
  | "lock"
  | "layers";

const navItems: Array<{ to: string; label: string; icon: AppIconName; cloudOnly?: boolean }> = [
  { to: "/", label: "nav.home", icon: "home" as AppIconName },
  { to: "/access-token", label: "nav.accessToken", icon: "key" as AppIconName },
  { to: "/channels", label: "nav.channels", icon: "channels" as AppIconName },
  { to: "/combo-workbench", label: "nav.comboWorkbench", icon: "layers" as AppIconName },
  { to: "/playground", label: "nav.playground", icon: "playground" as AppIconName },
  { to: "/subscription", label: "nav.subscription", icon: "subscription" as AppIconName },
  { to: "/usage", label: "nav.usage", icon: "usage" as AppIconName },
  { to: "/logs", label: "nav.logs", icon: "logs" as AppIconName },
  { to: "/settings", label: "nav.settings", icon: "settings" as AppIconName },
];

const teamNavItem = { to: "/team", label: "nav.team", icon: "combo" as AppIconName };

type ThemeMode = "light" | "dark";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const saved = window.localStorage.getItem("seasagi-theme");
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return <svg {...props}><path d="M3 10.5L12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.5 20v-5.5h5V20" /></svg>;
    case "channels":
      return <svg {...props}><path d="M8.5 7.5h8a3 3 0 010 6h-8a3 3 0 010-6z" /><path d="M7.5 10.5h-2" /><path d="M18.5 10.5h2" /><path d="M8.5 13.5h8a3 3 0 010 6h-8a3 3 0 010-6z" /><path d="M7.5 16.5h-2" /><path d="M18.5 16.5h2" /></svg>;
    case "combo":
      return <svg {...props}><rect x="4" y="5" width="6" height="6" rx="2" /><rect x="14" y="5" width="6" height="6" rx="2" /><rect x="9" y="13" width="6" height="6" rx="2" /><path d="M10 8h4" /><path d="M12 11v2" /></svg>;
    case "optimization":
      return <svg {...props}><path d="M13 2L6 13h5l-1 9 8-12h-5l0-8z" /></svg>;
    case "playground":
      return <svg {...props}><path d="M7 6.5h10" /><path d="M7 12h10" /><path d="M7 17.5h6" /><rect x="3.5" y="3.5" width="17" height="17" rx="4" /></svg>;
    case "usage":
      return <svg {...props}><path d="M5 19V10" /><path d="M12 19V5" /><path d="M19 19v-7" /></svg>;
    case "key":
      return <svg {...props}><circle cx="8" cy="12" r="3" /><path d="M11 12h9" /><path d="M17 12v3" /><path d="M20 12v2" /></svg>;
    case "subscription":
      return <svg {...props}><rect x="3.5" y="6" width="17" height="12" rx="3" /><path d="M3.5 10h17" /><path d="M7 15h4" /></svg>;
    case "logs":
      return <svg {...props}><path d="M8 7.5h8" /><path d="M8 12h8" /><path d="M8 16.5h5" /><rect x="4" y="4" width="16" height="16" rx="3" /></svg>;
    case "settings":
      return <svg {...props}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1 1 0 00.2 1.1l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1 1 0 00-1.1-.2 1 1 0 00-.6.9V20a2 2 0 01-4 0v-.2a1 1 0 00-.7-.9 1 1 0 00-1.1.2l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1 1 0 00.2-1.1 1 1 0 00-.9-.6H4a2 2 0 010-4h.2a1 1 0 00.9-.7 1 1 0 00-.2-1.1l-.1-.1a2 2 0 012.8-2.8l.1.1a1 1 0 001.1.2 1 1 0 00.6-.9V4a2 2 0 014 0v.2a1 1 0 00.7.9 1 1 0 001.1-.2l.1-.1a2 2 0 012.8 2.8l-.1.1a1 1 0 00-.2 1.1 1 1 0 00.9.6H20a2 2 0 010 4h-.2a1 1 0 00-.9.7z" /></svg>;
    case "sun":
      return <svg {...props}><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2.2" /><path d="M12 19.3v2.2" /><path d="M4.7 4.7l1.6 1.6" /><path d="M17.7 17.7l1.6 1.6" /><path d="M2.5 12h2.2" /><path d="M19.3 12h2.2" /><path d="M4.7 19.3l1.6-1.6" /><path d="M17.7 6.3l1.6-1.6" /></svg>;
    case "lock":
      return <svg {...props}><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V8a4 4 0 018 0v2" /></svg>;
    case "layers":
      return <svg {...props}><polygon points="12 2 22 7 12 12 2 7 12 2" /><polyline points="2 12 12 17 22 12" /><polyline points="2 17 12 22 22 17" /></svg>;
    default:
      return null;
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const auth = useAppStore((s) => s.auth);
  const cloudBilling = useAppStore((s) => s.cloudBilling);
  const setRuntime = useAppStore((s) => s.setRuntime);
  const setCloudBilling = useAppStore((s) => s.setCloudBilling);
  const location = useLocation();
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  const isAuthPage = location.pathname === "/auth";
  useEffect(() => {
    (async () => {
      try {
        const status = await getRuntimeStatus();
        setRuntime(status);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!auth.is_logged_in) {
      setCloudBilling(null);
      return;
    }
    (async () => {
      try {
        const billing = await getCloudBilling();
        setCloudBilling(billing);
      } catch {
        setCloudBilling(null);
      }
    })();
  }, [auth.is_logged_in, setCloudBilling]);

  useConfigSync();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    window.localStorage.setItem("seasagi-theme", theme);
  }, [theme]);

  const planTier = normalizePlanTier(cloudBilling);
  const planLabel = formatPlanTier(cloudBilling);

  return (
    <div className="app-frame">
      <div className="app-chrome">
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
          aria-label={theme === "dark" ? "切换到浅色风格" : "切换到深色风格"}
          title={theme === "dark" ? "切换到浅色风格" : "切换到深色风格"}
        >
          <AppIcon name="sun" />
        </button>
      </div>
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <NavLink to="/" className="sidebar-logo">
              <img src={seasagiIcon} alt="SeasAGI" className="logo-icon-image" />
              <span className="logo-text">SeasAGI</span>
              <span className="logo-version">v{import.meta.env.VITE_APP_VERSION || "0.1.0"}</span>
            </NavLink>
          </div>
          <nav className="sidebar-nav">
            {navItems.map((item) => {
              const disabled = !!item.cloudOnly && !auth.is_logged_in;
              if (disabled) {
                return (
                  <div key={item.to} className="nav-item nav-item-disabled" aria-disabled="true" title={t("home.localModeLoginLink")}>
                    <span className="nav-icon"><AppIcon name={item.icon} /></span>
                    <span className="nav-label">{t(item.label)}</span>
                  </div>
                );
              }
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  <span className="nav-icon"><AppIcon name={item.icon} /></span>
                  <span className="nav-label">{t(item.label)}</span>
                </NavLink>
              );
            })}
            {auth.is_logged_in && (cloudBilling?.plan_id === "teams" || cloudBilling?.plan_id === "enterprise") && (
              <NavLink
                to="/team"
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                <span className="nav-icon"><AppIcon name={teamNavItem.icon} /></span>
                <span className="nav-label">{t("nav.team")}</span>
              </NavLink>
            )}
            {auth.is_logged_in && cloudBilling?.plan_id === "enterprise" && (
              <NavLink
                to="/enterprise"
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                <span className="nav-icon"><AppIcon name="combo" /></span>
                <span className="nav-label">{t("nav.enterprise")}</span>
              </NavLink>
            )}
          </nav>
          <div className="sidebar-footer">
            <ConfigSyncIndicator />
            {auth.is_logged_in ? (
              <div className="user-info">
                <div className="user-avatar">{auth.email?.[0]?.toUpperCase() || "U"}</div>
                <div className="user-details">
                  <div className="user-name">{auth.email || "已登录"}</div>
                  {planTier && <div className={`plan-badge plan-badge-${planTier}`}>{planLabel}</div>}
                </div>
                <span className="user-chevron">›</span>
              </div>
            ) : (
              <NavLink to={isAuthPage ? "/" : "/auth"} className="login-prompt">
                <span className="login-icon"><AppIcon name="key" /></span>
                <span>{t("nav.localMode")}</span>
                <span className="user-chevron">›</span>
              </NavLink>
            )}
          </div>
        </aside>
        <div className="main-shell">
          {!auth.is_logged_in && !isAuthPage && (
            <div className="readonly-banner">
              <span className="readonly-banner-copy">
                <span className="readonly-banner-icon"><AppIcon name="lock" /></span>
                <span>{t("home.localModeBanner")}</span>
              </span>
              <NavLink to="/auth" className="readonly-login-link">{t("home.localModeLoginLink")}</NavLink>
            </div>
          )}
          <main className="main-content">
            <div>
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
