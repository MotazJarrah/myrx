import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  buildRepMaxTable,
  estimateOneRepMax,
  convertWeight,
  type Unit,
} from "@/lib/calculators";
import { Dumbbell, Save, Info, Flame } from "lucide-react";
import type { Workout } from "@shared/schema";

const LIFT_PRESETS = [
  "Bench Press",
  "Back Squat",
  "Deadlift",
  "Overhead Press",
  "Front Squat",
  "Romanian Deadlift",
  "Barbell Row",
  "Incline Bench",
  "Power Clean",
  "Hip Thrust",
];

export default function Strength() {
  const { toast } = useToast();
  const [exercise, setExercise] = useState("Bench Press");
  const [weight, setWeight] = useState("225");
  const [reps, setReps] = useState("5");
  const [unit, setUnit] = useState<Unit>("lbs");

  const w = parseFloat(weight);
  const r = parseInt(reps, 10);
  const valid = Number.isFinite(w) && w > 0 && Number.isFinite(r) && r > 0 && r <= 20;

  const oneRm = useMemo(() => (valid ? estimateOneRepMax(w, r) : 0), [w, r, valid]);
  const table = useMemo(() => (valid ? buildRepMaxTable(w, r, 10) : []), [w, r, valid]);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/workouts", {
        category: "strength",
        exercise,
        metricValue: w,
        secondaryValue: r,
        unit,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      toast({ title: "Saved", description: `${exercise}: ${w}${unit} × ${r}` });
    },
    onError: (err) => {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Previous bests for this exercise
  const { data: history } = useQuery<Workout[]>({
    queryKey: ["/api/workouts"],
  });
  const previousBest = useMemo(() => {
    if (!history) return null;
    const matches = history.filter((h) => h.category === "strength" && h.exercise === exercise);
    if (matches.length === 0) return null;
    let best: { orm: number; weight: number; reps: number; unit: string } | null = null;
    for (const m of matches) {
      const mWeight = m.unit === unit ? m.metricValue : convertWeight(m.metricValue, m.unit as Unit, unit);
      const orm = estimateOneRepMax(mWeight, m.secondaryValue ?? 1);
      if (!best || orm > best.orm) best = { orm, weight: mWeight, reps: m.secondaryValue ?? 1, unit };
    }
    return best;
  }, [history, exercise, unit]);

  const formatNum = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

  return (
    <AppShell title="Strength" subtitle="Enter any set to project 1RM through 10RM.">
      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        {/* ─ INPUT PANE ─ */}
        <Card className="animate-rise">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Dumbbell className="h-4 w-4 text-primary" />
              Enter a set
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>Exercise</Label>
              <Select value={exercise} onValueChange={setExercise}>
                <SelectTrigger data-testid="select-exercise">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIFT_PRESETS.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="weight">Weight</Label>
                <div className="relative">
                  <Input
                    id="weight"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="pr-12 font-mono tabular-nums"
                    data-testid="input-weight"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    {unit}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reps">Reps</Label>
                <Input
                  id="reps"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="20"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  className="font-mono tabular-nums"
                  data-testid="input-reps"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Units</Label>
              <Tabs value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="lbs" data-testid="tab-lbs">Pounds</TabsTrigger>
                  <TabsTrigger value="kg" data-testid="tab-kg">Kilograms</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <Button
              onClick={() => save.mutate()}
              disabled={!valid || save.isPending}
              className="w-full gap-2"
              data-testid="button-save"
            >
              <Save className="h-4 w-4" />
              {save.isPending ? "Saving..." : "Log this set"}
            </Button>

            {!valid && r > 15 && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>RM estimates are most accurate for sets of 1–10 reps. Over 15 reps, they become unreliable.</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─ OUTPUT PANE ─ */}
        <div className="space-y-6">
          {/* Hero 1RM card */}
          <Card className="animate-rise overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card" style={{ animationDelay: "60ms" }}>
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Projected 1-Rep Max
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono text-5xl font-semibold tabular-nums text-foreground md:text-6xl" data-testid="text-1rm">
                      {valid ? formatNum(oneRm) : "—"}
                    </span>
                    <span className="text-base text-muted-foreground">{unit}</span>
                  </div>
                </div>
                {previousBest && (
                  <div className="rounded-lg border border-border bg-card/80 px-4 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Previous best</p>
                    <p className="font-mono tabular-nums text-sm">
                      {formatNum(previousBest.orm)} {unit}
                      {oneRm > previousBest.orm && valid && (
                        <span className="ml-2 text-primary">
                          +{formatNum(oneRm - previousBest.orm)}
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Averaged across Epley, Brzycki, and Lombardi formulas for robustness.
              </p>
            </CardContent>
          </Card>

          {/* RM Table */}
          <Card className="animate-rise" style={{ animationDelay: "120ms" }}>
            <CardHeader>
              <CardTitle className="text-base">Rep-max projection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-2 md:grid-cols-10" data-testid="grid-repmax">
                {(valid ? table : []).map((row) => {
                  const isInput = row.reps === r;
                  const isOne = row.reps === 1;
                  return (
                    <div
                      key={row.reps}
                      className={`group relative rounded-lg border p-3 transition-all ${
                        isOne
                          ? "border-primary/40 bg-primary/10"
                          : isInput
                          ? "border-primary/30 bg-primary/5"
                          : "border-border bg-card/40"
                      }`}
                      data-testid={`cell-rm-${row.reps}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {row.reps}RM
                        </span>
                        {isInput && <Flame className="h-3 w-3 text-primary" />}
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                        {formatNum(row.weight)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {row.percentOfMax.toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
                {!valid &&
                  Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-dashed border-border/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{i + 1}RM</div>
                      <div className="mt-1 font-mono text-lg text-muted-foreground">—</div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Training zone card */}
          <Card className="animate-rise" style={{ animationDelay: "180ms" }}>
            <CardHeader>
              <CardTitle className="text-base">Training zones</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Max strength", pct: "95–100%", reps: "1–2", color: "primary" },
                  { label: "Strength", pct: "85–92%", reps: "3–5", color: "chart-2" },
                  { label: "Hypertrophy", pct: "75–85%", reps: "6–12", color: "chart-4" },
                  { label: "Endurance", pct: "60–75%", reps: "12+", color: "chart-3" },
                ].map((z) => {
                  const maxRange = z.label === "Max strength" ? [0.95, 1] : z.label === "Strength" ? [0.85, 0.92] : z.label === "Hypertrophy" ? [0.75, 0.85] : [0.6, 0.75];
                  const lo = valid ? oneRm * maxRange[0] : 0;
                  const hi = valid ? oneRm * maxRange[1] : 0;
                  return (
                    <div key={z.label} className="rounded-lg border border-border bg-card/60 p-4">
                      <div className="text-xs font-medium">{z.label}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {z.pct} · {z.reps} reps
                      </div>
                      <div className="mt-2 font-mono text-sm tabular-nums">
                        {valid ? `${formatNum(lo)}–${formatNum(hi)}` : "—"}{" "}
                        <span className="text-xs text-muted-foreground">{unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
