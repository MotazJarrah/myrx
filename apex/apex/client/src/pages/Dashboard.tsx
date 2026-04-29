import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { estimateOneRepMax, formatTime, convertWeight, type Unit } from "@/lib/calculators";
import {
  Dumbbell,
  Activity,
  PersonStanding,
  Flame,
  TrendingUp,
  ArrowRight,
  Clock,
} from "lucide-react";
import type { Workout } from "@shared/schema";

const QUICK_ACTIONS = [
  { href: "/strength", title: "Strength", desc: "Project 1RM–10RM", icon: Dumbbell },
  { href: "/cardio", title: "Cardio", desc: "Pace + distance projections", icon: Activity },
  { href: "/bodyweight", title: "Bodyweight", desc: "Rep-capacity projections", icon: PersonStanding },
  { href: "/calories", title: "Calories", desc: "MET-based burn estimates", icon: Flame },
];

function formatDate(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: workouts } = useQuery<Workout[]>({ queryKey: ["/api/workouts"] });

  // Personal bests per exercise
  const bests = useMemo(() => {
    if (!workouts) return [];
    const byExercise = new Map<string, Workout[]>();
    for (const w of workouts) {
      const arr = byExercise.get(w.exercise) ?? [];
      arr.push(w);
      byExercise.set(w.exercise, arr);
    }
    const rows: { exercise: string; category: string; summary: string; detail: string }[] = [];
    byExercise.forEach((ws, exercise) => {
      const cat = ws[0].category;
      if (cat === "strength") {
        let bestOrm = 0;
        let bestW: Workout | null = null;
        for (const w of ws) {
          const lbs = w.unit === "lbs" ? w.metricValue : convertWeight(w.metricValue, w.unit as Unit, "lbs");
          const orm = estimateOneRepMax(lbs, w.secondaryValue ?? 1);
          if (orm > bestOrm) {
            bestOrm = orm;
            bestW = w;
          }
        }
        if (bestW) {
          rows.push({
            exercise,
            category: cat,
            summary: `${bestOrm.toFixed(0)} ${bestW.unit} 1RM`,
            detail: `${bestW.metricValue}${bestW.unit} × ${bestW.secondaryValue} · ${formatDate(bestW.performedAt)}`,
          });
        }
      } else if (cat === "cardio") {
        // best pace per exercise
        let bestPace = Infinity;
        let bestW: Workout | null = null;
        for (const w of ws) {
          const p = (w.secondaryValue ?? 0) / w.metricValue;
          if (p > 0 && p < bestPace) {
            bestPace = p;
            bestW = w;
          }
        }
        if (bestW) {
          const d = bestW.metricValue >= 1000 ? `${(bestW.metricValue / 1000).toFixed(1)} km` : `${bestW.metricValue}m`;
          rows.push({
            exercise,
            category: cat,
            summary: `${d} in ${formatTime(bestW.secondaryValue ?? 0)}`,
            detail: formatDate(bestW.performedAt),
          });
        }
      } else {
        let bestReps = 0;
        let bestW: Workout | null = null;
        for (const w of ws) {
          if (w.metricValue > bestReps) {
            bestReps = w.metricValue;
            bestW = w;
          }
        }
        if (bestW) {
          rows.push({
            exercise,
            category: cat,
            summary: `${bestReps} reps`,
            detail: formatDate(bestW.performedAt),
          });
        }
      }
    });
    return rows.sort((a, b) => a.exercise.localeCompare(b.exercise));
  }, [workouts]);

  const recent = workouts?.slice(0, 5) ?? [];

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Training late";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  return (
    <AppShell title={`${greeting}, ${user?.username ?? "athlete"}`} subtitle="Your training at a glance.">
      <div className="space-y-6">
        {/* Quick actions */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((a, i) => (
            <Link
              key={a.href}
              href={a.href}
              className="animate-rise group rounded-xl border border-border bg-card p-5 transition-colors hover-elevate"
              style={{ animationDelay: `${i * 40}ms` }}
              data-testid={`card-quick-${a.title.toLowerCase()}`}
            >
              <div className="flex items-center justify-between">
                <a.icon className="h-5 w-5 text-primary" />
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">{a.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
            </Link>
          ))}
        </div>

        {/* Personal bests + recent */}
        <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
          <Card className="animate-rise" style={{ animationDelay: "200ms" }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-primary" />
                Personal bests
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bests.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No PRs yet. Log your first effort to get started.
                  </p>
                  <Link href="/strength">
                    <button className="mt-3 text-sm font-medium text-primary hover:underline">
                      Log a lift →
                    </button>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {bests.map((b) => (
                    <div key={b.exercise} className="flex items-center justify-between py-3" data-testid={`row-best-${b.exercise}`}>
                      <div>
                        <p className="text-sm font-medium">{b.exercise}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{b.detail}</p>
                      </div>
                      <p className="font-mono text-sm font-semibold tabular-nums">{b.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: "260ms" }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" />
                Recent activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing logged yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {recent.map((w) => {
                    const Icon =
                      w.category === "strength" ? Dumbbell : w.category === "cardio" ? Activity : PersonStanding;
                    let metric = "";
                    if (w.category === "strength") metric = `${w.metricValue}${w.unit}×${w.secondaryValue}`;
                    else if (w.category === "cardio")
                      metric = `${w.metricValue >= 1000 ? (w.metricValue / 1000).toFixed(1) + "km" : w.metricValue + "m"} · ${formatTime(w.secondaryValue ?? 0)}`;
                    else metric = `${w.metricValue} reps`;
                    return (
                      <div key={w.id} className="flex items-center gap-3 text-sm">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{w.exercise}</p>
                          <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">{metric}</p>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{formatDate(w.performedAt)}</span>
                      </div>
                    );
                  })}
                  <Link href="/history">
                    <button className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-border py-2 text-xs font-medium text-muted-foreground hover-elevate">
                      View all <ArrowRight className="h-3 w-3" />
                    </button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
