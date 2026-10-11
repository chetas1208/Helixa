import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { btn } from "../simulation/ui";

interface BriefingJson {
  status?: string;
  script?: string;
  message?: string;
  error?: string;
}

/**
 * "Listen" uses the EXISTING POST /api/voice/briefing, which only accepts an already-recorded evidence receipt id.
 * The caller renders this only when such an id really exists on the step; otherwise it explains why it is hidden.
 */
export function ListenButton({ receiptId }: { receiptId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "audio" | "caption" | "error">("idle");
  const [caption, setCaption] = useState("");
  const [msg, setMsg] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const go = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/voice/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt_id: receiptId }) });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({})))?.detail ?? res.statusText, "/api/voice/briefing");
      if ((res.headers.get("content-type") ?? "").includes("audio")) {
        const url = URL.createObjectURL(await res.blob());
        setCaption(res.headers.get("X-Caption-Script") ?? "");
        const a = new Audio(url);
        audio.current = a;
        a.onended = () => URL.revokeObjectURL(url);
        await a.play();
        setState("audio");
      } else {
        const j = (await res.json()) as BriefingJson;
        setCaption(j.script ?? "");
        setMsg(j.message ?? j.error ?? "");
        setState("caption");
      }
    } catch (e) {
      setMsg((e as Error).message);
      setState("error");
    }
  };
  return (
    <div className="space-y-1">
      <button type="button" className={btn} onClick={go} disabled={state === "loading"}>
        {state === "loading" ? "Preparing briefing..." : "Listen to verified briefing"}
      </button>
      {state === "caption" && (
        <div role="status" className="text-xs text-slate-200">
          <p className="text-slate-300">{msg || "Voice is not configured; showing the verified caption text."}</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-100">{caption}</p>
        </div>
      )}
      {state === "audio" && caption && <p className="whitespace-pre-wrap text-[13px] text-slate-100" role="status">Caption: {caption}</p>}
      {state === "error" && <p role="alert" className="text-xs text-red-200">{msg}</p>}
    </div>
  );
}
