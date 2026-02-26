import { useEffect, useState } from "react";
import type { Notification } from "@/lib/types";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getNotifications()
      .then((data) => setNotifications(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Notifications</h1>
      {notifications.length === 0 ? (
        <p className="text-muted-foreground">No notifications sent yet.</p>
      ) : (
        notifications.map((n) => (
          <Card key={n.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{n.subject}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {new Date(n.sent_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                From: {n.from_address}
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                {n.message}
              </pre>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
