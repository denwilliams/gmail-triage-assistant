import { useEffect, useState } from "react";
import type { UserSettings } from "@/lib/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [userKey, setUserKey] = useState("");
  const [appToken, setAppToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getSettings()
      .then((data) => {
        setSettings(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await api.updatePushover(userKey, appToken);
      setMessage("Pushover settings saved successfully.");
      setUserKey("");
      setAppToken("");
      const updated = await api.getSettings();
      setSettings(updated);
    } catch (err) {
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setMessage("");
    try {
      await api.updatePushover("", "");
      setMessage("Pushover settings cleared.");
      const updated = await api.getSettings();
      setSettings(updated);
    } catch (err) {
      setMessage("Failed to clear settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Pushover Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure Pushover to receive push notifications for important
            emails. The AI will decide when to send notifications based on your
            email processing prompts.
          </p>

          {settings?.pushover_configured && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              Pushover is configured (key: {settings.pushover_user_key}). Enter
              new credentials below to update, or clear to disable.
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Pushover User Key</label>
            <Input
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              placeholder="Your Pushover user key"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Pushover Application Token
            </label>
            <Input
              value={appToken}
              onChange={(e) => setAppToken(e.target.value)}
              placeholder="Your Pushover app token"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={saving || !userKey || !appToken}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            {settings?.pushover_configured && (
              <Button variant="outline" onClick={handleClear} disabled={saving}>
                Clear
              </Button>
            )}
          </div>

          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
