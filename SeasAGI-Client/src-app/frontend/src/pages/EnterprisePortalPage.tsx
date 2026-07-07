import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import { getPlatformAPIBaseURL, getPlatformToken, openInBrowser } from "../utils/commands";

interface AuditLogEntry {
  id: number;
  actor_type: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  result: string;
  ip: string;
  trace_id: string;
  metadata: string;
  created_at: string;
}

interface SSOConfig {
  config_id: string;
  protocol: string;
  idp_metadata_url: string;
  idp_entity_id: string;
  sp_entity_id: string;
  acs_url: string;
  force_sso: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface SCIMConfig {
  config_id: string;
  scim_token: string;
  scim_endpoint: string;
  last_sync_at: string | null;
  sync_status: string;
  enabled: boolean;
}

interface RoleItem {
  role_id: string;
  name: string;
  description: string;
  permissions: string;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

interface ModelPolicy {
  policy_id: string;
  allowed_models: string;
  denied_models: string;
  default_action: string;
  updated_at: string;
}

interface IPEntry {
  id: number;
  cidr: string;
  description: string;
  created_at: string;
}

interface ComplianceReport {
  report_id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  status: string;
  file_path: string;
  file_format: string;
  created_at: string;
}

interface ComplianceSchedule {
  frequency: string;
  target_email: string;
  format: string;
  enabled: boolean;
}

interface SLAStatus {
  tenant_id: string;
  tier: string;
  uptime_pct: number;
  p95_latency_ms: number;
  error_rate_pct: number;
  last_check: string;
  status: string;
}

interface SLAEvent {
  id: number;
  event_type: string;
  description: string;
  start_at: string;
  resolved_at: string;
  severity: string;
  created_at: string;
}

interface SLATrendPoint {
  date: string;
  uptime_pct: number;
  p95_latency_ms: number;
  error_rate_pct: number;
}

interface AlertRule {
  rule_id: string;
  name: string;
  condition_expr: string;
  threshold: number;
  severity: string;
  enabled: boolean;
  created_at: string;
}

interface AlertEvent {
  event_id: string;
  rule_id: string;
  severity: string;
  message: string;
  resolved: boolean;
  created_at: string;
}

interface AuditRetention {
  retention_days: number;
  auto_archive: boolean;
}

type TabId = "overview" | "audit" | "identity" | "policies" | "compliance" | "sla" | "alerts" | "support" | "deployment";

export function EnterprisePortalPage() {
  const navigate = useNavigate();
  const auth = useAppStore((s) => s.auth);
  const cloudBilling = useAppStore((s) => s.cloudBilling);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditSearchQuery, setAuditSearchQuery] = useState("");
  const [auditRetention, setAuditRetention] = useState<AuditRetention>({ retention_days: 365, auto_archive: true });

  const [ssoConfig, setSSOConfig] = useState<SSOConfig | null>(null);
  const [scimConfig, setSCIMConfig] = useState<SCIMConfig | null>(null);
  const [roles, setRoles] = useState<RoleItem[]>([]);

  const [modelPolicy, setModelPolicy] = useState<ModelPolicy | null>(null);
  const [ipWhitelist, setIpWhitelist] = useState<IPEntry[]>([]);

  const [complianceReports, setComplianceReports] = useState<ComplianceReport[]>([]);
  const [complianceSchedule, setComplianceSchedule] = useState<ComplianceSchedule>({ frequency: "monthly", target_email: "", format: "pdf", enabled: false });

  const [slaStatus, setSLAStatus] = useState<SLAStatus | null>(null);
  const [slaEvents, setSLAEvents] = useState<SLAEvent[]>([]);
  const [slaTrend, setSLATrend] = useState<SLATrendPoint[]>([]);
  const [slaTrendDays, setSLATrendDays] = useState(7);

  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);

  const [editingSSO, setEditingSSO] = useState(false);
  const [ssoProtocol, setSSOProtocol] = useState("saml");
  const [ssoIdpMetaUrl, setSSOIdpMetaUrl] = useState("");
  const [ssoIdpEntityId, setSSOIdpEntityId] = useState("");
  const [ssoIdpCert, setSSOIdpCert] = useState("");
  const [ssoForceSSO, setSSOForceSSO] = useState(false);
  const [ssoEnabled, setSSOEnabled] = useState(false);

  const [editingSCIM, setEditingSCIM] = useState(false);
  const [scimEndpoint, setSCIMEndpoint] = useState("");
  const [scimEnabled, setSCIMEnabled] = useState(false);

  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [rolePerms, setRolePerms] = useState("{}");

  const [editingModelAllowed, setEditingModelAllowed] = useState("[]");
  const [editingModelDenied, setEditingModelDenied] = useState("[]");
  const [editingModelDefault, setEditingModelDefault] = useState("allow");
  const [editingModelPolicy, setEditingModelPolicy] = useState(false);

  const [newIP, setNewIP] = useState({ cidr: "", description: "" });

  const [editingAlertRule, setEditingAlertRule] = useState<AlertRule | null>(null);
  const [alertRuleName, setAlertRuleName] = useState("");
  const [alertRuleCondition, setAlertRuleCondition] = useState("rate_limit_exceeded");
  const [alertRuleThreshold, setAlertRuleThreshold] = useState(0);
  const [alertRuleSeverity, setAlertRuleSeverity] = useState("warning");

  const [slaEventDialog, setSLAEventDialog] = useState(false);
  const [slaEventType, setSLAEventType] = useState("");
  const [slaEventDesc, setSLAEventDesc] = useState("");
  const [slaEventSeverity, setSLAEventSeverity] = useState("info");

  const [contractInfo, setContractInfo] = useState<any>(null);
  const [trialStatus, setTrialStatus] = useState<any>(null);

  const [dataRegions, setDataRegions] = useState<any[]>([]);
  const [deploymentType, setDeploymentType] = useState("cloud");
  const [licenseInfo, setLicenseInfo] = useState<any>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<any>(null);
  const [editingRegion, setEditingRegion] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState("us-east");
  const [editingLicense, setEditingLicense] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [controlPlaneURL, setControlPlaneURL] = useState("");
  const [editingDeploymentType, setEditingDeploymentType] = useState(false);
  const [newDeploymentType, setNewDeploymentType] = useState("cloud");

  const isEnterprise = cloudBilling?.plan_id === "enterprise";

  const api = useCallback(async () => {
    const [baseURL, token] = await Promise.all([getPlatformAPIBaseURL(), getPlatformToken()]);
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
    return { baseURL, token, headers };
  }, []);

  const getJSON = async (path: string) => {
    const { baseURL, headers } = await api();
    const r = await fetch(baseURL + path, { headers });
    return r.ok ? r.json() : null;
  };

  const doPost = async (path: string, body: any) => {
    const { baseURL, headers } = await api();
    return fetch(baseURL + path, { method: "POST", headers, body: JSON.stringify(body) });
  };

  const doPut = async (path: string, body: any) => {
    const { baseURL, headers } = await api();
    return fetch(baseURL + path, { method: "PUT", headers, body: JSON.stringify(body) });
  };

  const doDelete = async (path: string) => {
    const { baseURL, headers } = await api();
    return fetch(baseURL + path, { method: "DELETE", headers });
  };

  const loadAll = useCallback(async () => {
    if (!auth.is_logged_in || !isEnterprise) { setLoading(false); return; }
    try {
      const [ssoData, scimData, rolesData, slaSt, slaEv, rulesData, evtsData, auditData, modelData, ipData, reportsData, schedData, retentionData] = await Promise.all([
        getJSON("/enterprise/sso/config"),
        getJSON("/enterprise/scim/config"),
        getJSON("/enterprise/roles"),
        getJSON("/enterprise/sla/trend?days=1").catch(() => getJSON("/usage/sla/status")),
        getJSON("/usage/sla/events"),
        getJSON("/enterprise/alert-rules"),
        getJSON("/enterprise/alert-events"),
        getJSON("/enterprise/audit/logs"),
        getJSON("/enterprise/policies/models"),
        getJSON("/enterprise/policies/ip-whitelist"),
        getJSON("/enterprise/compliance/reports"),
        getJSON("/enterprise/compliance/schedule"),
        getJSON("/enterprise/audit/retention"),
      ]);
      if (ssoData?.config_id) setSSOConfig(ssoData);
      if (scimData?.config_id) setSCIMConfig(scimData);
      if (rolesData?.data) setRoles(rolesData.data);
      if (slaSt?.uptime_pct !== undefined) setSLAStatus(slaSt); else if (slaSt?.data?.length) setSLAStatus(slaSt.data[0]);
      if (slaEv?.data) setSLAEvents(slaEv.data);
      if (rulesData?.data) setAlertRules(rulesData.data);
      if (evtsData?.data) setAlertEvents(evtsData.data);
      if (auditData?.data) setAuditLogs(auditData.data);
      if (modelData?.allowed_models !== undefined) setModelPolicy(modelData);
      if (ipData?.data) setIpWhitelist(ipData.data);
      if (reportsData?.data) setComplianceReports(reportsData.data);
      if (schedData?.frequency) setComplianceSchedule(schedData);
      if (retentionData?.retention_days) setAuditRetention(retentionData);
      const contract = await getJSON("/enterprise/contract");
      if (contract?.contract_id) setContractInfo(contract);
      const trial = await getJSON("/enterprise/trial/status");
      if (trial) setTrialStatus(trial);

      const regions = await getJSON("/enterprise/data-regions");
      if (regions?.data) setDataRegions(regions.data);
      const active = await getJSON("/enterprise/data-regions/active");
      if (active?.region) { setDeploymentType(active.deployment_type); }
      const lic = await getJSON("/enterprise/license");
      if (lic) setLicenseInfo(lic);
      const depStatus = await getJSON("/enterprise/deployment/status");
      if (depStatus) setDeploymentStatus(depStatus);
    } catch {} finally { setLoading(false); }
  }, [auth.is_logged_in, isEnterprise]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadAuditLogs = async (actionFilter?: string, searchQuery?: string) => {
    const af = actionFilter !== undefined ? actionFilter : auditActionFilter;
    const sq = searchQuery !== undefined ? searchQuery : auditSearchQuery;
    let path = "/enterprise/audit/logs";
    const params: string[] = [];
    if (af) params.push("action=" + encodeURIComponent(af));
    if (sq) params.push("q=" + encodeURIComponent(sq));
    if (params.length) path += "?" + params.join("&");
    const d = await getJSON(path);
    if (d?.data) setAuditLogs(d.data);
  };

  const loadSLATrend = async (days: number) => {
    const d = await getJSON("/enterprise/sla/trend?days=" + days);
    if (d?.data) setSLATrend(d.data);
  };

  if (!auth.is_logged_in) {
    return (
      <div className="page enterprise-page">
        <div className="empty-state">
          <h2>请先登录</h2>
          <p>登录后可查看企业门户</p>
          <button className="btn-primary" onClick={() => navigate("/auth")}>去登录</button>
        </div>
      </div>
    );
  }

  if (!isEnterprise) {
    return (
      <div className="page enterprise-page">
        <div className="page-header">
          <h1>企业门户</h1>
          <p className="page-subtitle">治理 - 审计 - 合规 - SLA</p>
        </div>
        <div className="empty-state">
          <div className="empty-icon">🏢</div>
          <h2>当前套餐不含企业治理能力</h2>
          <p>Enterprise 套餐提供审计日志、自定义策略、SSO/SCIM/RBAC、SLA 保障与专属客户经理</p>
          <button className="btn-primary" onClick={() => navigate("/subscription")}>联系销售</button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><div className="loading">加载中...</div></div>;

  const tabList: { id: TabId; label: string; icon: string }[] = [
    { id: "overview", label: "概览", icon: "📊" },
    { id: "audit", label: "审计", icon: "🔍" },
    { id: "identity", label: "身份", icon: "🔐" },
    { id: "policies", label: "策略", icon: "🛡️" },
    { id: "compliance", label: "合规", icon: "📋" },
    { id: "sla", label: "SLA", icon: "📈" },
    { id: "alerts", label: "告警", icon: "🔔" },
    { id: "support", label: "支持", icon: "💬" },
    { id: "deployment", label: "部署", icon: "☁️" },
  ];

  const renderOverview = () => (
    <>
      <div className="section section-card">
        <div className="section-heading"><h2>治理概览</h2></div>
        <div className="ent-governance-grid">
          <div className="governance-card">
            <div className="gov-icon">🔍</div>
            <div className="gov-title">审计日志</div>
            <div className="gov-desc">{auditLogs.length} 条事件记录 · {auditRetention.retention_days}天保留</div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("audit")}>查看</button>
          </div>
          <div className="governance-card">
            <div className="gov-icon">🔐</div>
            <div className="gov-title">SSO {ssoConfig?.enabled ? "已启用" : "未配置"}</div>
            <div className="gov-desc">{ssoConfig?.protocol?.toUpperCase() || "未配置"} · {ssoConfig?.force_sso ? "强制SSO" : "可选"}</div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("identity")}>配置</button>
          </div>
          <div className="governance-card">
            <div className="gov-icon">👤</div>
            <div className="gov-title">SCIM {scimConfig?.enabled ? "已启用" : "未配置"}</div>
            <div className="gov-desc">{scimConfig?.sync_status === "idle" ? "就绪" : scimConfig?.sync_status}</div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("identity")}>配置</button>
          </div>
          <div className="governance-card">
            <div className="gov-icon">🛡️</div>
            <div className="gov-title">策略管控</div>
            <div className="gov-desc">模型策略 · {ipWhitelist.length} 个 IP 白名单</div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("policies")}>管理</button>
          </div>
          <div className="governance-card">
            <div className="gov-icon">📋</div>
            <div className="gov-title">合规报告</div>
            <div className="gov-desc">{complianceReports.length} 份报告 · {complianceSchedule.enabled ? "定期推送" : "未设置推送"}</div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("compliance")}>查看</button>
          </div>
          <div className="governance-card">
            <div className="gov-icon">📈</div>
            <div className="gov-title">SLA {slaStatus?.status === "healthy" ? "正常" : "异常"}</div>
            <div className="gov-desc">可用率 {slaStatus?.uptime_pct || 99.9}% · P95 {slaStatus?.p95_latency_ms || 0}ms</div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("sla")}>查看</button>
          </div>
        </div>
      </div>

      <div className="section section-card">
        <div className="section-heading"><h2>SLA 实时指标</h2></div>
        <div className="sla-grid">
          <div className="sla-item">
            <div className="sla-metric" style={{ color: slaStatus?.uptime_pct !== undefined && slaStatus.uptime_pct < 99.0 ? "var(--red)" : "var(--accent)" }}>
              {(slaStatus?.uptime_pct || 99.9).toFixed(1)}%
            </div>
            <div className="sla-label">可用率 SLA</div>
          </div>
          <div className="sla-item">
            <div className="sla-metric" style={{ color: slaStatus?.p95_latency_ms !== undefined && slaStatus.p95_latency_ms > 300 ? "var(--red)" : "var(--accent)" }}>
              {(slaStatus?.p95_latency_ms || 0)}ms
            </div>
            <div className="sla-label">P95 延迟</div>
          </div>
          <div className="sla-item">
            <div className="sla-metric">{(slaStatus?.status || "healthy") === "healthy" ? "正常" : "异常"}</div>
            <div className="sla-label">状态</div>
          </div>
          <div className="sla-item">
            <div className="sla-metric">{slaEvents.length}</div>
            <div className="sla-label">SLA 事件</div>
          </div>
        </div>
      </div>

      {contractInfo && (
        <div className="section section-card">
          <div className="section-heading"><h2>合同信息</h2></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
            <div><span style={{ color: "var(--text-muted)" }}>合同编号:</span> {contractInfo.contract_number || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>PO 编号:</span> {contractInfo.po_number || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>总金额:</span> ${(contractInfo.total_amount || 0).toFixed(2)} {contractInfo.currency || "USD"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>计费周期:</span> {contractInfo.billing_cycle || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>席位数:</span> {contractInfo.seats || 0}</div>
            <div><span style={{ color: "var(--text-muted)" }}>席位单价:</span> ${(contractInfo.seat_price || 0).toFixed(2)}</div>
            <div><span style={{ color: "var(--text-muted)" }}>开始日期:</span> {contractInfo.start_date?.substring(0, 10) || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>到期日期:</span> {contractInfo.end_date?.substring(0, 10) || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>状态:</span> {contractInfo.status || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>销售联系人:</span> {contractInfo.sales_contact || "-"}</div>
          </div>
        </div>
      )}

      {trialStatus && (
        <div className="section section-card">
          <div className="section-heading"><h2>试用状态</h2></div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: trialStatus.is_expired ? "var(--red)" : "var(--green)" }}>
                {trialStatus.remaining_days > 0 ? `${trialStatus.remaining_days} 天剩余` : "已过期"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>试用期 {trialStatus.trial_days} 天 · 已用 {trialStatus.used_days} 天</div>
            </div>
            {trialStatus.is_expired && (
              <button className="btn-primary" onClick={async () => {
                await doPost("/enterprise/trial/convert", { plan_id: "teams" });
                loadAll();
              }}>转为付费</button>
            )}
          </div>
        </div>
      )}

      <div className="section section-card">
        <div className="section-heading"><h2>快捷操作</h2></div>
        <div className="shared-section" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="shared-item">
            <div className="shared-icon">🔐</div>
            <div className="shared-content">
              <div className="shared-title">配置 SSO</div>
              <div className="shared-desc">SAML 2.0 / OIDC 单点登录</div>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("identity")}>配置</button>
          </div>
          <div className="shared-item">
            <div className="shared-icon">🔍</div>
            <div className="shared-content">
              <div className="shared-title">查看审计日志</div>
              <div className="shared-desc">筛选、搜索和导出</div>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("audit")}>查看</button>
          </div>
          <div className="shared-item">
            <div className="shared-icon">📋</div>
            <div className="shared-content">
              <div className="shared-title">导出合规报告</div>
              <div className="shared-desc">自动生成月度合规报告</div>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("compliance")}>管理</button>
          </div>
          <div className="shared-item">
            <div className="shared-icon">💬</div>
            <div className="shared-content">
              <div className="shared-title">联系支持</div>
              <div className="shared-desc">专属客户经理 + SLA 事件报告</div>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => setActiveTab("support")}>联系</button>
          </div>
        </div>
      </div>
    </>
  );

  const renderAudit = () => (
    <div className="section section-card">
      <div className="section-heading">
        <h2>审计日志</h2>
        <button className="btn-secondary btn-sm" onClick={async () => {
          const {baseURL} = await api();
          openInBrowser(baseURL + "/enterprise/audit/export?format=csv");
        }}>导出 CSV</button>
      </div>
      <div className="enterprise-toolbar">
        <input type="text" className="form-input" style={{ width: 200 }} placeholder="按操作过滤" value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)} />
        <input type="text" className="form-input" style={{ width: 240 }} placeholder="搜索 (操作/目标/执行者)" value={auditSearchQuery} onChange={(e) => setAuditSearchQuery(e.target.value)} />
        <button className="btn-primary btn-sm" onClick={() => loadAuditLogs()}>搜索</button>
        <button className="btn-secondary btn-sm" onClick={() => { setAuditActionFilter(""); setAuditSearchQuery(""); loadAuditLogs("", ""); }}>重置</button>
      </div>
      <div className="section-meta-text" style={{ marginBottom: 12 }}>
        保留策略: {auditRetention.retention_days}天 · 自动归档: {auditRetention.auto_archive ? "开" : "关"}
      </div>
      {auditLogs.length === 0 ? (
        <div className="empty-hint">暂无审计日志</div>
      ) : (
        <div className="audit-list" style={{ maxHeight: 500 }}>
          {auditLogs.map((log) => (
            <div key={log.id} className="audit-item">
              <div className="audit-head">
                <span className="audit-action">{log.action}</span>
                <span className={"audit-result " + (log.result === "200 OK" || log.result === "201 Created" || log.result === "OK" ? "result-ok" : "result-fail")}>
                  {log.result}
                </span>
              </div>
              <div className="audit-meta">
                <span>{log.actor_type}:{log.actor_id}</span>
                <span>{log.target_type}:{log.target_id}</span>
                <span>{log.ip}</span>
                <span>{log.created_at}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderIdentity = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>SSO 配置</h2>
          <button className="btn-primary btn-sm" onClick={() => {
            setSSOProtocol(ssoConfig?.protocol || "saml");
            setSSOIdpMetaUrl(ssoConfig?.idp_metadata_url || "");
            setSSOIdpEntityId(ssoConfig?.idp_entity_id || "");
            setSSOIdpCert("");
            setSSOForceSSO(ssoConfig?.force_sso || false);
            setSSOEnabled(ssoConfig?.enabled || false);
            setEditingSSO(true);
          }}>编辑</button>
        </div>
        <div className="enterprise-info-grid">
          <div>
            <strong>协议:</strong> {ssoConfig?.protocol?.toUpperCase() || "未配置"}
            <br /><strong>IdP Entity ID:</strong> {ssoConfig?.idp_entity_id || "-"}
            <br /><strong>SP Entity ID:</strong> {ssoConfig?.sp_entity_id || "-"}
          </div>
          <div>
            <strong>ACS URL:</strong> {ssoConfig?.acs_url || "-"}
            <br /><strong>强制 SSO:</strong> {ssoConfig?.force_sso ? "是" : "否"}
            <br /><strong>状态:</strong> {ssoConfig?.enabled ? "已启用" : "已禁用"}
          </div>
        </div>
        <div className="enterprise-mini-toolbar">
          <button className="btn-secondary btn-sm" onClick={async () => {
          const { baseURL } = await api();
          openInBrowser(baseURL + "/enterprise/sso/metadata");
          }}>查看 SP 元数据</button>
        </div>
      </div>

      <div className="section section-card">
        <div className="section-heading">
          <h2>SCIM 配置</h2>
          <button className="btn-primary btn-sm" onClick={() => {
            setSCIMEndpoint(scimConfig?.scim_endpoint || "");
            setSCIMEnabled(scimConfig?.enabled || false);
            setEditingSCIM(true);
          }}>编辑</button>
        </div>
        {scimConfig ? (
          <div className="enterprise-info-grid">
            <div><strong>端点:</strong> <code>{scimConfig.scim_endpoint}</code></div>
            <div><strong>Token:</strong> <code>{scimConfig.scim_token?.substring(0, 20)}...</code></div>
            <div><strong>同步状态:</strong> {scimConfig.sync_status}</div>
            <div><strong>上次同步:</strong> {scimConfig.last_sync_at || "从未"} · <strong>启用:</strong> {scimConfig.enabled ? "是" : "否"}</div>
            <div className="enterprise-mini-toolbar">
              <button className="btn-secondary btn-sm" onClick={async () => {
                const r = await doPost("/enterprise/scim/token", {});
                if (r.ok) loadAll();
              }}>刷新 Token</button>
            </div>
          </div>
        ) : (
          <div className="empty-hint">SCIM 未配置</div>
        )}
      </div>

      <div className="section section-card">
        <div className="section-heading">
          <h2>自定义角色</h2>
          <button className="btn-primary btn-sm" onClick={() => {
            setEditingRole(null);
            setRoleName("");
            setRoleDesc("");
            setRolePerms("{}");
          }}>新增角色</button>
        </div>
        {roles.length === 0 ? (
          <div className="empty-hint">暂无自定义角色</div>
        ) : (
          <div className="member-list">
            {roles.map((r) => (
              <div key={r.role_id} className="member-card" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="member-email">{r.name} {r.is_builtin && <span className="member-role role-member">预设</span>}</div>
                  <div className="member-meta">{r.description}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn-secondary btn-sm" onClick={() => {
                    setEditingRole(r);
                    setRoleName(r.name);
                    setRoleDesc(r.description);
                    setRolePerms(r.permissions);
                  }}>查看</button>
                  {!r.is_builtin && <button className="btn-text btn-sm" onClick={async () => { await doDelete("/enterprise/roles/" + r.role_id); loadAll(); }}>🗑️</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const renderPolicies = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>模型管控策略</h2>
          <button className="btn-primary btn-sm" onClick={() => {
            setEditingModelAllowed(modelPolicy?.allowed_models || "[]");
            setEditingModelDenied(modelPolicy?.denied_models || "[]");
            setEditingModelDefault(modelPolicy?.default_action || "allow");
            setEditingModelPolicy(true);
          }}>编辑</button>
        </div>
        <div className="enterprise-info-grid">
          <div><strong>允许模型:</strong> <code>{modelPolicy?.allowed_models || "[]"}</code></div>
          <div><strong>禁止模型:</strong> <code>{modelPolicy?.denied_models || "[]"}</code></div>
          <div><strong>默认动作:</strong> {modelPolicy?.default_action || "allow"}</div>
        </div>
      </div>

      <div className="section section-card">
        <div className="section-heading">
          <h2>IP 白名单</h2>
        </div>
        {ipWhitelist.length === 0 ? (
          <div className="empty-hint">暂无 IP 白名单</div>
        ) : (
          <div className="member-list">
            {ipWhitelist.map((e) => (
              <div key={e.id} className="member-card" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="member-email"><code>{e.cidr}</code></div>
                  <div className="member-meta">{e.description || "-"}</div>
                </div>
                <button className="btn-text btn-sm" onClick={async () => { await doDelete("/enterprise/policies/ip-whitelist/" + e.id); loadAll(); }}>🗑️</button>
              </div>
            ))}
          </div>
        )}
        <div className="enterprise-mini-toolbar">
          <input type="text" className="form-input" style={{ width: 180 }} placeholder="CIDR (如 192.168.1.0/24)" value={newIP.cidr} onChange={(e) => setNewIP({ ...newIP, cidr: e.target.value })} />
          <input type="text" className="form-input" style={{ width: 200 }} placeholder="描述" value={newIP.description} onChange={(e) => setNewIP({ ...newIP, description: e.target.value })} />
          <button className="btn-primary btn-sm" onClick={async () => {
            if (!newIP.cidr) return;
            await doPost("/enterprise/policies/ip-whitelist", newIP);
            setNewIP({ cidr: "", description: "" });
            loadAll();
          }}>添加</button>
        </div>
      </div>
    </>
  );

  const renderCompliance = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>合规报告</h2>
          <button className="btn-primary btn-sm" onClick={async () => {
            await doPost("/enterprise/compliance/reports/generate", { report_type: "monthly", format: "pdf" });
            loadAll();
          }}>生成报告</button>
        </div>
        {complianceReports.length === 0 ? (
          <div className="empty-hint">暂无合规报告</div>
        ) : (
          <div className="member-list">
            {complianceReports.map((r) => (
              <div key={r.report_id} className="member-card" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="member-email">{r.report_type} · {r.period_start?.substring(0, 10)} ~ {r.period_end?.substring(0, 10)}</div>
                  <div className="member-meta">
                    <span className={"member-status " + (r.status === "completed" ? "status-active" : "status-inactive")}>{r.status}</span>
                    <span>{r.file_format}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {r.status === "completed" && (
                    <button className="btn-secondary btn-sm" onClick={async () => {
                    const { baseURL } = await api();
                    openInBrowser(baseURL + "/enterprise/compliance/reports/" + r.report_id + "/export");
                    }}>下载</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section section-card">
        <div className="section-heading"><h2>定期推送配置</h2></div>
        <div className="enterprise-info-grid">
          <div><strong>频率:</strong> {complianceSchedule.frequency} · <strong>格式:</strong> {complianceSchedule.format}</div>
          <div><strong>目标邮箱:</strong> {complianceSchedule.target_email || "未设置"} · <strong>启用:</strong> {complianceSchedule.enabled ? "是" : "否"}</div>
        </div>
      </div>
    </>
  );

  const renderSLA = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>SLA 实时状态</h2>
          <button className="btn-secondary btn-sm" onClick={() => setSLAEventDialog(true)}>报告事件</button>
        </div>
        <div className="sla-grid">
          <div className="sla-item">
            <div className="sla-metric" style={{ color: slaStatus?.uptime_pct !== undefined && slaStatus.uptime_pct < 99.0 ? "var(--red)" : "var(--accent)" }}>
              {(slaStatus?.uptime_pct || 99.9).toFixed(2)}%
            </div>
            <div className="sla-label">可用率</div>
          </div>
          <div className="sla-item">
            <div className="sla-metric" style={{ color: slaStatus?.p95_latency_ms !== undefined && slaStatus.p95_latency_ms > 250 ? (slaStatus.p95_latency_ms > 300 ? "var(--red)" : "var(--orange)") : "var(--accent)" }}>
              {slaStatus?.p95_latency_ms || 0}ms
            </div>
            <div className="sla-label">P95 延迟</div>
          </div>
          <div className="sla-item">
            <div className="sla-metric" style={{ color: slaStatus?.error_rate_pct !== undefined && slaStatus.error_rate_pct > 1 ? "var(--red)" : "var(--accent)" }}>
              {(slaStatus?.error_rate_pct || 0).toFixed(2)}%
            </div>
            <div className="sla-label">错误率</div>
          </div>
          <div className="sla-item">
            <div className="sla-metric" style={{ color: (slaStatus?.status || "healthy") === "healthy" ? "var(--green)" : "var(--red)" }}>
              {(slaStatus?.status || "healthy") === "healthy" ? "正常" : "异常"}
            </div>
            <div className="sla-label">整体状态</div>
          </div>
        </div>
      </div>

      <div className="section section-card">
        <div className="section-heading">
          <h2>SLA 历史趋势</h2>
          <div style={{ display: "flex", gap: 4 }}>
            {[7, 30, 90].map((d) => (
              <button key={d} className={"btn-sm " + (slaTrendDays === d ? "btn-primary" : "btn-secondary")} onClick={() => { setSLATrendDays(d); loadSLATrend(d); }}>{d}天</button>
            ))}
          </div>
        </div>
        {slaTrend.length === 0 && <div className="empty-hint">暂无趋势数据</div>}
        {slaTrend.length > 0 && (
          <div style={{ fontSize: 13 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontWeight: 600, borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 8 }}>
              <span>日期</span>
              <span>可用率 | 延迟 | 错误率</span>
            </div>
            {slaTrend.map((p) => (
              <div key={p.date} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "4px 0" }}>
                <span>{p.date}</span>
                <span>{p.uptime_pct.toFixed(2)}% · {p.p95_latency_ms}ms · {(p.error_rate_pct * 100).toFixed(1)}‰</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section section-card">
        <div className="section-heading"><h2>SLA 事件</h2></div>
        {slaEvents.length === 0 ? (
          <div className="empty-hint">暂无 SLA 事件</div>
        ) : (
          <div className="audit-list">
            {slaEvents.map((e) => (
              <div key={e.id} className="audit-item">
                <div className="audit-head">
                  <span className="audit-action">{e.event_type}</span>
                  <span className={"audit-result " + (e.severity === "critical" || e.severity === "error" ? "result-fail" : "result-ok")}>{e.severity}</span>
                </div>
                <div className="audit-meta">{e.description} · {e.created_at}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const renderAlerts = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>告警规则</h2>
          <button className="btn-primary btn-sm" onClick={() => {
            setEditingAlertRule(null);
            setAlertRuleName("");
            setAlertRuleCondition("rate_limit_exceeded");
            setAlertRuleThreshold(0);
            setAlertRuleSeverity("warning");
          }}>新增规则</button>
        </div>
        {alertRules.length === 0 ? (
          <div className="empty-hint">暂无告警规则</div>
        ) : (
          <div className="member-list">
            {alertRules.map((r) => (
              <div key={r.rule_id} className="member-card" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="member-email">{r.name}</div>
                  <div className="member-meta">
                    <span className="member-role role-member">{r.condition_expr}</span>
                    {r.threshold > 0 && <span className="member-status status-active">阈值: {r.threshold}</span>}
                    <span className={"member-status " + (r.enabled ? "status-active" : "status-inactive")}>{r.enabled ? "已启用" : "已禁用"}</span>
                    <span className={"member-status status-" + (r.severity === "critical" ? "inactive" : "active")}>{r.severity}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn-secondary btn-sm" onClick={() => {
                    setEditingAlertRule(r);
                    setAlertRuleName(r.name);
                    setAlertRuleCondition(r.condition_expr);
                    setAlertRuleThreshold(r.threshold);
                    setAlertRuleSeverity(r.severity);
                  }}>编辑</button>
                  <button className="btn-text btn-sm" onClick={async () => { await doDelete("/enterprise/alert-rules/" + r.rule_id); loadAll(); }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section section-card">
        <div className="section-heading"><h2>告警事件</h2></div>
        {alertEvents.length === 0 ? (
          <div className="empty-hint">暂无告警事件</div>
        ) : (
          <div className="member-list">
            {alertEvents.map((e) => (
              <div key={e.event_id} className="member-card" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="member-email">{e.message}</div>
                  <div className="member-meta">
                    <span className={"member-role role-" + (e.severity === "critical" ? "admin" : "member")}>{e.severity}</span>
                    <span className={"member-status " + (e.resolved ? "status-active" : "status-inactive")}>{e.resolved ? "已解决" : "未解决"}</span>
                  </div>
                </div>
                {!e.resolved && (
                  <button className="btn-secondary btn-sm" onClick={async () => { await doPost("/enterprise/alert-events/" + e.event_id + "/resolve", {}); loadAll(); }}>解决</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const renderSupport = () => (
    <div className="section section-card">
      <div className="section-heading"><h2>支持与工单</h2></div>
      <div className="support-items">
        <div className="support-item">
          <div className="support-icon">📧</div>
          <div className="support-content">
            <div className="support-title">专属客户经理</div>
            <div className="support-desc">enterprise@seasagi.com · 7×24 专属支持</div>
          </div>
          <a href="mailto:enterprise@seasagi.com" className="btn-primary btn-sm">发送邮件</a>
        </div>
        <div className="support-item">
          <div className="support-icon">🐛</div>
          <div className="support-content">
            <div className="support-title">提交工单</div>
            <div className="support-desc">通过 GitHub Issues 提交技术支持工单</div>
          </div>
          <a href="https://github.com/neeke/seasagi/issues" target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">提交</a>
        </div>
        <div className="support-item">
          <div className="support-icon">📖</div>
          <div className="support-content">
            <div className="support-title">企业文档</div>
            <div className="support-desc">企业版部署、配置和集成指南</div>
          </div>
          <button className="btn-secondary btn-sm" onClick={() => openInBrowser("https://github.com/neeke/seasagi")}>查看</button>
        </div>
        <div className="support-item">
          <div className="support-icon">💬</div>
          <div className="support-content">
            <div className="support-title">SLA 事件报告</div>
            <div className="support-desc">报告服务异常或 SLA 违约事件</div>
          </div>
          <button className="btn-secondary btn-sm" onClick={() => setSLAEventDialog(true)}>报告</button>
        </div>
      </div>
    </div>
  );

  const renderDeployment = () => (
    <>
      <div className="section section-card">
        <div className="section-heading"><h2>数据驻留区域</h2></div>
        <div className="enterprise-region-grid">
          {dataRegions.map((r: any) => (
            <div
              key={r.region}
              className={`enterprise-region-card ${r.is_active ? "is-active" : "is-inactive"}`}
              onClick={() => {
                if (!r.is_active) { setSelectedRegion(r.region); setEditingRegion(true); }
              }}
            >
              <div className="enterprise-region-flag">{r.region === "us-east" ? "🇺🇸" : r.region === "us-west" ? "🇺🇸" : r.region === "eu" ? "🇪🇺" : "🇯🇵"}</div>
              <div className="enterprise-region-name">{r.region_name}</div>
              <div className="enterprise-region-code">{r.region}</div>
              {r.is_active && <div className="enterprise-region-active">当前区域</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="section section-card">
        <div className="section-heading"><h2>部署模式</h2></div>
        <div className="ent-governance-grid">
          <div className="governance-card">
            <div className="gov-icon">☁️</div>
            <div className="gov-title">云部署</div>
            <div className="gov-desc">由 SeasAGI 托管，自动更新维护</div>
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <button className={deploymentType === "cloud" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                onClick={() => { setNewDeploymentType("cloud"); setEditingDeploymentType(true); }}>选择</button>
            </div>
            {deploymentType === "cloud" && <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 4 }}>当前</div>}
          </div>
          <div className="governance-card">
            <div className="gov-icon">🏠</div>
            <div className="gov-title">私有部署</div>
            <div className="gov-desc">部署在您的基础设施中，完全控制</div>
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <button className={deploymentType === "private" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                onClick={() => { setNewDeploymentType("private"); setEditingDeploymentType(true); }}>选择</button>
            </div>
            {deploymentType === "private" && <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 4 }}>当前</div>}
          </div>
          <div className="governance-card">
            <div className="gov-icon">🔗</div>
            <div className="gov-title">混合部署</div>
            <div className="gov-desc">本地网关 + 云端控制面</div>
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <button className={deploymentType === "hybrid" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                onClick={() => { setNewDeploymentType("hybrid"); setEditingDeploymentType(true); }}>选择</button>
            </div>
            {deploymentType === "hybrid" && <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 4 }}>当前</div>}
          </div>
        </div>
      </div>

      <div className="section section-card">
        <div className="section-heading"><h2>License 管理</h2></div>
        {licenseInfo?.registered ? (
          <div className="enterprise-info-grid">
            <div><span style={{ color: "var(--text-muted)" }}>License Key:</span> {licenseInfo.license_key || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>类型:</span> {licenseInfo.license_type || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>状态:</span> <span style={{ color: licenseInfo.status === "active" ? "var(--green)" : "var(--red)" }}>{licenseInfo.status}</span></div>
            <div><span style={{ color: "var(--text-muted)" }}>最大席位:</span> {licenseInfo.max_seats || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>到期时间:</span> {licenseInfo.expires_at?.substring(0, 10) || "-"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>功能:</span> {licenseInfo.features || "[]"}</div>
          </div>
        ) : (
          <div className="enterprise-license-empty">
            <div className="empty-hint">尚未注册 License</div>
            <button className="btn-primary btn-sm" onClick={() => setEditingLicense(true)}>注册 License</button>
          </div>
        )}
      </div>

      {deploymentStatus && (
        <div className="section section-card">
          <div className="section-heading"><h2>混合部署状态</h2></div>
          <div className="hero-metrics enterprise-status-metrics">
            <div className="hero-metric-card">
              <span className="hero-metric-label">部署模式</span>
              <strong className="hero-metric-value">{deploymentStatus.deployment_type}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">数据区域</span>
              <strong className="hero-metric-value">{deploymentStatus.data_region}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">License</span>
              <strong className="hero-metric-value" style={{ color: deploymentStatus.license_status === "active" ? "var(--green)" : "var(--red)" }}>{deploymentStatus.license_status}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">网关状态</span>
              <strong className="hero-metric-value" style={{ color: deploymentStatus.gateway_status === "connected" ? "var(--green)" : "var(--red)" }}>{deploymentStatus.gateway_status}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">最后一次心跳</span>
              <strong className="hero-metric-value" style={{ fontSize: 12 }}>{deploymentStatus.last_heartbeat?.substring(0, 19) || "-"}</strong>
            </div>
          </div>
        </div>
      )}

      {editingRegion && (
        <div className="dialog-overlay" onClick={() => setEditingRegion(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>切换数据驻留区域</h3><button className="btn-text" onClick={() => setEditingRegion(false)}>✕</button></div>
            <div className="dialog-body">
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>切换到 {dataRegions.find((r: any) => r.region === selectedRegion)?.region_name}？切换后新数据将存储在该区域。</p>
              <label className="form-label">目标区域</label>
              <select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)} className="form-input">
                {dataRegions.map((r: any) => (<option key={r.region} value={r.region}>{r.region_name} ({r.region})</option>))}
              </select>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingRegion(false)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPut("/enterprise/data-regions", { region: selectedRegion });
                setEditingRegion(false);
                loadAll();
              }}>确认切换</button>
            </div>
          </div>
        </div>
      )}

      {editingLicense && (
        <div className="dialog-overlay" onClick={() => setEditingLicense(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>注册 License</h3><button className="btn-text" onClick={() => setEditingLicense(false)}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">License Key</label>
              <input type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} className="form-input" placeholder="输入 License Key" />
              <label className="form-label" style={{ marginTop: 12 }}>控制面 URL（可选）</label>
              <input type="url" value={controlPlaneURL} onChange={(e) => setControlPlaneURL(e.target.value)} className="form-input" placeholder="https://control.yourcompany.com" />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingLicense(false)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPost("/enterprise/license/register", { license_key: licenseKey, control_plane_url: controlPlaneURL });
                setEditingLicense(false);
                setLicenseKey("");
                setControlPlaneURL("");
                loadAll();
              }}>注册</button>
            </div>
          </div>
        </div>
      )}

      {editingDeploymentType && (
        <div className="dialog-overlay" onClick={() => setEditingDeploymentType(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>切换部署模式</h3><button className="btn-text" onClick={() => setEditingDeploymentType(false)}>✕</button></div>
            <div className="dialog-body">
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
                {newDeploymentType === "cloud" ? "切换到云部署模式" : newDeploymentType === "private" ? "切换到私有部署模式（需注册 License）" : "切换到混合部署模式（需注册 License）"}
              </p>
              <label className="form-label">部署模式</label>
              <select value={newDeploymentType} onChange={(e) => setNewDeploymentType(e.target.value)} className="form-input">
                <option value="cloud">云部署</option>
                <option value="private">私有部署</option>
                <option value="hybrid">混合部署</option>
              </select>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingDeploymentType(false)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPut("/enterprise/deployment/type", { deployment_type: newDeploymentType });
                setEditingDeploymentType(false);
                loadAll();
              }}>确认</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const renderDialog = () => (
    <>
      {editingSSO && (
        <div className="dialog-overlay" onClick={() => setEditingSSO(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>SSO 配置</h3><button className="btn-text" onClick={() => setEditingSSO(false)}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">协议</label>
              <select value={ssoProtocol} onChange={(e) => setSSOProtocol(e.target.value)} className="form-input">
                <option value="saml">SAML 2.0</option>
                <option value="oidc">OIDC</option>
              </select>
              <label className="form-label" style={{ marginTop: 12 }}>IdP 元数据 URL</label>
              <input type="url" value={ssoIdpMetaUrl} onChange={(e) => setSSOIdpMetaUrl(e.target.value)} className="form-input" placeholder="https://idp.example.com/metadata" />
              <label className="form-label" style={{ marginTop: 12 }}>IdP Entity ID</label>
              <input type="text" value={ssoIdpEntityId} onChange={(e) => setSSOIdpEntityId(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>IdP 证书</label>
              <textarea value={ssoIdpCert} onChange={(e) => setSSOIdpCert(e.target.value)} className="form-input" rows={3} />
              <label className="form-label" style={{ marginTop: 12 }}><input type="checkbox" checked={ssoForceSSO} onChange={(e) => setSSOForceSSO(e.target.checked)} /> 强制 SSO</label>
              <label className="form-label"><input type="checkbox" checked={ssoEnabled} onChange={(e) => setSSOEnabled(e.target.checked)} /> 启用</label>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingSSO(false)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPut("/enterprise/sso/config", {
                  protocol: ssoProtocol,
                  idp_metadata_url: ssoIdpMetaUrl,
                  idp_entity_id: ssoIdpEntityId,
                  idp_certificate: ssoIdpCert,
                  force_sso: ssoForceSSO,
                  enabled: ssoEnabled,
                });
                setEditingSSO(false);
                loadAll();
              }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {editingSCIM && (
        <div className="dialog-overlay" onClick={() => setEditingSCIM(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>SCIM 配置</h3><button className="btn-text" onClick={() => setEditingSCIM(false)}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">SCIM 端点 URL</label>
              <input type="url" value={scimEndpoint} onChange={(e) => setSCIMEndpoint(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}><input type="checkbox" checked={scimEnabled} onChange={(e) => setSCIMEnabled(e.target.checked)} /> 启用 SCIM</label>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingSCIM(false)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPut("/enterprise/scim/config", { scim_endpoint: scimEndpoint, enabled: scimEnabled });
                setEditingSCIM(false);
                loadAll();
              }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {editingModelPolicy && (
        <div className="dialog-overlay" onClick={() => setEditingModelPolicy(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>模型管控策略</h3><button className="btn-text" onClick={() => setEditingModelPolicy(false)}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">允许模型 (JSON 数组)</label>
              <textarea value={editingModelAllowed} onChange={(e) => setEditingModelAllowed(e.target.value)} className="form-input" rows={3} placeholder='["gpt-4o","claude-3-5-sonnet"]' />
              <label className="form-label" style={{ marginTop: 12 }}>禁止模型 (JSON 数组)</label>
              <textarea value={editingModelDenied} onChange={(e) => setEditingModelDenied(e.target.value)} className="form-input" rows={3} placeholder='["gpt-4o-mini"]' />
              <label className="form-label" style={{ marginTop: 12 }}>默认动作</label>
              <select value={editingModelDefault} onChange={(e) => setEditingModelDefault(e.target.value)} className="form-input">
                <option value="allow">允许</option>
                <option value="deny">拒绝</option>
              </select>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingModelPolicy(false)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPut("/enterprise/policies/models", { allowed_models: editingModelAllowed, denied_models: editingModelDenied, default_action: editingModelDefault });
                setEditingModelPolicy(false);
                loadAll();
              }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {editingRole !== null && editingRole !== undefined && (
        <div className="dialog-overlay" onClick={() => setEditingRole(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>{editingRole ? "查看角色" : "新增角色"}</h3><button className="btn-text" onClick={() => setEditingRole(null)}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">角色名称</label>
              <input type="text" value={roleName} disabled={editingRole?.is_builtin} onChange={(e) => setRoleName(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>描述</label>
              <input type="text" value={roleDesc} disabled={editingRole?.is_builtin} onChange={(e) => setRoleDesc(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>权限 (JSON)</label>
              <textarea value={rolePerms} disabled={editingRole?.is_builtin} onChange={(e) => setRolePerms(e.target.value)} className="form-input" rows={5} />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingRole(null)}>关闭</button>
              {!editingRole?.is_builtin && <button className="btn-primary" onClick={async () => {
                if (editingRole) {
                  await doPut("/enterprise/roles/" + editingRole.role_id, { name: roleName, description: roleDesc, permissions: rolePerms });
                } else {
                  await doPost("/enterprise/roles", { name: roleName, description: roleDesc, permissions: rolePerms });
                }
                setEditingRole(null);
                loadAll();
              }}>保存</button>}
            </div>
          </div>
        </div>
      )}

      {editingAlertRule !== undefined && (
        <div className="dialog-overlay" onClick={() => setEditingAlertRule(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>{editingAlertRule ? "编辑告警规则" : "新增告警规则"}</h3><button className="btn-text" onClick={() => setEditingAlertRule(null)}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">规则名称</label>
              <input type="text" value={alertRuleName} onChange={(e) => setAlertRuleName(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>条件</label>
              <select value={alertRuleCondition} onChange={(e) => setAlertRuleCondition(e.target.value)} className="form-input">
                <option value="rate_limit_exceeded">速率限制超标</option>
                <option value="error_rate_high">错误率过高</option>
                <option value="latency_high">延迟过高</option>
                <option value="quota_exceeded">配额超标</option>
                <option value="cost_spike">成本激增</option>
              </select>
              <label className="form-label" style={{ marginTop: 12 }}>阈值</label>
              <input type="number" value={alertRuleThreshold} onChange={(e) => setAlertRuleThreshold(Number(e.target.value))} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>严重程度</label>
              <select value={alertRuleSeverity} onChange={(e) => setAlertRuleSeverity(e.target.value)} className="form-input">
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingAlertRule(null)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                if (editingAlertRule) {
                  await doPut("/enterprise/alert-rules/" + editingAlertRule.rule_id, { name: alertRuleName, condition: alertRuleCondition, threshold: alertRuleThreshold, severity: alertRuleSeverity });
                } else {
                  await doPost("/enterprise/alert-rules", { name: alertRuleName, condition: alertRuleCondition, threshold: alertRuleThreshold, severity: alertRuleSeverity, tenant_id: auth.user_id || "enterprise" });
                }
                setEditingAlertRule(null);
                loadAll();
              }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {slaEventDialog && (
        <div className="dialog-overlay" onClick={() => setSLAEventDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>报告 SLA 事件</h3><button className="btn-text" onClick={() => setSLAEventDialog(false)}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">事件类型</label>
              <select value={slaEventType} onChange={(e) => setSLAEventType(e.target.value)} className="form-input">
                <option value="downtime">服务宕机</option>
                <option value="latency_spike">延迟激增</option>
                <option value="error_spike">错误率激增</option>
                <option value="degradation">性能下降</option>
                <option value="other">其他</option>
              </select>
              <label className="form-label" style={{ marginTop: 12 }}>描述</label>
              <textarea value={slaEventDesc} onChange={(e) => setSLAEventDesc(e.target.value)} className="form-input" rows={3} />
              <label className="form-label" style={{ marginTop: 12 }}>严重程度</label>
              <select value={slaEventSeverity} onChange={(e) => setSLAEventSeverity(e.target.value)} className="form-input">
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setSLAEventDialog(false)}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPost("/enterprise/sla/events/report", { event_type: slaEventType, description: slaEventDesc, severity: slaEventSeverity });
                setSLAEventDialog(false);
                setSLAEventType("");
                setSLAEventDesc("");
                setSLAEventSeverity("info");
                loadAll();
              }}>提交</button>
            </div>
          </div>
        </div>
      )}

      {editingRole === null && roleName !== "" && (
        <div className="dialog-overlay" onClick={() => { setEditingRole(null); setRoleName(""); }}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header"><h3>新增角色</h3><button className="btn-text" onClick={() => { setEditingRole(null); setRoleName(""); }}>✕</button></div>
            <div className="dialog-body">
              <label className="form-label">角色名称</label>
              <input type="text" value={roleName} onChange={(e) => setRoleName(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>描述</label>
              <input type="text" value={roleDesc} onChange={(e) => setRoleDesc(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>权限 (JSON)</label>
              <textarea value={rolePerms} onChange={(e) => setRolePerms(e.target.value)} className="form-input" rows={5} />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => { setEditingRole(null); setRoleName(""); }}>取消</button>
              <button className="btn-primary" onClick={async () => {
                await doPost("/enterprise/roles", { name: roleName, description: roleDesc, permissions: rolePerms });
                setRoleName("");
                setRoleDesc("");
                setRolePerms("{}");
                loadAll();
              }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="page enterprise-page">
      <div className="page-header">
        <div>
          <h1>企业门户</h1>
          <p className="page-subtitle">治理 · 审计 · 合规 · SLA 保障</p>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric-card">
            <span className="hero-metric-label">审计事件</span>
            <strong className="hero-metric-value">{auditLogs.length}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">告警规则</span>
            <strong className="hero-metric-value">{alertRules.length}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">SLA</span>
            <strong className="hero-metric-value" style={{ color: (slaStatus?.status || "healthy") === "healthy" ? "var(--green)" : "var(--red)" }}>
              {(slaStatus?.status || "healthy") === "healthy" ? "正常" : "异常"}
            </strong>
          </div>
        </div>
      </div>

      <div className="tab-bar" style={{ display: "flex", gap: 2, marginBottom: 18, background: "var(--bg-tertiary)", padding: 4, borderRadius: "var(--radius)", overflow: "auto" }}>
        {tabList.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: "8px 12px", border: "none", background: "none", whiteSpace: "nowrap",
              color: activeTab === tab.id ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 6,
              ...(activeTab === tab.id ? { background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" } : {}),
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && renderOverview()}
      {activeTab === "audit" && renderAudit()}
      {activeTab === "identity" && renderIdentity()}
      {activeTab === "policies" && renderPolicies()}
      {activeTab === "compliance" && renderCompliance()}
      {activeTab === "sla" && renderSLA()}
      {activeTab === "alerts" && renderAlerts()}
      {activeTab === "support" && renderSupport()}
      {activeTab === "deployment" && renderDeployment()}

      {renderDialog()}
    </div>
  );
}