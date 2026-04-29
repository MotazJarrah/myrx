import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PersonStanding, Save, Target } from "lucide-react";

const EXERCISES = [
  "Pull-ups",
  "Chin-ups",
  "Push-ups",
  "Dips",
  "Squats (bodyweight)",
  "Burpees",
  "Sit-ups",
  "Plank (seconds)",
  "Pistol Squats",
  "Muscle-ups",
];

/**
 * Bodyweight max-rep projections use the same Epley-style formula as weightlifting,
 * treating max reps as the "1RM" of bodyweight work, and projecting percentage drops
 * across set sizes typical for bodyweight training.
 */
function projectBodyweightReps(currentMax: number): { setSize: string; projected: number; note: string }[] {
  const out: { setSize: string; projected: number; note: string }[] = [];
  const configs = [
    { label: "Max set", pct: 1.0, note: "All-out effort to failure" },
    { label: "3 sets of", pct: 0.82, note: "Across 3 sets w/ 2-3 min rest" },
    { label: "5 sets of", pct: 0.72, note: "Across 5 sets w/ 90s rest" },
    { label: "Greasing the groove", pct: 0.5, note: "~50% of max, many times daily" },
    { label: "Next goal (+1)", pct: 1 + 1 / currentMax, note: "Progressive overload target" },
    { label: "Double target", pct: 2.0, note: "Long-term milestone" },
  ];
  for (const c of configs) {
    out.push({
      setSize: c.label,
      projected: Math.round(currentMax * c.pct),
      note: c.note,
    });
  }
  return out;
}

export default function Bodyweight() {
  const { toast } = useToast();
  const [exercise, setExercise] = useState("Pull-ups");
  const [reps, setReps] = useState("12");

  const r = parseInt(reps, 10);
  const valid = Number.isFinite(r) && r > 0;

  const projections = useMemo(() => (valid ? projectBodyweightReps(r) : []), [r, valid]);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/workouts", {
        category: "bodyweight",
        exercise,
        metricValue: r,
        unit: "reps",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      toast({ title: "Saved", description: `${exercise}: ${r} reps` });
    },
    onError: (err) => {
      toast({ title: "Could not save", description: err instanceof Error ? err.message : "Unknown", variant: "destructive" });
    },
  });

  return (
    <AppShell title="Bodyweight" subtitle="Log your max set. See your work-capacity projections.">
      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        <Card className="animate-rise">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PersonStanding className="h-4 w-4 text-primary" />
              Max set
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
                  {EXERCISES.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reps">Reps to failure</Label>
              <Input
                id="reps"
                type="number"
                inputMode="numeric"
                min="1"
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                className="font-mono tabular-nums"
                data-testid="input-reps"
              />
            </div>
            <Button onClick={() => save.mutate()} disabled={!valid || save.isPending} className="w-full gap-2" data-testid="button-save">
              <Save className="h-4 w-4" />
              {save.isPending ? "Saving..." : "Log this set"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="animate-rise overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card" style={{ animationDelay: "60ms" }}>
            <CardContent className="p-6 md:p-8">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Current max</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-5xl font-semibold tabular-nums md:text-6xl" data-testid="text-max">
                  {valid ? r : "—"}
                </span>
                <span className="text-base text-muted-foreground">reps</span>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: "120ms" }}>
            <CardHeader>
              <CardTitle className="text-base">Work-capacity projections</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="grid-projections">
                {projections.map((p, i) => (
                  <div key={i} className={`rounded-lg border p-4 ${p.setSize.includes("goal") ? "border-primary/40 bg-primary/5" : "border-border bg-card/60"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{p.setSize}</span>
                      {p.setSize.includes("goal") && <Target className="h-3 w-3 text-primary" />}
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-mono text-2xl font-semibold tabular-nums">{p.projected}</span>
                      <span className="text-xs text-muted-foreground">reps</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{p.note}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
