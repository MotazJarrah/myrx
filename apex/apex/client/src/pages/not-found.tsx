import { Link } from "wouter";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 ambient-grid opacity-40" aria-hidden />
      <header className="relative z-10 flex h-16 items-center px-6">
        <Link href="/"><Logo /></Link>
      </header>
      <main className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col items-center justify-center px-6 pb-20 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          404 · Not found
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
          This page doesn't exist.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The page you're looking for moved, or it never existed. Let's get you back to training.
        </p>
        <Link href="/">
          <Button className="mt-6">Return home</Button>
        </Link>
      </main>
    </div>
  );
}
