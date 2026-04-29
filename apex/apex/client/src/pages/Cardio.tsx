import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  buildCardioProjections,
  buildTargetProjection,
  parseTime,
  formatTime,
  formatPace,
  toMeters,
  type CardioMode,
  type DistanceUnit,
} from "@/lib/calculators";
import { Activity, Save, Target, Gauge } from "lucide-react";

const MODES: { value: CardioMode; label: string; paceUnit: "500m" | "km" | "mile"; defaultUnit: DistanceUnit }[] = [
  { value: "row", label: "Rowing", paceUnit: "500m", defaultUnit: "m" },
  { value: "run", label: "Running", paceUnit: "km", defaultUnit: "km" },
  { value: "cycle", label: "Cycling", paceUnit: "km", defaultUnit: "km" },
  { value: "swim", label: "Swimming", paceUnit: "500m", defaultUnit: "m" },
  { value: "walk", label: "Walking", paceUnit: "km", defaultUnit: "km" },
];

export default function Cardio() {
  const { toast } = useToast();
  const [mode, setMode] = useState<CardioMode>("row");
  const [distance, setDistance] = useState("4000");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("m");
  const [timeInput, setTimeInput] = useState("20:00");

  // Target section
  const [showTarget, setShowTarget] = useState(false);
  const [targetDistance, setTargetDistance] = useState("5000");
  const [targetDistanceUnit, setTargetDistanceUnit] = useState<DistanceUnit>("m");
  const [targetTimeInput, setTargetTimeInput] = useState("20:00");

  const modeCfg = MODES.find((m) => m.value === mode)!;

  const dMeters = useMemo(() => {
    const n = parseFloat(distance);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return toMeters(n, distanceUnit);
  }, [distance, distanceUnit]);

  const tSeconds = useMemo(() => parseTime(timeInput), [timeInput]);
  const valid = dMeters > 0 && tSeconds > 0;

  const projections = useMemo(
    () => (valid ? buildCardioProjections(dMeters, tSeconds, mode) : []),
    [dMeters, tSeconds, mode, valid],
  );

  const targetProj = useMemo(() => {
    if (!valid || !showTarget) return null;
    const td = parseFloat(targetDistance);
    if (!Number.isFinite(td) || td <= 0) return null;
    const tdm = toMeters(td, targetDistanceUnit);
    const ts = parseTime(targetTimeInput);
    return buildTargetProjection(dMeters, tSeconds, tdm, ts, mode);
  }, [valid, showTarget, dMeters, tSeconds, targetDistance, targetDistanceUnit, targetTimeInput, mode]);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/workouts", {
        category: "cardio",
        exercise: modeCfg.label,
        metricValue: dMeters,
        secondaryValue: tSeconds,
        unit: "m",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      toast({ title: "Saved", description: `${modeCfg.label}: ${distance}${distanceUnit} in ${formatTime(tSeconds)}` });
    },
    onError: (err) => {
      toast({ title: "Could not save", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    },
  });

  // Pick pace column to emphasize based on mode
  const primaryPaceKey = mode === "row" || mode === "swim" ? "paceSecPer500m" : "paceSecPerKm";
  const primaryPaceLabel = mode === "row" || mode === "swim" ? "/500m" : "/km";

  return (
    <AppShell title="Cardio" subtitle="Enter any effort. We'll project every standard distance.">
      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        {/* ─ INPUT PANE ─ */}
        <div className="space-y-6">
          <Card className="animate-rise">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" />
                Enter an effort
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label>Activity</Label>
                <Tabs value={mode} onValueChange={(v) => {
                  const m = v as CardioMode;
                  setMode(m);
                  const cfg = MODES.find((x) => x.value === m)!;
                  setDistanceUnit(cfg.defaultUnit);
                }}>
                  <TabsList className="grid w-full grid-cols-5">
                    {MODES.map((m) => (
                      <TabsTrigger key={m.value} value={m.value} data-testid={`tab-mode-${m.value}`} className="text-xs">
                        {m.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="distance">Distance completed</Label>
                <div className="flex gap-2">
                  <Input
                    id="distance"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                    className="font-mono tabular-nums"
                    data-testid="input-distance"
                  />
                  <Tabs value={distanceUnit} onValueChange={(v) => setDistanceUnit(v as DistanceUnit)}>
                    <TabsList className="h-10 grid grid-cols-3">
                      <TabsTrigger value="m" className="text-xs">m</TabsTrigger>
                      <TabsTrigger value="km" className="text-xs">km</TabsTrigger>
                      <TabsTrigger value="mi" className="text-xs">mi</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="time">Time taken</Label>
                <Input
                  id="time"
                  type="text"
                  placeholder="mm:ss or h:mm:ss"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  className="font-mono tabular-nums"
                  data-testid="input-time"
                />
                <p className="text-[11px] text-muted-foreground">
                  Formats: <span className="font-mono">20:00</span>, <span className="font-mono">1:15:30</span>, or plain seconds.
                </p>
              </div>

              <Button
                onClick={() => save.mutate()}
                disabled={!valid || save.isPending}
                className="w-full gap-2"
                data-testid="button-save"
              >
                <Save className="h-4 w-4" />
                {save.isPending ? "Saving..." : "Log this effort"}
              </Button>
            </CardContent>
          </Card>

          {/* Target Pace calculator */}
          <Card className="animate-rise" style={{ animationDelay: "60ms" }}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-primary" />
                Target pace
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="show-target" className="cursor-pointer text-sm text-muted-foreground">
                  Calculate required pace for a goal
                </Label>
                <Button
                  id="show-target"
                  size="sm"
                  variant={showTarget ? "default" : "outline"}
                  onClick={() => setShowTarget((s) => !s)}
                  data-testid="button-toggle-target"
                >
                  {showTarget ? "On" : "Off"}
                </Button>
              </div>
              {showTarget && (
                <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="tdist">Target distance</Label>
                    <div className="flex gap-2">
                      <Input
                        id="tdist"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={targetDistance}
                        onChange={(e) => setTargetDistance(e.target.value)}
                        className="font-mono tabular-nums"
                        data-testid="input-target-distance"
                      />
                      <Tabs value={targetDistanceUnit} onValueChange={(v) => setTargetDistanceUnit(v as DistanceUnit)}>
                        <TabsList className="h-10 grid grid-cols-3">
                          <TabsTrigger value="m" className="text-xs">m</TabsTrigger>
                          <TabsTrigger value="km" className="text-xs">km</TabsTrigger>
                          <TabsTrigger value="mi" className="text-xs">mi</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ttime">Target time</Label>
                    <Input
                      id="ttime"
                      type="text"
                      placeholder="mm:ss"
                      value={targetTimeInput}
                      onChange={(e) => setTargetTimeInput(e.target.value)}
                      className="font-mono tabular-nums"
                      data-testid="input-target-time"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─ OUTPUT PANE ─ */}
        <div className="space-y-6">
          {/* Hero pace card */}
          <Card className="animate-rise overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card" style={{ animationDelay: "60ms" }}>
            <CardContent className="grid gap-6 p-6 md:grid-cols-3 md:p-8">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Current pace</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-semibold tabular-nums md:text-5xl" data-testid="text-pace">
                    {valid ? formatPace((tSeconds / dMeters) * (mode === "row" || mode === "swim" ? 500 : 1000)) : "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">{mode === "row" || mode === "swim" ? "/500m" : "/km"}</span>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Speed</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-semibold tabular-nums md:text-5xl">
                    {valid ? (dMeters / 1000 / (tSeconds / 3600)).toFixed(1) : "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">km/h</span>
                </div>
                {valid && (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {(dMeters / 1609.344 / (tSeconds / 3600)).toFixed(1)} mph
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Effort</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-semibold tabular-nums md:text-5xl">
                    {valid ? formatTime(tSeconds) : "—"}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {valid ? `${(dMeters).toLocaleString()} m` : ""}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Target pane */}
          {showTarget && targetProj && (
            <Card className="animate-rise border-primary/20" style={{ animationDelay: "120ms" }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-4 w-4 text-primary" />
                  To hit your goal
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 md:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Required pace</p>
                    <p className="mt-1 font-mono text-2xl font-semibold tabular-nums" data-testid="text-required-pace">
                      {formatPace(mode === "row" || mode === "swim" ? targetProj.requiredPaceSecPer500m : targetProj.requiredPaceSecPerKm)}
                      <span className="ml-1 text-xs text-muted-foreground">{mode === "row" || mode === "swim" ? "/500m" : "/km"}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Currently projected</p>
                    <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{formatTime(targetProj.currentTimeS)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Gap</p>
                    <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${targetProj.deltaS > 0 ? "text-[hsl(var(--chart-4))]" : "text-primary"}`}>
                      {targetProj.deltaS > 0 ? "−" : "+"}
                      {formatTime(Math.abs(targetProj.deltaS))}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {targetProj.deltaS > 0
                        ? `Need ${Math.abs(targetProj.percentImprovement).toFixed(1)}% faster`
                        : "You're already there"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Distance projection table */}
          <Card className="animate-rise" style={{ animationDelay: "180ms" }}>
            <CardHeader>
              <CardTitle className="text-base">Projected times across distances</CardTitle>
            </CardHeader>
            <CardContent>
              {valid ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="pb-2 font-medium">Distance</th>
                        <th className="pb-2 font-medium">Time</th>
                        <th className="pb-2 text-right font-medium">Pace {primaryPaceLabel}</th>
                        <th className="hidden pb-2 text-right font-medium sm:table-cell">Pace /km</th>
                        <th className="hidden pb-2 text-right font-medium md:table-cell">Pace /mi</th>
                        <th className="hidden pb-2 text-right font-medium md:table-cell">Speed</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums" data-testid="table-projections">
                      {projections.map((p) => {
                        const isKnown = Math.abs(p.distanceM - dMeters) < 1;
                        return (
                          <tr
                            key={p.distanceM}
                            className={`border-b border-border/40 ${isKnown ? "bg-primary/5" : ""}`}
                            data-testid={`row-projection-${p.distanceM}`}
                          >
                            <td className="py-2.5 text-sm">
                              <span className="inline-flex items-center gap-2">
                                {p.label}
                                {isKnown && (
                                  <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">known</span>
                                )}
                              </span>
                            </td>
                            <td className="py-2.5">{formatTime(p.timeS)}</td>
                            <td className="py-2.5 text-right">
                              {formatPace(p[primaryPaceKey as keyof typeof p] as number)}
                            </td>
                            <td className="hidden py-2.5 text-right sm:table-cell">{formatPace(p.paceSecPerKm)}</td>
                            <td className="hidden py-2.5 text-right md:table-cell">{formatPace(p.paceSecPerMile)}</td>
                            <td className="hidden py-2.5 text-right md:table-cell">
                              {p.speedKmh.toFixed(1)} <span className="text-xs text-muted-foreground">km/h</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-4 text-[11px] text-muted-foreground">
                    Predictions use Riegel's endurance formula with a fatigue coefficient tuned for {modeCfg.label.toLowerCase()}. Accuracy is best within 2× of your known distance.
                  </p>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Enter a distance and time to see projections.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
