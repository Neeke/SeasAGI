import { useState, useRef, useEffect } from "react";
import { useTranslation } from "../i18n";
import { chatCompletion, chatCompletionForChannel, listChannels, getLocalAccessToken, listModelCombos } from "../utils/commands";
import type { Channel, ModelCombo } from "../utils/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
  latency?: number;
  channel?: string;
  curlCommand?: string;
  comboSteps?: { step: number; role: string; model: string; status: "ok" | "fallback" | "error"; latency_ms?: number }[];
}

export function PlaygroundPage() {
  const { t } = useTranslation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [selectedChannel, setSelectedChannel] = useState("auto");
  const [selectedCombo, setSelectedCombo] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [combos, setCombos] = useState<ModelCombo[]>([]);
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [showCurl, setShowCurl] = useState<string | null>(null);
  const [showComboTrace, setShowComboTrace] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    (async () => {
      try {
        const token = await getLocalAccessToken();
        setGatewayRunning(!!token);
      } catch {}
    })();
    (async () => {
      try {
        const channelList = await listChannels();
        setChannels(channelList);
        const modelSet = new Set<string>();
        for (const ch of channelList) {
          if (ch.enabled && ch.models) {
            for (const m of ch.models) {
              modelSet.add(m);
            }
          }
        }
        const sorted = Array.from(modelSet).sort();
        setModels(sorted);
      } catch {}
    })();
    (async () => {
      try {
        const comboList = await listModelCombos();
        setCombos(comboList);
      } catch {}
    })();
  }, []);

  const availableModels = selectedChannel === "auto"
    ? models
    : (() => {
        const ch = channels.find(c => c.channel_id === selectedChannel);
        return ch?.models?.sort() || [];
      })();

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const payload = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const useCombo = selectedCombo !== "" ? combos.find(c => c.name === selectedCombo) : null;
      const model = useCombo ? (useCombo.steps?.[0]?.model || "gpt-4o") : (selectedModel === "auto" ? "gpt-4o" : selectedModel);
      const useChannel = selectedChannel !== "auto" ? selectedChannel : null;
      const result = useCombo
        ? await chatCompletion(payload, useCombo.name)
        : useChannel
          ? await chatCompletionForChannel(useChannel, payload, model)
          : await chatCompletion(payload, model);

      const curlCommand = result._curl_command as string | undefined;
      const channelLabel = useChannel
        ? channels.find(c => c.channel_id === useChannel)?.display_name || useChannel
        : "";
      const gatewayStatus = result._gateway_status || result._status_code;
      const isError = gatewayStatus >= 400;
      const steps = result._combo_steps
        ? (result._combo_steps as any[]).map((s: any, idx: number) => ({
            step: idx + 1,
            role: s.step_role || s.role || "",
            model: s.model || "",
            status: (s.status === "success" ? "ok" : s.status === "fallback" ? "fallback" : "error") as "ok" | "fallback" | "error",
            latency_ms: s.latency_ms,
          }))
        : undefined;

      if (isError) {
        const errMsg = result.error?.message || `HTTP ${gatewayStatus}`;
        setMessages([...newMessages, {
          role: "assistant",
          content: `Error: ${errMsg}`,
          curlCommand,
          comboSteps: steps,
        }]);
      } else {
        const content = result.choices?.[0]?.message?.content ?? JSON.stringify(result, null, 2);
        const latency = undefined;

        setMessages([...newMessages, {
          role: "assistant",
          content,
          model: result.model || model,
          latency,
          channel: channelLabel || undefined,
          curlCommand,
          comboSteps: steps,
        }]);
      }
    } catch (err: any) {
      setMessages([...newMessages, {
        role: "assistant",
        content: `Error: ${err.message}`,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    inputRef.current?.focus();
  };

  return (
    <div className="page playground-page">
      <div className="page-header-row">
        <div>
          <h1>{t("nav.playground")}</h1>
          <p className="page-subtitle">
            {t("playground.description")}
          </p>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric-card">
            <span className="hero-metric-label">{t("playground.currentModel")}</span>
            <strong className="hero-metric-value">{selectedModel === "auto" ? t("playground.auto") : selectedModel}</strong>
          </div>
          <div className="hero-metric-card">
            <span className="hero-metric-label">{t("playground.messageCount")}</span>
            <strong className="hero-metric-value">{messages.length}</strong>
          </div>
        </div>
      </div>

      {!gatewayRunning && (
        <div className="alert alert-warning playground-warning">
          {t("playground.gatewayNotRunning")}
        </div>
      )}

      <div className="playground-toolbar section-card">
        <div className="playground-toolbar-copy">
          <h2>{t("playground.testConfigTitle")}</h2>
          <p className="hint">{t("playground.testConfigHint")}</p>
        </div>
        <div className="playground-toolbar-actions">
          <select
            value={selectedCombo}
            onChange={(e) => {
              setSelectedCombo(e.target.value);
              if (e.target.value) {
                setSelectedChannel("auto");
                setSelectedModel("auto");
              }
            }}
            className="select-input"
            style={{ minWidth: 180 }}
          >
            <option value="">{t("playground.noCombo")}</option>
            {combos.map((c) => (
              <option key={c.name} value={c.name}>
                {t("playground.comboWithSteps", { name: c.name, count: c.steps?.length || 0 })}
              </option>
            ))}
          </select>
          <select
            value={selectedChannel}
            onChange={(e) => {
              setSelectedChannel(e.target.value);
              setSelectedModel("auto");
              setSelectedCombo("");
            }}
            className="select-input"
            style={{ minWidth: 180 }}
            disabled={!!selectedCombo}
          >
            <option value="auto">{t("playground.autoGatewayRouting")}</option>
            {channels.filter(c => c.enabled).map((ch) => (
              <option key={ch.channel_id} value={ch.channel_id}>
                {ch.display_name || ch.channel_id}
              </option>
            ))}
          </select>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="select-input"
            disabled={!!selectedCombo}
          >
            <option value="auto">{t("playground.autoDefaultModel")}</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <button className="btn-outline" onClick={handleClear}>
              {t("playground.clear")}
            </button>
          )}
        </div>
      </div>

      <div className="playground-chat-container section-card">
        <div className="playground-messages">
          {messages.length === 0 ? (
            <div className="empty-state playground-empty-state">
              <p className="playground-empty-title">
                {t("playground.emptyTitle")}
              </p>
              <p className="text-dim">
                {t("playground.emptyHint", { model: selectedModel === "auto" ? t("playground.defaultModel") : selectedModel })}
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`playground-message ${msg.role === "user" ? "message-user" : "message-assistant"}`}
                >
                  <div className={`message-bubble ${msg.role === "user" ? "bubble-user" : "bubble-assistant"}`}>
                    <div className="message-content">{msg.content}</div>
                    {msg.role === "assistant" && (msg.model || msg.latency || msg.channel || msg.curlCommand || msg.comboSteps) && (
                      <div className="message-meta">
                        {msg.channel && <span className="meta-item">{msg.channel}</span>}
                        {msg.model && <span className="meta-item">{msg.model}</span>}
                        {msg.latency != null && <span className="meta-item">{msg.latency} ms</span>}
                        {msg.comboSteps && (
                          <button
                            className="btn-link btn-curl-toggle"
                            onClick={() => setShowComboTrace(showComboTrace === `${i}` ? null : `${i}`)}
                          >
                            {showComboTrace === `${i}` ? t("playground.hideComboTrace") : t("playground.showComboTrace")}
                          </button>
                        )}
                        {msg.curlCommand && (
                          <button
                            className="btn-link btn-curl-toggle"
                            onClick={() => setShowCurl(showCurl === `${i}` ? null : `${i}`)}
                          >
                            {showCurl === `${i}` ? t("playground.hideCurl") : t("playground.showCurl")}
                          </button>
                        )}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.comboSteps && showComboTrace === `${i}` && (
                      <div className="combo-trace-block">
                        <div className="combo-trace-title">{t("playground.comboTraceTitle")}</div>
                        {msg.comboSteps.map((step, si) => (
                          <div key={si} className={`combo-trace-step combo-trace-${step.status}`}>
                            <span className="combo-trace-step-num">#{step.step}</span>
                            <span className="combo-trace-step-role">{step.role}</span>
                            <span className="combo-trace-step-model">{step.model}</span>
                            <span className="combo-trace-step-status">
                              {step.status === "ok" ? t("playground.traceOk") : step.status === "fallback" ? t("playground.traceFallback") : t("playground.traceFail")}
                            </span>
                            {step.latency_ms != null && <span className="combo-trace-step-latency">{step.latency_ms}ms</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.curlCommand && showCurl === `${i}` && (
                      <pre className="curl-command-block"><code>{msg.curlCommand}</code></pre>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="playground-message message-assistant">
                  <div className="message-bubble bubble-assistant">
                    <div className="loading-dots">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="playground-input-bar">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("playground.inputPlaceholder") || "Type a message… (Enter to send, Shift+Enter for newline)"}
            rows={1}
            className="playground-textarea"
            disabled={loading}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
          />
          <button
            className="btn-primary"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            {loading ? (t("playground.sending") || "Sending…") : (t("playground.send") || "Send")}
          </button>
        </div>
      </div>
    </div>
  );
}
