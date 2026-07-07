import { useAppStore } from "../stores/appStore";

export function ConfigSyncIndicator() {
  const syncState = useAppStore((s) => s.syncState);
  const cloudBilling = useAppStore((s) => s.cloudBilling);

  const isTeamsOrAbove = cloudBilling?.plan_id === "teams" || cloudBilling?.plan_id === "enterprise";
  if (!isTeamsOrAbove) return null;

  const statusMap = {
    idle: { label: "", color: "transparent", bg: "transparent" },
    syncing: { label: "同步中...", color: "var(--accent)", bg: "rgba(59,130,246,0.08)" },
    synced: { label: `v${syncState.config_version} 已同步`, color: "var(--green)", bg: "rgba(34,197,94,0.08)" },
    error: { label: "同步失败", color: "var(--red)", bg: "rgba(239,68,68,0.08)" },
  };

  const info = statusMap[syncState.status];
  if (!info.label) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 500,
        borderRadius: "var(--radius)",
        background: info.bg,
        color: info.color,
        flexShrink: 0,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: info.color, flexShrink: 0 }} />
      <span>{info.label}</span>
      {syncState.policy_conflicts.length > 0 && (
        <span title={syncState.policy_conflicts.map((c) => `${c.field}: ${c.local_value} → ${c.remote_value}`).join("; ")}>
          ⚠️ {syncState.policy_conflicts.length}
        </span>
      )}
      {syncState.enterprise_locked && <span title="策略已锁定">🔒</span>}
      {syncState.force_applied && <span title="已应用强制策略">📋</span>}
    </div>
  );
}