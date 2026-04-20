import { Link, Outlet, useLocation, Navigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Tag,
  Users,
  FileText,
  History,
  Brain,
  BarChart2,
  Bell,
  Settings,
  Mail,
  LogOut,
  ArrowLeft,
} from "lucide-react";

const legacyNavItems = [
  { to: "/legacy-v1/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/legacy-v1/labels", label: "Labels", icon: Tag },
  { to: "/legacy-v1/senders", label: "Senders", icon: Users },
  { to: "/legacy-v1/prompts", label: "Prompts", icon: FileText },
  { to: "/legacy-v1/history", label: "History", icon: History },
  { to: "/legacy-v1/memories", label: "Memories", icon: Brain },
  { to: "/legacy-v1/wrapups", label: "Wrapups", icon: BarChart2 },
  { to: "/legacy-v1/notifications", label: "Notifications", icon: Bell },
  { to: "/legacy-v1/settings", label: "Settings", icon: Settings },
];

export function LegacyLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto flex h-14 items-center gap-6 px-4">
          <Link to="/legacy-v1/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Mail className="h-4 w-4" />
            </div>
            <span className="font-semibold text-sm hidden sm:block">
              Gmail Triage <span className="text-muted-foreground font-normal">(v1)</span>
            </span>
          </Link>

          <nav className="flex items-center gap-0.5 text-sm overflow-x-auto">
            {legacyNavItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                location.pathname === item.to ||
                location.pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent whitespace-nowrap",
                    isActive
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden lg:block">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm shrink-0">
            <Link
              to="/dashboard"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Back to current UI"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden lg:block">Current UI</span>
            </Link>
            <span className="hidden md:block text-muted-foreground max-w-[180px] truncate">
              {user.email}
            </span>
            <a
              href="/auth/logout"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:block">Logout</span>
            </a>
          </div>
        </div>
      </header>
      <div className="border-b border-amber-500/30 bg-amber-500/10">
        <div className="container mx-auto px-4 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          Legacy v1 UI — single-stage pipeline tools. The current UI is at{" "}
          <Link to="/dashboard" className="underline font-medium">
            /dashboard
          </Link>
          .
        </div>
      </div>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
