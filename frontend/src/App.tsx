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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/memories" element={<MemoriesPage />} />
            <Route path="/wrapups" element={<WrapupsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
