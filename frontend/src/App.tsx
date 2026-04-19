import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/hooks/use-auth";
import { AppLayout } from "@/components/app-layout";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import LabelsPage from "@/pages/labels";
import HistoryPage from "@/pages/history";
import PromptsPage from "@/pages/prompts";
import MemoriesPage from "@/pages/memories";
import WrapupsPage from "@/pages/wrapups";
import NotificationsPage from "@/pages/notifications";
import SendersPage from "@/pages/senders";
import SettingsPage from "@/pages/settings";
import PromptWizardPage from "@/pages/prompt-wizard";
import DigestsPage from "@/pages/digests";
import V2Layout from "@/pages/v2/layout";
import V2DashboardPage from "@/pages/v2/dashboard";
import V2EmailsPage from "@/pages/v2/emails";
import V2SendersPage from "@/pages/v2/senders";
import V2BucketDispatch from "@/pages/v2/buckets/index";
import V2PipelinePage from "@/pages/v2/pipeline";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/senders" element={<SendersPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/:emailId" element={<HistoryPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/prompt-wizard" element={<PromptWizardPage />} />
            <Route path="/memories" element={<MemoriesPage />} />
            <Route path="/wrapups" element={<WrapupsPage />} />
            <Route path="/digests" element={<DigestsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/v2" element={<V2Layout />}>
              <Route index element={<V2DashboardPage />} />
              <Route path="emails" element={<V2EmailsPage />} />
              <Route path="senders" element={<V2SendersPage />} />
              <Route path="buckets/:bucket" element={<V2BucketDispatch />} />
              <Route path="pipeline" element={<V2PipelinePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
