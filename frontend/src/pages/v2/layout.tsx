import { NavLink, Outlet } from "react-router";
import { cn } from "@/lib/utils";
import { Activity, LayoutDashboard, Mail, Settings as SettingsIcon, Users } from "lucide-react";

const v2NavItems = [
  { to: "/v2", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/v2/emails", end: false, label: "Emails", icon: Mail },
  { to: "/v2/senders", end: false, label: "Senders", icon: Users },
  { to: "/v2/pipeline", end: false, label: "Pipeline", icon: Activity },
  { to: "/v2/settings", end: false, label: "Settings", icon: SettingsIcon },
];

export default function V2Layout() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold">V2 Pipeline</h1>
          <span className="text-xs text-muted-foreground">
            multi-stage bucket classifier
          </span>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {v2NavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
                    isActive
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
