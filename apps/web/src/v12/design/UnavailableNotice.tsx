import type { ReactNode } from "react";
import { EvidenceBadge } from "./EvidenceBadge";

/** Honest empty/unavailable state. Names the missing capability; never fakes a result. */
export function UnavailableNotice({
  title,
  detail,
  endpoint,
  action,
}: {
  title: string;
  detail: string;
  endpoint?: string;
  action?: ReactNode;
}) {
  return (
    <div role="status" className="hairline rounded-panel border bg-ink-800/50 p-4 text-sm text-fg-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <EvidenceBadge kind="INCONCLUSIVE" />
        <strong className="font-semibold text-fg">{title}</strong>
      </div>
      <p className="leading-relaxed">{detail}</p>
      {endpoint && (
        <p className="mt-2 text-xs text-fg-3">
          Needs backend: <code className="text-fg-2">{endpoint}</code>
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
