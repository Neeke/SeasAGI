import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider } from "./i18n/I18nProvider";
import { HomePage } from "./pages/HomePage";
import { ChannelPage } from "./pages/ChannelPage";
import { LogPage } from "./pages/LogPage";
import { SettingsPage } from "./pages/SettingsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { UsagePage } from "./pages/UsagePage";
import { OptimizationWorkbenchPage } from "./pages/OptimizationWorkbenchPage";
import { AccessTokenPage } from "./pages/AccessTokenPage";
import { SubscriptionPage } from "./pages/SubscriptionPage";
import { TeamWorkspacePage } from "./pages/TeamWorkspacePage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { Layout } from "./components/Layout";

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/auth" element={<RegisterPage />} />
            <Route path="/channels" element={<ChannelPage />} />
            <Route path="/logs" element={<LogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/combo-workbench" element={<OptimizationWorkbenchPage />} />
            <Route path="/combo" element={<Navigate to="/combo-workbench?tab=combos" replace />} />
            <Route path="/optimization" element={<Navigate to="/combo-workbench?tab=optimization" replace />} />
            <Route path="/access-token" element={<AccessTokenPage />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
            <Route path="/team" element={<TeamWorkspacePage />} />
            <Route path="/enterprise" element={<Navigate to="/" replace />} />
            <Route path="/playground" element={<PlaygroundPage />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </I18nProvider>
  );
}
