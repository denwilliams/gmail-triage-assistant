import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/hooks/use-theme";
import { AppLayout } from "@/components/app-layout";
import { LegacyLayout } from "@/components/legacy-layout";
import LoginPage from "@/pages/login";
import LegacyDashboardPage from "@/pages/dashboard";
import LegacyLabelsPage from "@/pages/labels";
import LegacyHistoryPage from "@/pages/history";
import LegacyPromptsPage from "@/pages/prompts";
import LegacyMemoriesPage from "@/pages/memories";
import LegacyWrapupsPage from "@/pages/wrapups";
import LegacyNotificationsPage from "@/pages/notifications";
import LegacySendersPage from "@/pages/senders";
import LegacySettingsPage from "@/pages/settings";
import LegacyPromptWizardPage from "@/pages/prompt-wizard";
import PromptsPage from "@/pages/prompts";
import DigestsPage from "@/pages/digests";
import V2DashboardPage from "@/pages/v2/dashboard";
import V2EmailsPage from "@/pages/v2/emails";
import V2SendersPage from "@/pages/v2/senders";
import V2BucketDispatch from "@/pages/v2/buckets/index";
import V2PipelinePage from "@/pages/v2/pipeline";
import V2SettingsPage from "@/pages/v2/settings";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<V2DashboardPage />} />
            <Route path="/emails" element={<V2EmailsPage />} />
            <Route path="/senders" element={<V2SendersPage />} />
            <Route path="/buckets/:bucket" element={<V2BucketDispatch />} />
            <Route path="/pipeline" element={<V2PipelinePage />} />
            <Route path="/digests" element={<DigestsPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/settings" element={<V2SettingsPage />} />
          </Route>
          <Route path="/legacy-v1" element={<LegacyLayout />}>
            <Route index element={<Navigate to="/legacy-v1/dashboard" replace />} />
            <Route path="dashboard" element={<LegacyDashboardPage />} />
            <Route path="labels" element={<LegacyLabelsPage />} />
            <Route path="senders" element={<LegacySendersPage />} />
            <Route path="history" element={<LegacyHistoryPage />} />
            <Route path="history/:emailId" element={<LegacyHistoryPage />} />
            <Route path="prompts" element={<LegacyPromptsPage />} />
            <Route path="prompt-wizard" element={<LegacyPromptWizardPage />} />
            <Route path="memories" element={<LegacyMemoriesPage />} />
            <Route path="wrapups" element={<LegacyWrapupsPage />} />
            <Route path="notifications" element={<LegacyNotificationsPage />} />
            <Route path="settings" element={<LegacySettingsPage />} />
          </Route>
          <Route element={<AppLayout />}>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
