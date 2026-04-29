/**
 * APEX LOGO
 * A rising triangle bisected by a horizontal line — the form of the letter "A"
 * rendered as a peak. Works at 16px and 200px.
 */
export function Logo({ className = "", showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        aria-label="Apex"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="7" className="fill-foreground/5 dark:fill-foreground/[0.04]" />
        <path
          d="M6.5 24.5 L16 6 L25.5 24.5"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10.5 17.5 L21.5 17.5"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {showText && (
        <span className="font-sans font-semibold text-base tracking-tight">
          Apex
        </span>
      )}
    </div>
  );
}
