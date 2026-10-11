export function Skeleton({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={`skeleton ${className}`}>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Several text-line skeletons; last line is shorter. Announces once, not per line. */
export function SkeletonLines({ lines = 3, className = "", label = "Loading" }: { lines?: number; className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={`space-y-2 ${className}`}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} aria-hidden className={`skeleton h-3.5 ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
