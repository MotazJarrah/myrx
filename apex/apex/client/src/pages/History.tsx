import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  estimateOneRepMax,
  formatTime,
  convertWeight,
  type Unit,
} from "@/lib/calculators";
import { Trash2, TrendingUp, Dumbbell, Activity, PersonStanding } from "lucide-react";
import type { Workout } from "@shared/schema";

const CATEGORY_ICON = {
  strength: Dumbbell,
  cardio: Activity,
  bodyweight: PersonStanding,
} as const;

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatMetric(w: Workout): string {
  if (w.category === "strength") {
    return `${w.metricValue}${w.unit} × ${w.secondaryValue ?? 1}`;
  }
  if (w.category === "cardio") {
    const d = w.metricValue >= 1000 ? `${(w.metricValue / 1000).toFixed(2)} km` : `${w.metricValue} m`;
    return `${d} in ${formatTime(w.secondaryValue ?? 0)}`;
  }
  return `${w.metricValue} reps`;
}

export default function History() {
  const [filter, setFilter] = useState<string>("all");
  const [chartExercise, setChartExercise] = useState<string>("");

  const { data: workouts, isLoading } = useQuery<Workout[]>({
    queryKey: ["/api/workouts"],
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/workouts/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/workouts"] }),
  });

  const filtered = useMemo(() => {
    if (!workouts) return [];
    if (filter === "all") return workouts;
    return workouts.filter((w) => w.category === filter);
  }, [workouts, filter]);

  const exercises = useMemo(() => {
    const set = new Set<string>();
    (workouts ?? []).forEach((w) => set.add(w.exercise));
    return Array.from(set);
  }, [workouts]);

  // Default chartExercise
  const effectiveChartExercise = chartExercise || exercises[0] || "";

  const chartData = useMemo(() => {
    if (!workouts || !effectiveChartExercise) return [];
    const series = workouts
      .filter((w) => w.exercise === effectiveChartExercise)
      .sort((a, b) => a.performedAt - b.performedAt)
      .map((w) => {
        let value = 0;
        let label = "";
        if (w.category === "strength") {
          const weightInLbs = w.unit === "lbs" ? w.metricValue : convertWeight(w.metricValue, w.unit as Unit, "lbs");
          value = estimateOneRepMax(weightInLbs, w.secondaryValue ?? 1);
          label = "Est. 1RM (lb)";
        } else if (w.category === "cardio") {
          // Show pace per km in seconds — lower is better
          value = (w.secondaryValue ?? 0) / (w.metricValue / 1000);
          label = "Pace (s/km)";
        } else {
          value = w.metricValue;
          label = "Reps";
        }
        return { date: formatDate(w.performedAt), value: Math.round(value * 10) / 10, label };
      });
    return series;
  }, [workouts, effectiveChartExercise]);

  const chartLabel = chartData[0]?.label ?? "";

  // summary stats
  const stats = useMemo(() => {
    if (!workouts) return null;
    const total = workouts.length;
    const byCat: Record<string, number> = { strength: 0, cardio: 0, bodyweight: 0 };
    workouts.forEach((w) => (byCat[w.category] = (byCat[w.category] ?? 0) + 1));
    return { total, byCat };
  }, [workouts]);

  return (
    <AppShell title="History" subtitle="Every effort you've logged. Progress visualized.">
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading your history...</div>
      ) : !workouts || workouts.length === 0 ? (
        <Card className="animate-rise">
          <CardContent className="py-16 text-center">
            <TrendingUp className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No efforts logged yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Log a set or an effort from any calculator page to start building your history.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Card className="animate-rise">
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Total efforts</p>
                <p className="mt-1 font-mono text-3xl font-semibold tabular-nums" data-testid="text-total-count">{stats?.total}</p>
              </CardContent>
            </Card>
            {(["strength", "cardio", "bodyweight"] as const).map((cat) => {
              const Icon = CATEGORY_ICON[cat];
              return (
                <Card key={cat} className="animate-rise">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3 w-3 text-primary" />
                      <p className="text-xs uppercase tracking-wider text-muted-foreground capitalize">{cat}</p>
                    </div>
                    <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{stats?.byCat[cat] ?? 0}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Chart */}
          <Card className="animate-rise" style={{ animationDelay: "60ms" }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">Progress chart</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">{chartLabel}</p>
              </div>
              {exercises.length > 0 && (
                <Select value={effectiveChartExercise} onValueChange={setChartExercise}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {exercises.map((e) => (
                      <SelectItem key={e} value={e}>{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardHeader>
            <CardContent>
              {chartData.length > 1 ? (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        domain={["auto", "auto"]}
                      />
                      <ReTooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--primary))", r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Log at least two sessions of the same exercise to see a trend.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Filter + List */}
          <Card className="animate-rise" style={{ animationDelay: "120ms" }}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">All efforts</CardTitle>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  <SelectItem value="strength">Strength</SelectItem>
                  <SelectItem value="cardio">Cardio</SelectItem>
                  <SelectItem value="bodyweight">Bodyweight</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border" data-testid="list-workouts">
                {filtered.map((w) => {
                  const Icon = CATEGORY_ICON[w.category as keyof typeof CATEGORY_ICON] ?? Dumbbell;
                  return (
                    <div
                      key={w.id}
                      className="flex items-center gap-4 py-3"
                      data-testid={`row-workout-${w.id}`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{w.exercise}</span>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {w.category}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-sm tabular-nums text-muted-foreground">
                          {formatMetric(w)}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">{formatDate(w.performedAt)}</div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => del.mutate(w.id)}
                        aria-label="Delete"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        data-testid={`button-delete-${w.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              {filtered.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No efforts in this category.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
