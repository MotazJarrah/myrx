import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { AlertCircle, Loader2 } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(identifier, password);
      setLocation("/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      // strip "401: " prefix from apiRequest errors
      setError(msg.replace(/^\d+:\s*/, "").replace(/^{"message":"/, "").replace(/"}$/, "") || "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to pick up your training.">
      <form onSubmit={onSubmit} className="space-y-4" data-testid="form-login">
        <div className="space-y-1.5">
          <Label htmlFor="identifier">Username or email</Label>
          <Input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
            data-testid="input-identifier"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            data-testid="input-password"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" className="w-full gap-2" disabled={loading} data-testid="button-submit">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </Button>

        <p className="pt-2 text-center text-sm text-muted-foreground">
          New to Apex?{" "}
          <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline" data-testid="link-signup">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
