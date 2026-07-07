import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ComboPage } from "./ComboPage";
import { OptimizationPage } from "./OptimizationPage";
import { ExecAnalysisPage } from "./ExecAnalysisPage";
import { useAppStore } from "../stores/appStore";
import * as cmd from "../utils/commands";

type WorkbenchTab = "combos" | "optimization" | "templates" | "analysis";

const TAB_LABELS: Record<WorkbenchTab, string> = {
  combos: "我的方案",
  optimization: "优化建议",
  templates: "模板中心",
  analysis: "执行分析",
};

// 任务类型定义
type TaskType = "general_chat" | "tool_calling" | "structured_output" | "long_context" | "vision";

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  general_chat: "通用对话",
  tool_calling: "工具调用",
  structured_output: "结构化输出",
  long_context: "长上下文",
  vision: "视觉理解",
};

const TASK_TYPE_DESCS: Record<TaskType, string> = {
  general_chat: "日常对话、问答、创意写作等通用场景",
  tool_calling: "需要调用外部工具、API或函数的场景",
  structured_output: "需要JSON、XML等结构化输出的场景",
  long_context: "需要处理长文档、多轮对话等长上下文场景",
  vision: "图像识别、视觉问答等视觉理解场景",
};

export function OptimizationWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const setTaskProfiles = useAppStore((s) => s.setTaskProfiles);
  const initialTab = (searchParams.get("tab") as WorkbenchTab) || "combos";
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(
    ["combos", "optimization", "templates", "analysis"].includes(initialTab) ? initialTab : "combos"
  );
  const [activeTaskType, setActiveTaskType] = useState<TaskType>("general_chat");

  useEffect(() => {
    const tab = searchParams.get("tab") as WorkbenchTab;
    if (tab && ["combos", "optimization", "templates", "analysis"].includes(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    void cmd.getTaskProfiles().then((profiles) => setTaskProfiles(profiles || [])).catch(() => undefined);
  }, [setTaskProfiles]);

  const switchTab = (tab: WorkbenchTab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  const switchTaskType = (taskType: TaskType) => {
    setActiveTaskType(taskType);
  };

  return (
    <div className="page workbench-page">
      <div className="page-header">
        <div>
          <h1>组合优化</h1>
          <p className="page-subtitle">
            管理模型调用方案、查看优化建议与执行效果
          </p>
        </div>
      </div>

      <div className="tab-bar">
        {(["combos", "optimization", "templates", "analysis"] as WorkbenchTab[]).map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "active" : ""}
            onClick={() => switchTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* 任务类型切换标签 - 仅在优化建议页面显示 */}
      {activeTab === "optimization" && (
        <div className="task-type-toolbar">
          <div className="task-type-label">任务类型:</div>
          <div className="task-type-buttons">
            {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((taskType) => (
              <button
                key={taskType}
                className={`task-type-btn ${activeTaskType === taskType ? "active" : ""}`}
                onClick={() => switchTaskType(taskType)}
                title={TASK_TYPE_DESCS[taskType]}
              >
                {TASK_TYPE_LABELS[taskType]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tab-content">
        {activeTab === "combos" && <ComboPage embedded />}
        {activeTab === "optimization" && <OptimizationPage embedded taskType={activeTaskType} />}
        {activeTab === "templates" && <ComboPage embedded showTemplatesTab />}
        {activeTab === "analysis" && <ExecAnalysisPage />}
      </div>
    </div>
  );
}
