import { RotateCw, WifiOff, AlertTriangle } from "lucide-react";
import type { ConnectionInfo } from "./connection";

/** Shown only for offline / degraded. Stacked under the top bar (App reserves its height). */
export function ConnectionBanner({ info }: { info: ConnectionInfo }) {
  if (info.state !== "offline" && info.state !== "degraded") return null;
  const offline = info.state === "offline";
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <div
      role={offline ? "alert" : "status"}
      data-testid="connection-banner"
      className={`flex h-[var(--banner-h)] items-center gap-3 border-b px-4 text-sm backdrop-blur-md ${
        offline ? "border-danger/35 bg-danger/10 text-fg" : "border-ev-hypothesis/35 bg-ev-hypothesis/10 text-fg"
      }`}
    >
      <Icon aria-hidden className={`h-4 w-4 shrink-0 ${offline ? "text-danger" : "text-ev-hypothesis"}`} />
      <p className="min-w-0 flex-1 truncate" title={info.detail}>
        <strong className="font-semibold">{offline ? "API unreachable." : "API degraded."}</strong> <span className="text-fg-2 max-md:hidden">{info.detail}</span>
      </p>
      <button type="button" onClick={info.retry} className="btn-quiet inline-flex min-h-8 items-center gap-1.5 rounded-control px-2.5 text-xs font-medium">
        <RotateCw aria-hidden className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}
