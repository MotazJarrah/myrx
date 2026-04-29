import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2, CheckCircle2 } from "lucide-react";

function checkStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

export default function SignUp() {
  const { register } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = checkStrength(password);
  const strengthLabel = ["Too short", "Weak", "Fair", "Strong", "Excellent"][strength];
  const strengthColor = [
    "bg-muted",
    "bg-destructive/70",
    "bg-[hsl(var(--chart-4))]",
    "bg-primary/70",
    "bg-primary",
  ][strength];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await register(username, email, password);
      setLocation("/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign up failed";
      setError(msg.replace(/^\d+:\s*/, "").replace(/^{"message":"/, "").replace(/"}$/, "") || "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Build your training log. Takes less than a minute.">
      <form onSubmit={onSubmit} className="space-y-4" data-testid="form-signup">
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_]+"
            title="Letters, numbers, and underscores only"
            data-testid="input-username"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            data-testid="input-email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            data-testid="input-password"
          />
          <div className="flex items-center gap-2 pt-1">
            <div className="flex h-1 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`h-full flex-1 rounded-full transition-colors ${
                    i <= strength ? strengthColor : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <span className={`w-16 text-right text-xs ${strength >= 3 ? "text-primary" : "text-muted-foreground"}`}>
              {password.length === 0 ? " " : strengthLabel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            At least 8 characters. Mix cases, numbers, and symbols for a stronger password.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" className="w-full gap-2" disabled={loading} data-testid="button-submit">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Create account
        </Button>

        <p className="pt-2 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline" data-testid="link-login">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
