import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import { useTeamStore, type Strategy, type ComboTemplate, type WebhookItem } from "../stores/teamStore";
import { getPlatformAPIBaseURL, getPlatformToken } from "../utils/commands";

type TabId = "overview" | "members" | "usage" | "strategy" | "billing" | "webhook";

const apiFetch = async (path: string, options?: RequestInit) => {
  const [baseURL, token] = await Promise.all([getPlatformAPIBaseURL(), getPlatformToken()]);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(baseURL + path, { ...options, headers: { ...headers, ...((options?.headers as Record<string,string>) || {}) } });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${errBody || res.statusText}`);
  }
  return res.json();
};

export function TeamWorkspacePage() {
  const navigate = useNavigate();
  const auth = useAppStore((s) => s.auth);
  const cloudBilling = useAppStore((s) => s.cloudBilling);

  const store = useTeamStore();
  const profile = store.profile;
  const memberUsage = store.memberUsage;
  const strategies = store.strategies;
  const templates = store.templates;
  const webhooks = store.webhooks;
  const invoices = store.invoices;
  const overages = store.overages;
  const seatInfo = store.seatInfo;
  const billingSummary = store.getBillingSummary();
  const costAttribution = store.getCostAttribution();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileBillingEmail, setProfileBillingEmail] = useState("");

  const [inviteDialog, setInviteDialog] = useState(false);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const [inviteLinkDialog, setInviteLinkDialog] = useState(false);
  const [inviteLinkRole, setInviteLinkRole] = useState("member");
  const [inviteLinkExpiresIn, setInviteLinkExpiresIn] = useState(604800);
  const [inviteLinkMaxUses, setInviteLinkMaxUses] = useState<number | null>(null);

  // Server-synced data
  const [serverMembers, setServerMembers] = useState<any[]>([]);
  const [serverInviteLinks, setServerInviteLinks] = useState<any[]>([]);
  const [serverError, setServerError] = useState("");

  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [strategyDialog, setStrategyDialog] = useState(false);
  const [strategyName, setStrategyName] = useState("");
  const [strategyType, setStrategyType] = useState("fallback");
  const [strategyConfig, setStrategyConfig] = useState("{}");

  const [editingTemplate, setEditingTemplate] = useState<ComboTemplate | null>(null);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateModels, setTemplateModels] = useState("[]");
  const [templateRoutingMode, setTemplateRoutingMode] = useState("fallback");

  const [editingWebhook, setEditingWebhook] = useState<WebhookItem | null>(null);
  const [webhookDialog, setWebhookDialog] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState("[]");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(true);

  const [editingSeats, setEditingSeats] = useState(false);
  const [newSeatCount, setNewSeatCount] = useState(5);

  const isTeamsOrAbove = cloudBilling?.plan_id === "teams" || cloudBilling?.plan_id === "enterprise";

  const fetchMembers = useCallback(async () => {
    if (!auth.is_logged_in || !isTeamsOrAbove) return;
    try {
      const data = await apiFetch("/tenant-admin/members");
      setServerMembers(data.data || []);
    } catch {}
  }, [auth.is_logged_in, isTeamsOrAbove]);

  const fetchInviteLinks = useCallback(async () => {
    if (!auth.is_logged_in || !isTeamsOrAbove) return;
    try {
      const data = await apiFetch("/tenant-admin/invite-links");
      setServerInviteLinks(data.data || []);
    } catch {}
  }, [auth.is_logged_in, isTeamsOrAbove]);

  useEffect(() => {
    if (!auth.is_logged_in) return;
    if (!isTeamsOrAbove) { setLoading(false); return; }
    Promise.all([fetchMembers(), fetchInviteLinks()]).finally(() => setLoading(false));
  }, [auth.is_logged_in, isTeamsOrAbove, fetchMembers, fetchInviteLinks]);

  /* --- Member handlers --- */
  const handleMemberInvite = async () => {
    const emails = inviteEmails.split("\n").map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setServerError("");
    try {
      await apiFetch("/tenant-admin/members/invite", {
        method: "POST",
        body: JSON.stringify({ emails, role: inviteRole }),
      });
      store.addMembersBulk(emails, inviteRole);
      setInviteDialog(false);
      setInviteEmails("");
      await fetchMembers();
    } catch (e: any) {
      setServerError("邀请失败: " + e.message);
    }
  };

  const handleCreateInviteLink = async () => {
    setServerError("");
    try {
      await apiFetch("/tenant-admin/invite-links", {
        method: "POST",
        body: JSON.stringify({ role: inviteLinkRole, expires_in: inviteLinkExpiresIn, max_uses: inviteLinkMaxUses }),
      });
      store.createInviteLink(inviteLinkRole, inviteLinkExpiresIn, inviteLinkMaxUses);
      setInviteLinkDialog(false);
      await fetchInviteLinks();
    } catch (e: any) {
      setServerError("创建邀请链接失败: " + e.message);
    }
  };

  const handleCopyInviteLink = (token: string) => {
    navigator.clipboard.writeText(window.location.origin + "/invite/" + token);
  };

  const handleDeleteInviteLink = async (linkId: string) => {
    if (!confirm("确定删除该邀请链接？")) return;
    setServerError("");
    try {
      await apiFetch(`/tenant-admin/invite-links/${linkId}`, { method: "DELETE" });
      store.deleteInviteLink(linkId);
      await fetchInviteLinks();
    } catch (e: any) {
      setServerError("删除邀请链接失败: " + e.message);
    }
  };

  const handleRoleChange = async (memberId: string, role: string) => {
    try {
      await apiFetch(`/tenant-admin/members/${memberId}/role`, { method: "PUT", body: JSON.stringify({ role }) });
      store.updateMemberRole(memberId, role);
    } catch (e: any) {
      alert("更新角色失败: " + e.message);
    }
  };

  const handleDisableMember = async (memberId: string) => {
    try {
      await apiFetch(`/tenant-admin/members/${memberId}/disable`, { method: "POST" });
      store.setMemberStatus(memberId, "disabled");
    } catch (e: any) {
      alert("禁用成员失败: " + e.message);
    }
  };

  const handleEnableMember = async (memberId: string) => {
    try {
      await apiFetch(`/tenant-admin/members/${memberId}/enable`, { method: "POST" });
      store.setMemberStatus(memberId, "active");
    } catch (e: any) {
      alert("启用成员失败: " + e.message);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("确定移除该成员？")) return;
    try {
      await apiFetch(`/tenant-admin/members/${memberId}`, { method: "DELETE" });
      store.removeMember(memberId);
    } catch (e: any) {
      alert("移除成员失败: " + e.message);
    }
  };

  /* --- Profile handler --- */
  const handleUpdateProfile = () => {
    store.updateProfile({
      name: profileName || undefined,
      billing_email: profileBillingEmail || undefined,
    } as any);
    setEditingProfile(false);
  };

  /* --- Strategy handlers --- */
  const handleSaveStrategy = () => {
    if (editingStrategy) {
      store.updateStrategy(editingStrategy.strategy_id, { name: strategyName, strategy_type: strategyType, config: strategyConfig });
    } else {
      store.addStrategy(strategyName, strategyType, strategyConfig);
    }
    resetStrategyDialog();
  };

  const handleDeleteStrategy = (id: string) => {
    if (!confirm("确定删除该策略？")) return;
    store.deleteStrategy(id);
  };

  /* --- Template handlers --- */
  const handleSaveTemplate = () => {
    if (editingTemplate) {
      store.updateTemplate(editingTemplate.template_id, { name: templateName, models: templateModels, routing_mode: templateRoutingMode });
    } else {
      store.addTemplate(templateName, templateModels, templateRoutingMode);
    }
    resetTemplateDialog();
  };

  const handleDeleteTemplate = (id: string) => {
    if (!confirm("确定删除该模板？")) return;
    store.deleteTemplate(id);
  };

  /* --- Webhook handlers --- */
  const handleSaveWebhook = () => {
    if (editingWebhook) {
      store.updateWebhook(editingWebhook.webhook_id, { name: webhookName, url: webhookUrl, events: webhookEvents, secret: webhookSecret, enabled: webhookEnabled });
    } else {
      store.addWebhook({ name: webhookName, url: webhookUrl, events: webhookEvents, secret: webhookSecret, enabled: webhookEnabled });
    }
    resetWebhookDialog();
  };

  const handleDeleteWebhook = (id: string) => {
    if (!confirm("确定删除该 Webhook？")) return;
    store.deleteWebhook(id);
  };

  const resetStrategyDialog = () => {
    setEditingStrategy(null);
    setStrategyDialog(false);
    setStrategyName("");
    setStrategyType("fallback");
    setStrategyConfig("{}");
  };

  const resetTemplateDialog = () => {
    setEditingTemplate(null);
    setTemplateDialog(false);
    setTemplateName("");
    setTemplateModels("[]");
    setTemplateRoutingMode("fallback");
  };

  const resetWebhookDialog = () => {
    setEditingWebhook(null);
    setWebhookDialog(false);
    setWebhookName("");
    setWebhookUrl("");
    setWebhookEvents("[]");
    setWebhookSecret("");
    setWebhookEnabled(true);
  };

  if (!auth.is_logged_in) {
    return (
      <div className="page team-page">
        <div className="empty-state">
          <h2>请先登录</h2>
          <p>登录后可查看团队工作区</p>
        </div>
      </div>
    );
  }

  if (!isTeamsOrAbove) {
    return (
      <div className="page team-page">
        <div className="empty-state">
          <div className="empty-icon">👥</div>
          <h2>团队工作区</h2>
          <p>升级到 Teams 套餐以使用团队协作功能</p>
          <button className="btn-primary" onClick={() => navigate("/subscription")}>查看套餐</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page team-page">
        <div className="loading-state">
          <div className="spinner" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  /* ======== RENDER HELPERS ======== */

  const renderOverview = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>{profile.name || "我的团队"}</h2>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn-secondary btn-sm" onClick={() => { setProfileName(profile.name); setProfileBillingEmail(profile.billing_email || ""); setEditingProfile(true); }}>编辑</button>
          </div>
        </div>
        <div className="hero-metrics" style={{ marginTop: 8 }}>
          <div className="hero-metric-card">
            <span className="hero-metric-label">成员</span>
            <strong className="hero-metric-value">{serverMembers.filter((m) => m.status === "active").length}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">席位</span>
            <strong className="hero-metric-value">{seatInfo.seats}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">策略</span>
            <strong className="hero-metric-value">{strategies.length}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">模板</span>
            <strong className="hero-metric-value">{templates.length}</strong>
          </div>
        </div>
        {profile.billing_email && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
            结算邮箱: {profile.billing_email}
          </div>
        )}
        <div className="snapshot-footer">
          <button className="btn-secondary btn-sm" onClick={() => setActiveTab("members")}>管理成员</button>
          <button className="btn-secondary btn-sm" onClick={() => setActiveTab("strategy")}>管理策略</button>
          <button className="btn-secondary btn-sm" onClick={() => setActiveTab("usage")}>查看用量</button>
        </div>
      </div>

      {costAttribution && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>本月成本</h2>
            <p className="hint">{costAttribution.month} · 较上月 {costAttribution.total_cost > costAttribution.previous_cost ? "↑" : "↓"} ${Math.abs(costAttribution.total_cost - costAttribution.previous_cost).toFixed(2)}</p>
          </div>
          <div className="hero-metrics" style={{ marginTop: 8 }}>
            <div className="hero-metric-card">
              <span className="hero-metric-label">本月总成本</span>
              <strong className="hero-metric-value">${(costAttribution.total_cost || 0).toFixed(2)}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">上月成本</span>
              <strong className="hero-metric-value">${(costAttribution.previous_cost || 0).toFixed(2)}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">{costAttribution.members?.length || 0} 成员</span>
              <strong className="hero-metric-value">{costAttribution.model_breakdown?.length || 0} 模型</strong>
            </div>
          </div>
          {costAttribution.members?.slice(0, 5).map((m: any) => (
            <div key={m.member_id} className="member-card" style={{ borderBottom: "1px solid var(--border)", padding: "10px 4px", borderRadius: 0 }}>
              <div className="member-avatar">{m.email[0]?.toUpperCase()}</div>
              <div className="member-info">
                <div className="member-email">{m.email}</div>
                <div className="member-meta">
                  <span className={`member-role role-${m.role}`}>{m.role}</span>
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>${(m.cost || 0).toFixed(2)}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{m.pct?.toFixed(1)}%</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {billingSummary && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>账单概览</h2>
          </div>
          <div className="hero-metrics" style={{ marginTop: 12 }}>
            <div className="hero-metric-card">
              <span className="hero-metric-label">总订单数</span>
              <strong className="hero-metric-value">{billingSummary.order_count || 0}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">已支付</span>
              <strong className="hero-metric-value">{billingSummary.paid_orders || 0}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">总收入</span>
              <strong className="hero-metric-value">${(billingSummary.gross_revenue || 0).toFixed(2)}</strong>
            </div>
          </div>
        </div>
      )}

      <div className="section section-card">
        <div className="section-heading">
          <h2>席位管理</h2>
          <button className="btn-primary btn-sm" onClick={() => { setNewSeatCount(seatInfo.seats); setEditingSeats(true); }}>调整席位</button>
        </div>
        <div className="hero-metrics" style={{ marginTop: 8 }}>
          <div className="hero-metric-card">
            <span className="hero-metric-label">总席位</span>
            <strong className="hero-metric-value">{seatInfo.seats}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">已用</span>
            <strong className="hero-metric-value">{seatInfo.active_members}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">可用</span>
            <strong className="hero-metric-value">{seatInfo.available}</strong>
          </div>
        </div>
      </div>

      <div className="section section-card">
        <div className="section-heading">
          <h2>快速操作</h2>
        </div>
        <div className="ent-governance-grid">
          <div className="governance-card" onClick={() => setActiveTab("members")} style={{ cursor: "pointer" }}>
            <div className="gov-icon">👥</div>
            <div className="gov-title">{serverMembers.length} 成员</div>
            <div className="gov-desc">管理团队成员的访问权限</div>
          </div>
          <div className="governance-card" onClick={() => setActiveTab("strategy")} style={{ cursor: "pointer" }}>
            <div className="gov-icon">🔀</div>
            <div className="gov-title">{strategies.length} 策略</div>
            <div className="gov-desc">配置路由与负载均衡策略</div>
          </div>
          <div className="governance-card" onClick={() => setActiveTab("usage")} style={{ cursor: "pointer" }}>
            <div className="gov-icon">📊</div>
            <div className="gov-title">用量排行</div>
            <div className="gov-desc">查看团队成员的请求量</div>
          </div>
        </div>
      </div>
    </>
  );

  const renderMembers = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>成员管理</h2>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn-primary btn-sm" onClick={() => setInviteDialog(true)}>邀请成员</button>
            <button className="btn-secondary btn-sm" onClick={() => setInviteLinkDialog(true)}>创建邀请链接</button>
          </div>
        </div>
        {serverError && <div className="error-msg" style={{ marginBottom: 8 }}>{serverError}</div>}
        <div className="member-list">
          {serverMembers.map((m: any) => (
            <div key={m.member_id} className="member-card">
              <div className="member-avatar">{m.email[0]?.toUpperCase() || "?"}</div>
              <div className="member-info">
                <div className="member-email">{m.email}</div>
                <div className="member-meta">
                  <span className={`member-role role-${m.role}`}>{m.role}</span>
                  <span className={m.status === "active" ? "badge-active" : "badge-inactive"}>{m.status}</span>
                </div>
              </div>
              <div className="member-actions">
                {m.role !== "owner" && (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.member_id, e.target.value)}
                      className="form-input"
                      style={{ width: 90, fontSize: 12, padding: "4px 6px" }}
                    >
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </select>
                    {m.status === "active" ? (
                      <button className="btn-secondary btn-sm" onClick={() => handleDisableMember(m.member_id)}>禁用</button>
                    ) : (
                      <button className="btn-primary btn-sm" onClick={() => handleEnableMember(m.member_id)}>启用</button>
                    )}
                    <button className="btn-text" style={{ color: "var(--red)" }} onClick={() => handleRemoveMember(m.member_id)}>移除</button>
                  </>
                )}
                {m.role === "owner" && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>所有者</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {serverInviteLinks.length > 0 && (
        <div className="section section-card">
          <div className="section-heading">
            <h2>邀请链接</h2>
          </div>
          {serverInviteLinks.map((link: any) => (
            <div key={link.link_id} className="member-card">
              <div style={{ flex: 1, fontSize: 13 }}>
                <code style={{ fontSize: 12 }}>{link.token.substring(0, 16)}...</code>
                <span className="member-meta" style={{ marginLeft: 8 }}>
                  <span className={`member-role role-${link.role}`}>{link.role}</span>
                  {link.max_uses && <span>· 最多 {link.max_uses} 次</span>}
                  <span>· 已用 {link.used_count} 次</span>
                  {link.expires_at && <span>· 过期: {new Date(link.expires_at).toLocaleDateString()}</span>}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="btn-secondary btn-sm" onClick={() => handleCopyInviteLink(link.token)}>复制</button>
                <button className="btn-text" style={{ color: "var(--red)" }} onClick={() => handleDeleteInviteLink(link.link_id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderUsage = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>团队用量排行 (本月)</h2>
          <p className="hint">按成员、模型维度查看用量分布</p>
        </div>
        {memberUsage.length === 0 ? (
          <div className="empty-hint">暂无用量数据</div>
        ) : (
          <div className="member-list">
            {memberUsage.map((m) => (
              <div key={m.member_id} className="member-card">
                <div className="member-avatar">{m.email[0]?.toUpperCase() || "?"}</div>
                <div className="member-info">
                  <div className="member-email">{m.email}</div>
                  <div className="member-meta">
                    <span className={`member-role role-${m.role}`}>{m.role}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, flexShrink: 0, fontSize: 13 }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{m.requests.toLocaleString()} 请求</span>
                  <span style={{ color: "var(--text-secondary)" }}>↑{m.input_tokens.toLocaleString()}</span>
                  <span style={{ color: "var(--text-secondary)" }}>↓{m.output_tokens.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {costAttribution && (
        <>
          <div className="section section-card">
            <div className="section-heading">
              <h2>成本归因明细</h2>
              <p className="hint">{costAttribution.month} · 成员级成本分布</p>
            </div>
            <div className="hero-metrics" style={{ marginTop: 8 }}>
              <div className="hero-metric-card">
                <span className="hero-metric-label">本月总成本</span>
                <strong className="hero-metric-value">${(costAttribution.total_cost || 0).toFixed(2)}</strong>
              </div>
              <div className="hero-metric-card">
                <span className="hero-metric-label">较上月</span>
                <strong className="hero-metric-value" style={{ color: costAttribution.total_cost > costAttribution.previous_cost ? "var(--red)" : "var(--green)" }}>
                  {costAttribution.total_cost > costAttribution.previous_cost ? "↑" : "↓"} ${Math.abs(costAttribution.total_cost - costAttribution.previous_cost).toFixed(2)}
                </strong>
              </div>
            </div>
            {(costAttribution.members || []).length > 0 && (
              <div className="member-list">
                <div className="member-card" style={{ fontWeight: 700, fontSize: 12, color: "var(--text-muted)", padding: "8px 4px", borderBottom: "2px solid var(--border)" }}>
                  <div style={{ flex: 1 }}>成员</div>
                  <div style={{ width: 80, textAlign: "right" }}>请求</div>
                  <div style={{ width: 80, textAlign: "right" }}>成本</div>
                  <div style={{ width: 60, textAlign: "right" }}>占比</div>
                </div>
                {costAttribution.members.map((m: any) => (
                  <div key={m.member_id} className="member-card" style={{ padding: "10px 4px" }}>
                    <div className="member-avatar">{m.email[0]?.toUpperCase()}</div>
                    <div className="member-info">
                      <div className="member-email">{m.email}</div>
                    </div>
                    <div style={{ width: 80, textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>{m.requests.toLocaleString()}</div>
                    <div style={{ width: 80, textAlign: "right", fontSize: 13, fontWeight: 600 }}>${(m.cost || 0).toFixed(2)}</div>
                    <div style={{ width: 60, textAlign: "right", fontSize: 12, color: "var(--text-muted)" }}>{(m.pct || 0).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(costAttribution.model_breakdown || []).length > 0 && (
            <div className="section section-card">
              <div className="section-heading">
                <h2>模型分布</h2>
                <p className="hint">按模型维度的用量与成本</p>
              </div>
              <div className="member-list">
                <div className="member-card" style={{ fontWeight: 700, fontSize: 12, color: "var(--text-muted)", padding: "8px 4px", borderBottom: "2px solid var(--border)" }}>
                  <div style={{ flex: 1 }}>模型</div>
                  <div style={{ width: 80, textAlign: "right" }}>请求</div>
                  <div style={{ width: 100, textAlign: "right" }}>输入 Token</div>
                  <div style={{ width: 100, textAlign: "right" }}>输出 Token</div>
                  <div style={{ width: 70, textAlign: "right" }}>成本</div>
                </div>
                {costAttribution.model_breakdown.map((m: any, i: number) => (
                  <div key={i} className="member-card" style={{ padding: "10px 4px" }}>
                    <div className="member-avatar" style={{ fontSize: 11, minWidth: 28 }}>🧠</div>
                    <div className="member-info">
                      <div className="member-email" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{m.model}</div>
                    </div>
                    <div style={{ width: 80, textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>{m.requests.toLocaleString()}</div>
                    <div style={{ width: 100, textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>{m.input_tokens.toLocaleString()}</div>
                    <div style={{ width: 100, textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>{m.output_tokens.toLocaleString()}</div>
                    <div style={{ width: 70, textAlign: "right", fontSize: 13, fontWeight: 600 }}>${(m.cost || 0).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  const renderStrategy = () => (
    <>
      <div className="section section-card">
        <div className="section-heading">
          <h2>路由策略</h2>
          <button className="btn-primary btn-sm" onClick={() => { setEditingStrategy(null); setStrategyName(""); setStrategyType("fallback"); setStrategyConfig("{}"); setStrategyDialog(true); }}>新增策略</button>
        </div>
        {strategies.length === 0 ? (
          <div className="empty-hint">暂无策略，创建一个开始</div>
        ) : (
          <div className="member-list">
            {strategies.map((s) => (
              <div key={s.strategy_id} className="member-card">
                <div className="member-avatar">⚙️</div>
                <div className="member-info">
                  <div className="member-email">{s.name}</div>
                  <div className="member-meta">
                    <span className="member-role role-{s.strategy_type}">{s.strategy_type}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.updated_at?.substring(0, 10)}</span>
                  </div>
                </div>
                <div className="member-actions">
                  <button className="btn-secondary btn-sm" onClick={() => { setEditingStrategy(s); setStrategyName(s.name); setStrategyType(s.strategy_type); setStrategyConfig(s.config); setStrategyDialog(true); }}>编辑</button>
                  <button className="btn-text" style={{ color: "var(--red)" }} onClick={() => handleDeleteStrategy(s.strategy_id)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section section-card">
        <div className="section-heading">
          <h2>组合模板</h2>
          <button className="btn-primary btn-sm" onClick={() => { setEditingTemplate(null); setTemplateName(""); setTemplateModels("[]"); setTemplateRoutingMode("fallback"); setTemplateDialog(true); }}>新增模板</button>
        </div>
        {templates.length === 0 ? (
          <div className="empty-hint">暂无模板</div>
        ) : (
          <div className="member-list">
            {templates.map((t) => (
              <div key={t.template_id} className="member-card">
                <div className="member-avatar">📋</div>
                <div className="member-info">
                  <div className="member-email">{t.name}</div>
                  <div className="member-meta">
                    <span className="member-role role-{t.routing_mode}">{t.routing_mode}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.updated_at?.substring(0, 10)}</span>
                  </div>
                </div>
                <div className="member-actions">
                  <button className="btn-secondary btn-sm" onClick={() => { setEditingTemplate(t); setTemplateName(t.name); setTemplateModels(t.models); setTemplateRoutingMode(t.routing_mode); setTemplateDialog(true); }}>编辑</button>
                  <button className="btn-text" style={{ color: "var(--red)" }} onClick={() => handleDeleteTemplate(t.template_id)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const renderBilling = () => (
    <>
      {billingSummary && (
        <div className="section section-card">
          <div className="section-heading"><h2>账单概览</h2></div>
          <div className="hero-metrics" style={{ marginTop: 12 }}>
            <div className="hero-metric-card">
              <span className="hero-metric-label">总订单数</span>
              <strong className="hero-metric-value">{billingSummary.order_count || 0}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">已支付</span>
              <strong className="hero-metric-value">{billingSummary.paid_orders || 0}</strong>
            </div>
            <div className="hero-metric-card">
              <span className="hero-metric-label">总收入</span>
              <strong className="hero-metric-value">${(billingSummary.gross_revenue || 0).toFixed(2)}</strong>
            </div>
          </div>
        </div>
      )}

      <div className="section section-card">
        <div className="section-heading"><h2>发票记录</h2></div>
        {invoices.length === 0 ? (
          <div className="empty-hint">暂无发票</div>
        ) : (
          <div className="member-list">
            {invoices.map((inv) => (
              <div key={inv.invoice_id} className="member-card">
                <div className="member-avatar">📄</div>
                <div className="member-info">
                  <div className="member-email">{inv.period_start?.substring(0, 10)} ~ {inv.period_end?.substring(0, 10)}</div>
                  <div className="member-meta">
                    <span>{inv.currency} ${inv.amount.toFixed(2)}</span>
                    <span className={inv.status === "paid" ? "badge-active" : "badge-inactive"}>{inv.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section section-card">
        <div className="section-heading"><h2>超用记录</h2></div>
        {overages.length === 0 ? (
          <div className="empty-hint">暂无超用</div>
        ) : (
          <div className="member-list">
            {overages.map((o) => (
              <div key={o.overage_id} className="member-card">
                <div className="member-avatar">⚠️</div>
                <div className="member-info">
                  <div className="member-email">{o.billing_period}</div>
                  <div className="member-meta">
                    <span>{o.overage_requests.toLocaleString()} 请求</span>
                    <span>${o.overage_cost.toFixed(2)}</span>
                    <span className={o.billed ? "badge-active" : "badge-inactive"}>{o.billed ? "已结算" : "未结算"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const renderWebhook = () => (
    <div className="section section-card">
      <div className="section-heading">
        <h2>Webhooks</h2>
        <button className="btn-primary btn-sm" onClick={() => { setEditingWebhook(null); setWebhookName(""); setWebhookUrl(""); setWebhookEvents("[]"); setWebhookSecret(""); setWebhookEnabled(true); setWebhookDialog(true); }}>新增 Webhook</button>
      </div>
      {webhooks.length === 0 ? (
        <div className="empty-hint">暂无 Webhook</div>
      ) : (
        <div className="member-list">
          {webhooks.map((w) => (
            <div key={w.webhook_id} className="member-card">
              <div className="member-avatar">🔗</div>
              <div className="member-info">
                <div className="member-email">{w.name}</div>
                <div className="member-meta">
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{w.url.substring(0, 40)}</span>
                  <span className={w.enabled ? "badge-active" : "badge-inactive"}>{w.enabled ? "启用" : "禁用"}</span>
                </div>
              </div>
              <div className="member-actions">
                <button className="btn-secondary btn-sm" onClick={() => { setEditingWebhook(w); setWebhookName(w.name); setWebhookUrl(w.url); setWebhookEvents(w.events); setWebhookSecret(w.secret); setWebhookEnabled(w.enabled); setWebhookDialog(true); }}>编辑</button>
                <button className="btn-text" style={{ color: "var(--red)" }} onClick={() => handleDeleteWebhook(w.webhook_id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* ======== DIALOGS ======== */
  const renderDialogs = () => (
    <>
      {/* Profile Edit */}
      {editingProfile && (
        <div className="dialog-overlay" onClick={() => setEditingProfile(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>编辑团队信息</h3>
              <button className="btn-text" onClick={() => setEditingProfile(false)}>✕</button>
            </div>
            <div className="dialog-body">
              <label className="form-label">团队名称</label>
              <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>结算邮箱</label>
              <input type="email" value={profileBillingEmail} onChange={(e) => setProfileBillingEmail(e.target.value)} className="form-input" />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingProfile(false)}>取消</button>
              <button className="btn-primary" onClick={handleUpdateProfile}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Dialog */}
      {inviteDialog && (
        <div className="dialog-overlay" onClick={() => setInviteDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>邀请成员</h3>
              <button className="btn-text" onClick={() => setInviteDialog(false)}>✕</button>
            </div>
            <div className="dialog-body">
              <label className="form-label">邮箱地址（每行一个）</label>
              <textarea value={inviteEmails} onChange={(e) => setInviteEmails(e.target.value)} className="form-input" rows={4} placeholder="user1@example.com&#10;user2@example.com" />
              <label className="form-label" style={{ marginTop: 12 }}>角色</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="form-input">
                <option value="admin">管理员</option>
                <option value="member">成员</option>
              </select>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setInviteDialog(false)}>取消</button>
              <button className="btn-primary" onClick={handleMemberInvite}>邀请</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Link Dialog */}
      {inviteLinkDialog && (
        <div className="dialog-overlay" onClick={() => setInviteLinkDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>创建邀请链接</h3>
              <button className="btn-text" onClick={() => setInviteLinkDialog(false)}>✕</button>
            </div>
            <div className="dialog-body">
              <label className="form-label">角色</label>
              <select value={inviteLinkRole} onChange={(e) => setInviteLinkRole(e.target.value)} className="form-input">
                <option value="admin">管理员</option>
                <option value="member">成员</option>
              </select>
              <label className="form-label" style={{ marginTop: 12 }}>过期时间</label>
              <select value={inviteLinkExpiresIn} onChange={(e) => setInviteLinkExpiresIn(Number(e.target.value))} className="form-input">
                <option value={3600}>1 小时</option>
                <option value={86400}>24 小时</option>
                <option value={604800}>7 天</option>
                <option value={2592000}>30 天</option>
                <option value={0}>永不过期</option>
              </select>
              <label className="form-label" style={{ marginTop: 12 }}>最大使用次数</label>
              <input type="number" value={inviteLinkMaxUses ?? ""} onChange={(e) => setInviteLinkMaxUses(e.target.value ? Number(e.target.value) : null)} className="form-input" placeholder="留空表示不限" />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setInviteLinkDialog(false)}>取消</button>
              <button className="btn-primary" onClick={handleCreateInviteLink}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Dialog */}
      {strategyDialog && (
        <div className="dialog-overlay" onClick={resetStrategyDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>{editingStrategy ? "编辑策略" : "新增策略"}</h3>
              <button className="btn-text" onClick={resetStrategyDialog}>✕</button>
            </div>
            <div className="dialog-body">
              <label className="form-label">名称</label>
              <input type="text" value={strategyName} onChange={(e) => setStrategyName(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>类型</label>
              <select value={strategyType} onChange={(e) => setStrategyType(e.target.value)} className="form-input">
                <option value="fallback">Fallback</option>
                <option value="round_robin">Round Robin</option>
                <option value="priority">Priority</option>
                <option value="latency">Latency-based</option>
              </select>
              <label className="form-label" style={{ marginTop: 12 }}>配置 (JSON)</label>
              <textarea value={strategyConfig} onChange={(e) => setStrategyConfig(e.target.value)} className="form-input" rows={4} />
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={resetStrategyDialog}>取消</button>
              <button className="btn-primary" onClick={handleSaveStrategy}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Template Dialog */}
      {templateDialog && (
        <div className="dialog-overlay" onClick={resetTemplateDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>{editingTemplate ? "编辑模板" : "新增模板"}</h3>
              <button className="btn-text" onClick={resetTemplateDialog}>✕</button>
            </div>
            <div className="dialog-body">
              <label className="form-label">名称</label>
              <input type="text" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>模型列表 (JSON)</label>
              <textarea value={templateModels} onChange={(e) => setTemplateModels(e.target.value)} className="form-input" rows={3} placeholder='["gpt-4","claude-3"]' />
              <label className="form-label" style={{ marginTop: 12 }}>路由方式</label>
              <select value={templateRoutingMode} onChange={(e) => setTemplateRoutingMode(e.target.value)} className="form-input">
                <option value="fallback">Fallback</option>
                <option value="round_robin">Round Robin</option>
              </select>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={resetTemplateDialog}>取消</button>
              <button className="btn-primary" onClick={handleSaveTemplate}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Webhook Dialog */}
      {webhookDialog && (
        <div className="dialog-overlay" onClick={resetWebhookDialog}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>{editingWebhook ? "编辑 Webhook" : "新增 Webhook"}</h3>
              <button className="btn-text" onClick={resetWebhookDialog}>✕</button>
            </div>
            <div className="dialog-body">
              <label className="form-label">名称</label>
              <input type="text" value={webhookName} onChange={(e) => setWebhookName(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>URL</label>
              <input type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>事件 (JSON)</label>
              <input type="text" value={webhookEvents} onChange={(e) => setWebhookEvents(e.target.value)} className="form-input" placeholder='["member.invited","strategy.updated"]' />
              <label className="form-label" style={{ marginTop: 12 }}>Secret</label>
              <input type="text" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} className="form-input" />
              <label className="form-label" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={webhookEnabled} onChange={(e) => setWebhookEnabled(e.target.checked)} /> 启用
              </label>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={resetWebhookDialog}>取消</button>
              <button className="btn-primary" onClick={handleSaveWebhook}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Seats Dialog */}
      {editingSeats && (
        <div className="dialog-overlay" onClick={() => setEditingSeats(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>调整席位</h3>
              <button className="btn-text" onClick={() => setEditingSeats(false)}>✕</button>
            </div>
            <div className="dialog-body">
              <label className="form-label">席位数</label>
              <div className="seat-selector">
                <button className="seat-btn" onClick={() => setNewSeatCount(Math.max(1, newSeatCount - 1))} disabled={newSeatCount <= 1}>−</button>
                <span className="seat-count">{newSeatCount} 席位</span>
                <button className="seat-btn" onClick={() => setNewSeatCount(Math.min(1000, newSeatCount + 1))} disabled={newSeatCount >= 1000}>+</button>
              </div>
            </div>
            <div className="dialog-footer">
              <button className="btn-secondary" onClick={() => setEditingSeats(false)}>取消</button>
              <button className="btn-primary" onClick={() => { store.updateSeats(newSeatCount); setEditingSeats(false); }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  /* ======== MAIN RENDER ======== */
  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "overview", label: "概览", icon: "📊" },
    { id: "members", label: "成员", icon: "👥" },
    { id: "usage", label: "用量", icon: "📈" },
    { id: "strategy", label: "策略", icon: "🔀" },
    { id: "billing", label: "账单", icon: "💰" },
  ];

  return (
    <div className="page team-page">
      <div className="page-header">
        <h1>{profile.name || "团队工作区"}</h1>
        <p className="hint">管理团队设置、成员、策略与用量</p>
      </div>

      <div className="tab-bar">
        {tabs.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && renderOverview()}
      {activeTab === "members" && renderMembers()}
      {activeTab === "usage" && renderUsage()}
      {activeTab === "strategy" && renderStrategy()}
      {activeTab === "billing" && renderBilling()}
      {activeTab === "webhook" && renderWebhook()}

      {renderDialogs()}
    </div>
  );
}