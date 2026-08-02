import { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';
import { runDiagnostics } from '../utils/commands';

interface PortCheck {
  port: number;
  occupied: boolean;
  available: boolean;
}

interface ProviderHealth {
  provider_id: string;
  success_rate: number;
  avg_latency_ms: number;
  is_circuit_open: boolean;
  total_requests: number;
}

interface SystemProxy {
  active: boolean;
  residual: boolean;
  mitm_running: boolean;
}

interface TLSFingerprint {
  current_profile: string;
  available_profiles: string[];
  circuit_breaker_state: string;
}

interface CircuitBreaker {
  provider_id: string;
  state: string;
  cooldown_until: string;
  last_error_at: string;
}

interface DiagnosticsResult {
  port_check: PortCheck[];
  provider_health: ProviderHealth[];
  mitm_ca_trust: boolean;
  system_proxy: SystemProxy;
  egress_ip: string;
  tls_fingerprint: TLSFingerprint;
  circuit_breakers: CircuitBreaker[];
  timestamp: string;
}

export function DiagnosticsPage() {
  const { t } = useTranslation();
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runDiag = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await runDiagnostics();
      setResult(res as DiagnosticsResult);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiag();
  }, []);

  const renderBadge = (ok: boolean, okText: string, failText: string) => (
    <span className={ok ? 'badge-green' : 'badge-red'}>
      {ok ? okText : failText}
    </span>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('diagnostics.title')}</h1>
        <p className="page-subtitle">{t('diagnostics.subtitle')}</p>
        <button className="btn btn-primary" onClick={runDiag} disabled={loading}>
          {loading ? t('diagnostics.running') : t('diagnostics.runButton')}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {result && (
        <div className="diagnostics-results">
          {/* 端口检测 */}
          <section className="diag-section">
            <h2>{t('diagnostics.portCheck')}</h2>
            <div className="diag-grid">
              {result.port_check?.map((pc) => (
                <div key={pc.port} className="diag-card">
                  <span className="diag-label">:{pc.port}</span>
                  {renderBadge(pc.available, t('diagnostics.available'), t('diagnostics.occupied'))}
                </div>
              ))}
            </div>
          </section>

          {/* Provider 连通性 */}
          <section className="diag-section">
            <h2>{t('diagnostics.providerHealth')}</h2>
            {result.provider_health?.length > 0 ? (
              <table className="diag-table">
                <thead>
                  <tr>
                    <th>{t('diagnostics.provider')}</th>
                    <th>{t('diagnostics.successRate')}</th>
                    <th>{t('diagnostics.avgLatency')}</th>
                    <th>{t('diagnostics.totalRequests')}</th>
                    <th>{t('diagnostics.circuitOpen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.provider_health.map((ph) => (
                    <tr key={ph.provider_id}>
                      <td>{ph.provider_id}</td>
                      <td>{(ph.success_rate * 100).toFixed(1)}%</td>
                      <td>{ph.avg_latency_ms}ms</td>
                      <td>{ph.total_requests}</td>
                      <td>{renderBadge(!ph.is_circuit_open, t('diagnostics.closed'), t('diagnostics.open'))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="diag-empty">{t('diagnostics.noData')}</p>
            )}
          </section>

          {/* MITM CA 信任 */}
          <section className="diag-section">
            <h2>{t('diagnostics.mimtCaTrust')}</h2>
            <div className="diag-card">
              <span className="diag-label">{t('diagnostics.caInstalled')}</span>
              {renderBadge(result.mitm_ca_trust, t('diagnostics.trusted'), t('diagnostics.notTrusted'))}
            </div>
          </section>

          {/* 系统代理状态 */}
          <section className="diag-section">
            <h2>{t('diagnostics.systemProxy')}</h2>
            <div className="diag-grid">
              <div className="diag-card">
                <span className="diag-label">{t('diagnostics.proxyActive')}</span>
                {renderBadge(result.system_proxy?.active, t('diagnostics.active'), t('diagnostics.inactive'))}
              </div>
              <div className="diag-card">
                <span className="diag-label">{t('diagnostics.residualProxy')}</span>
                {renderBadge(!result.system_proxy?.residual, t('diagnostics.none'), t('diagnostics.detected'))}
              </div>
              <div className="diag-card">
                <span className="diag-label">{t('diagnostics.mitmRunning')}</span>
                {renderBadge(result.system_proxy?.mitm_running, t('diagnostics.running'), t('diagnostics.stopped'))}
              </div>
            </div>
          </section>

          {/* 出口 IP */}
          <section className="diag-section">
            <h2>{t('diagnostics.egressIp')}</h2>
            <div className="diag-card">
              <span className="diag-label">{t('diagnostics.currentIp')}</span>
              <span className="diag-value">{result.egress_ip || t('diagnostics.unknown')}</span>
            </div>
          </section>

          {/* TLS 指纹 */}
          <section className="diag-section">
            <h2>{t('diagnostics.tlsFingerprint')}</h2>
            <div className="diag-grid">
              <div className="diag-card">
                <span className="diag-label">{t('diagnostics.currentProfile')}</span>
                <span className="diag-value">{result.tls_fingerprint?.current_profile}</span>
              </div>
              <div className="diag-card">
                <span className="diag-label">{t('diagnostics.profiles')}</span>
                <span className="diag-value">{result.tls_fingerprint?.available_profiles?.join(', ')}</span>
              </div>
              <div className="diag-card">
                <span className="diag-label">{t('diagnostics.breakerState')}</span>
                <span className="badge-blue">{result.tls_fingerprint?.circuit_breaker_state}</span>
              </div>
            </div>
          </section>

          {/* 熔断器状态 */}
          <section className="diag-section">
            <h2>{t('diagnostics.circuitBreakers')}</h2>
            {result.circuit_breakers?.length > 0 ? (
              <table className="diag-table">
                <thead>
                  <tr>
                    <th>{t('diagnostics.provider')}</th>
                    <th>{t('diagnostics.state')}</th>
                    <th>{t('diagnostics.cooldownUntil')}</th>
                    <th>{t('diagnostics.lastError')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.circuit_breakers.map((cb) => (
                    <tr key={cb.provider_id}>
                      <td>{cb.provider_id}</td>
                      <td><span className="badge-red">{cb.state}</span></td>
                      <td>{cb.cooldown_until || '-'}</td>
                      <td>{cb.last_error_at || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="diag-card">
                {renderBadge(true, t('diagnostics.allClosed'), '')}
              </div>
            )}
          </section>

          {/* 诊断时间戳 */}
          <div className="diag-timestamp">
            {t('diagnostics.generatedAt')}: {result.timestamp}
          </div>
        </div>
      )}
    </div>
  );
}
