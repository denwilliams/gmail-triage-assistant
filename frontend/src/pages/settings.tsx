import { useEffect, useRef, useState } from "react";
import type { ImportResult, UserSettings } from "@/lib/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [userKey, setUserKey] = useState("");
  const [appToken, setAppToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookHeaderKey, setWebhookHeaderKey] = useState("");
  const [webhookHeaderValue, setWebhookHeaderValue] = useState("");
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookMessage, setWebhookMessage] = useState("");

  // Export/Import state
  const [includeEmails, setIncludeEmails] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportImportMessage, setExportImportMessage] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleWebhookSave = async () => {
    setWebhookSaving(true);
    setWebhookMessage("");
    try {
      await api.updateWebhook(webhookUrl, webhookHeaderKey, webhookHeaderValue);
      setWebhookMessage("Webhook settings saved successfully.");
      setWebhookUrl("");
      setWebhookHeaderKey("");
      setWebhookHeaderValue("");
      const updated = await api.getSettings();
      setSettings(updated);
    } catch (err) {
      setWebhookMessage("Failed to save webhook settings.");
    } finally {
      setWebhookSaving(false);
    }
  };

  const handleWebhookClear = async () => {
    setWebhookSaving(true);
    setWebhookMessage("");
    try {
      await api.updateWebhook("", "", "");
      setWebhookMessage("Webhook settings cleared.");
      const updated = await api.getSettings();
      setSettings(updated);
    } catch (err) {
      setWebhookMessage("Failed to clear webhook settings.");
    } finally {
      setWebhookSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportImportMessage("");
    setImportResult(null);
    try {
      await api.exportData(includeEmails);
      setExportImportMessage("Export downloaded successfully.");
    } catch (err) {
      setExportImportMessage(
        "Failed to export: " + (err instanceof Error ? err.message : "Unknown error")
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setExportImportMessage("");
    setImportResult(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api.importData(data);
      setImportResult(result);
      setExportImportMessage("Import completed successfully.");
    } catch (err) {
      setExportImportMessage(
        "Failed to import: " + (err instanceof Error ? err.message : "Invalid file")
      );
    } finally {
      setImporting(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
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

      <Card>
        <CardHeader>
          <CardTitle>Webhook Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure a webhook URL to receive JSON notifications for important
            emails. Optionally include a custom header for authentication.
          </p>

          {settings?.webhook_configured && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              Webhook is configured ({settings.webhook_url}).
              {settings.webhook_header_key && (
                <> Header: {settings.webhook_header_key} = {settings.webhook_header_value}</>
              )}
              {" "}Enter new settings below to update, or clear to disable.
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Webhook URL</label>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://example.com/webhook"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Header Key <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={webhookHeaderKey}
              onChange={(e) => setWebhookHeaderKey(e.target.value)}
              placeholder="e.g. Authorization, X-Api-Key"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Header Value <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={webhookHeaderValue}
              onChange={(e) => setWebhookHeaderValue(e.target.value)}
              placeholder="e.g. Bearer your-token"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleWebhookSave}
              disabled={webhookSaving || !webhookUrl}
            >
              {webhookSaving ? "Saving..." : "Save"}
            </Button>
            {settings?.webhook_configured && (
              <Button variant="outline" onClick={handleWebhookClear} disabled={webhookSaving}>
                Clear
              </Button>
            )}
          </div>

          {webhookMessage && (
            <p className="text-sm text-muted-foreground">{webhookMessage}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Export & Import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Export all your data (labels, prompts, memories, sender profiles,
            reports) as a JSON file. Use import to restore data on another server
            or account.
          </p>

          <div className="space-y-3">
            <label className="text-sm font-medium">Export</label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeEmails}
                  onChange={(e) => setIncludeEmails(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Include processed emails
              </label>
            </div>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting..." : "Export Data"}
            </Button>
          </div>

          <Separator />

          <div className="space-y-3">
            <label className="text-sm font-medium">Import</label>
            <p className="text-sm text-muted-foreground">
              Select a previously exported JSON file. Existing data will be
              updated where conflicts arise; no data will be deleted.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? "Importing..." : "Choose File & Import"}
            </Button>
          </div>

          {exportImportMessage && (
            <p className="text-sm text-muted-foreground">
              {exportImportMessage}
            </p>
          )}

          {importResult && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              <p className="font-medium">Import Summary</p>
              <ul className="mt-1 space-y-0.5">
                <li>Labels: {importResult.labels}</li>
                <li>System Prompts: {importResult.system_prompts}</li>
                <li>AI Prompts: {importResult.ai_prompts}</li>
                <li>Memories: {importResult.memories}</li>
                <li>Sender Profiles: {importResult.sender_profiles}</li>
                <li>Wrapup Reports: {importResult.wrapup_reports}</li>
                <li>Notifications: {importResult.notifications}</li>
                {importResult.emails > 0 && (
                  <li>Emails: {importResult.emails}</li>
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
