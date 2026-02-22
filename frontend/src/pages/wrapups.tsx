import { useEffect, useState } from "react";
import type { WrapupReport } from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function WrapupsPage() {
  const [reports, setReports] = useState<WrapupReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getWrapups()
      .then((data) => setReports(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Wrapup Reports</h1>
      {reports.length === 0 ? (
        <p className="text-muted-foreground">No wrapup reports yet.</p>
      ) : (
        reports.map((report) => (
          <Card key={report.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  <Badge
                    variant={
                      report.report_type === "morning"
                        ? "outline"
                        : "secondary"
                    }
                  >
                    {report.report_type === "morning"
                      ? "Morning"
                      : "Evening"}
                  </Badge>
                </CardTitle>
                <span className="text-sm text-muted-foreground">
                  {new Date(report.generated_at).toLocaleString()}
                </span>
                <Badge variant="outline" className="text-xs">
                  {report.email_count} emails
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                {report.content}
              </pre>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
