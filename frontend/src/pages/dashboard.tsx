import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import type {
  DashboardSummary,
  DashboardTimeseries,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
];

function formatPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function formatDate(d: string | number): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tooltipLabelFormatter = (label: any) => formatDate(String(label));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bypassTooltipFormatter = (value: any) => [formatPct(Number(value)), "Bypass Rate"];

// --- Stat Cards ---

function StatCards({ summary }: { summary: DashboardSummary }) {
  const cards = [
    { label: "Total Emails", value: summary.total_emails.toLocaleString() },
    { label: "Today", value: summary.emails_today.toLocaleString() },
    { label: "This Week", value: summary.emails_this_week.toLocaleString() },
    { label: "Bypass Rate", value: formatPct(summary.bypass_rate) },
    { label: "Notification Rate", value: formatPct(summary.notification_rate) },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader className="pb-2">
            <CardDescription>{c.label}</CardDescription>
            <CardTitle className="text-2xl">{c.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

// --- Volume Chart ---

function VolumeChart({ data }: { data: DashboardTimeseries }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Volume</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.daily_volume}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={formatDate} fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip labelFormatter={tooltipLabelFormatter} />
            <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Emails" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Bypass Rate Chart ---

function BypassRateChart({ data }: { data: DashboardTimeseries }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Bypass Rate</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.daily_bypass_rate}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={formatDate} fontSize={12} />
            <YAxis tickFormatter={(v: number) => formatPct(v)} fontSize={12} domain={[0, 1]} />
            <Tooltip
              labelFormatter={tooltipLabelFormatter}
              formatter={bypassTooltipFormatter}
            />
            <Line
              type="monotone"
              dataKey="rate"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="Bypass Rate"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Label Pie Chart ---

function LabelPieChart({ summary }: { summary: DashboardSummary }) {
  if (summary.label_distribution.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Label Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={summary.label_distribution}
              dataKey="count"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={100}
              paddingAngle={2}
            >
              {summary.label_distribution.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Label Trends Chart ---

function LabelTrendsChart({ data }: { data: DashboardTimeseries }) {
  // Pivot label_trends into { date, label1: count, label2: count, ... }
  const { pivoted, labels } = useMemo(() => {
    const labelSet = new Set<string>();
    const byDate = new Map<string, Record<string, number>>();

    for (const item of data.label_trends) {
      labelSet.add(item.label);
      if (!byDate.has(item.date)) byDate.set(item.date, {});
      byDate.get(item.date)![item.label] = item.count;
    }

    const labels = [...labelSet];
    const pivoted = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    return { pivoted, labels };
  }, [data.label_trends]);

  if (labels.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Label Trends</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={pivoted}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={formatDate} fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip labelFormatter={tooltipLabelFormatter} />
            <Legend />
            {labels.map((label, i) => (
              <Area
                key={label}
                type="monotone"
                dataKey={label}
                stackId="1"
                fill={COLORS[i % COLORS.length]}
                stroke={COLORS[i % COLORS.length]}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Top Senders / Domains Table ---

function TopSendersTable({ summary }: { summary: DashboardSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Senders</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="senders">
          <TabsList>
            <TabsTrigger value="senders">By Address</TabsTrigger>
            <TabsTrigger value="domains">By Domain</TabsTrigger>
          </TabsList>
          <TabsContent value="senders">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Archive %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.top_senders.map((s) => (
                  <TableRow key={s.address}>
                    <TableCell className="max-w-[200px] truncate font-mono text-xs">
                      {s.address}
                    </TableCell>
                    <TableCell className="text-right">{s.count}</TableCell>
                    <TableCell className="text-right">
                      {formatPct(s.archive_rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="domains">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Archive %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.top_domains.map((d) => (
                  <TableRow key={d.domain}>
                    <TableCell className="font-mono text-xs">{d.domain}</TableCell>
                    <TableCell className="text-right">{d.count}</TableCell>
                    <TableCell className="text-right">
                      {formatPct(d.archive_rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// --- Top Slugs Chart ---

function TopSlugsChart({ summary }: { summary: DashboardSummary }) {
  if (summary.top_slugs.length === 0) return null;

  // Show top 10 for readability
  const data = summary.top_slugs.slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Slugs</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(260, data.length * 32)}>
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis type="number" fontSize={12} />
            <YAxis
              type="category"
              dataKey="slug"
              width={160}
              fontSize={11}
              tickFormatter={(v: string) =>
                v.length > 22 ? v.slice(0, 22) + "..." : v
              }
            />
            <Tooltip />
            <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} name="Count" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Keyword Cloud ---

function KeywordCloud({ summary }: { summary: DashboardSummary }) {
  if (summary.top_keywords.length === 0) return null;

  const maxCount = Math.max(...summary.top_keywords.map((k) => k.count));
  const minSize = 0.75;
  const maxSize = 2;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Keywords</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {summary.top_keywords.map((kw) => {
            const size =
              minSize + ((kw.count / maxCount) * (maxSize - minSize));
            return (
              <span
                key={kw.keyword}
                className="inline-block text-muted-foreground transition-colors hover:text-foreground"
                style={{ fontSize: `${size}rem` }}
                title={`${kw.keyword}: ${kw.count}`}
              >
                {kw.keyword}
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Notification Chart ---

function NotificationChart({ data }: { data: DashboardTimeseries }) {
  if (data.daily_notifications.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Notifications</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.daily_notifications}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={formatDate} fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip labelFormatter={tooltipLabelFormatter} />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              name="Notifications"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Slug Novelty ---

function SlugNovelty({ summary }: { summary: DashboardSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Slug Novelty (This Week)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-8">
          <div>
            <p className="text-2xl font-bold">{summary.new_slugs_this_week}</p>
            <p className="text-sm text-muted-foreground">New slugs</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{summary.recurring_slugs_this_week}</p>
            <p className="text-sm text-muted-foreground">Recurring slugs</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Heatmap Grid ---

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function HeatmapGrid({ data }: { data: DashboardTimeseries }) {
  if (data.hourly_heatmap.length === 0) return null;

  const grid = useMemo(() => {
    // Build 7x24 grid
    const matrix: number[][] = Array.from({ length: 7 }, () =>
      Array(24).fill(0)
    );
    let max = 0;
    for (const item of data.hourly_heatmap) {
      matrix[item.day_of_week][item.hour] = item.count;
      if (item.count > max) max = item.count;
    }
    return { matrix, max };
  }, [data.hourly_heatmap]);

  function cellColor(count: number): string {
    if (count === 0) return "var(--color-muted)";
    const intensity = count / grid.max;
    if (intensity < 0.25) return "#c7d2fe";
    if (intensity < 0.5) return "#818cf8";
    if (intensity < 0.75) return "#6366f1";
    return "#4338ca";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Heatmap</CardTitle>
        <CardDescription>Emails by day of week and hour (all time)</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `auto repeat(24, 1fr)` }}>
          {/* Header row: hours */}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[10px] text-muted-foreground">
              {h}
            </div>
          ))}

          {/* Data rows */}
          {grid.matrix.map((row, dow) => (
            <>
              <div key={`label-${dow}`} className="pr-2 text-right text-xs text-muted-foreground leading-6">
                {DAY_LABELS[dow]}
              </div>
              {row.map((count, hour) => (
                <div
                  key={`${dow}-${hour}`}
                  className="h-6 min-w-6 rounded-sm"
                  style={{ backgroundColor: cellColor(count) }}
                  title={`${DAY_LABELS[dow]} ${hour}:00 — ${count} emails`}
                />
              ))}
            </>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main Dashboard Page ---

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [timeseries, setTimeseries] = useState<DashboardTimeseries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getStatsSummary(), api.getStatsTimeseries(30)])
      .then(([s, t]) => {
        setSummary(s);
        setTimeseries(t);
      })
      .catch((err) => {
        console.error("Failed to load dashboard stats:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-destructive">Failed to load dashboard: {error}</p>
      </div>
    );
  }

  if (!summary || !timeseries) return null;

  if (summary.total_emails === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
        <Card>
          <CardHeader>
            <CardTitle>No data yet</CardTitle>
            <CardDescription>
              Once the assistant starts processing emails, your analytics will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <StatCards summary={summary} />

      <div className="grid gap-6 lg:grid-cols-2">
        <VolumeChart data={timeseries} />
        <BypassRateChart data={timeseries} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <LabelPieChart summary={summary} />
        <LabelTrendsChart data={timeseries} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TopSendersTable summary={summary} />
        <TopSlugsChart summary={summary} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <KeywordCloud summary={summary} />
        <div className="grid gap-6">
          <NotificationChart data={timeseries} />
          <SlugNovelty summary={summary} />
        </div>
      </div>

      <HeatmapGrid data={timeseries} />
    </div>
  );
}
