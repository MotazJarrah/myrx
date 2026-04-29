import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { estimateCalories, MET_VALUES } from "@/lib/calculators";
import { Flame } from "lucide-react";

export default function Calories() {
  const [activity, setActivity] = useState(Object.keys(MET_VALUES)[5]);
  const [weight, setWeight] = useState("170");
  const [unit, setUnit] = useState<"lbs" | "kg">("lbs");
  const [minutes, setMinutes] = useState("45");

  const w = parseFloat(weight);
  const m = parseFloat(minutes);
  const weightKg = unit === "kg" ? w : w * 0.45359237;
  const met = MET_VALUES[activity] ?? 0;
  const kcal = useMemo(
    () => (Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(m) && m > 0 ? estimateCalories(met, weightKg, m) : 0),
    [met, weightKg, m],
  );

  const perMinute = m > 0 ? kcal / m : 0;

  return (
    <AppShell title="Calories" subtitle="MET-based calorie estimates across any activity.">
      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        <Card className="animate-rise">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-primary" />
              Inputs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>Activity</Label>
              <Select value={activity} onValueChange={setActivity}>
                <SelectTrigger data-testid="select-activity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MET_VALUES).map(([name, metVal]) => (
                    <SelectItem key={name} value={name}>
                      <span className="capitalize">{name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">· MET {metVal}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weight">Your weight</Label>
              <div className="flex gap-2">
                <Input
                  id="weight"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="font-mono tabular-nums"
                  data-testid="input-weight"
                />
                <Tabs value={unit} onValueChange={(v) => setUnit(v as "lbs" | "kg")}>
                  <TabsList className="h-10 grid grid-cols-2">
                    <TabsTrigger value="lbs" className="text-xs">lbs</TabsTrigger>
                    <TabsTrigger value="kg" className="text-xs">kg</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="min">Duration (minutes)</Label>
              <Input
                id="min"
                type="number"
                inputMode="decimal"
                min="0"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="font-mono tabular-nums"
                data-testid="input-minutes"
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="animate-rise overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card" style={{ animationDelay: "60ms" }}>
            <CardContent className="grid gap-4 p-6 md:grid-cols-3 md:p-8">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Total burn</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-mono text-5xl font-semibold tabular-nums" data-testid="text-kcal">
                    {Math.round(kcal) || "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">kcal</span>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Per minute</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-mono text-3xl font-semibold tabular-nums">
                    {perMinute > 0 ? perMinute.toFixed(1) : "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">kcal/min</span>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Intensity (MET)</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-mono text-3xl font-semibold tabular-nums">{met}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {met < 3 ? "Light" : met < 6 ? "Moderate" : met < 9 ? "Vigorous" : "Very vigorous"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: "120ms" }}>
            <CardHeader>
              <CardTitle className="text-base">Duration projections</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5">
                {[15, 30, 45, 60, 90].map((mins) => {
                  const c = estimateCalories(met, weightKg, mins);
                  return (
                    <div key={mins} className="rounded-lg border border-border bg-card/60 p-4">
                      <p className="text-xs text-muted-foreground">{mins} min</p>
                      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{Math.round(c) || "—"}</p>
                      <p className="text-[11px] text-muted-foreground">kcal</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground">
                Based on the Compendium of Physical Activities. Estimates assume steady-state effort at the given MET level.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
