import { useEffect, useId, useState } from "react";
import { Mic, SendHorizontal } from "lucide-react";
import { EXAMPLE_PROMPTS, PARSER_LABEL } from "./promptParser";
import { VoiceCapture } from "./VoiceCapture";
import type { VoiceAdapter } from "./voiceAdapter";
import type { DraftOp } from "../types";

export interface SubmitOutcome {
  tone: "ok" | "ask" | "unsupported" | "error";
  message: string;
}

export type InlineStatus = "Interpreting" | "Validating" | "Ready to review" | "Unavailable" | null;

export interface PromptComposerProps {
  selectedPosition: number | null;
  /** Parse + (if valid) add to the draft. Must never commit. */
  onSubmit: (text: string, origin: DraftOp["origin"]) => SubmitOutcome | Promise<SubmitOutcome>;
  status: InlineStatus;
  voiceAdapter?: VoiceAdapter;
  disabled?: boolean;
  disabledReason?: string;
  /** First-screen secondary: open the anatomy browser. Does not draft an edit. */
  onExploreBody?: () => void;
}

const TONE: Record<SubmitOutcome["tone"], string> = {
  ok: "text-emerald-100",
  ask: "text-sky-100",
  unsupported: "text-rose-100",
  error: "text-rose-100",
};

/** Floating prompt composer: text always works; mic is optional. Send/Inspect only DRAFTS and opens the review. */
export function PromptComposer({ selectedPosition, onSubmit, status, voiceAdapter, disabled, disabledReason, onExploreBody }: PromptComposerProps) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const inputId = useId();
  // transient feedback: fades after a few seconds so it never goes stale
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), outcome.tone === "ok" ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [outcome]);

  const run = (value: string, origin: DraftOp["origin"]) => {
    const o = onSubmit(value, origin);
    const apply = (out: SubmitOutcome) => {
      setOutcome(out);
      if (out.tone === "ok") setText("");
    };
    if (typeof (o as Promise<SubmitOutcome>).then === "function") {
      void Promise.resolve(o).then(apply);
    } else {
      apply(o as SubmitOutcome);
    }
  };

  return (
    <div className="pointer-events-auto flex w-full max-w-[640px] flex-col gap-2" data-testid="prompt-composer">
      {voiceOpen && (
        <VoiceCapture
          adapter={voiceAdapter}
          onClose={() => setVoiceOpen(false)}
          onUseTranscript={(t) => {
            setVoiceOpen(false);
            setText(t);
            run(t, "voice");
          }}
        />
      )}

      {outcome && (
        <p role="status" aria-live="polite" data-testid="composer-outcome" data-tone={outcome.tone} className={`glass rounded-lg px-3 py-1.5 text-sm ${TONE[outcome.tone]}`}>
          {outcome.message}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled || !text.trim()) return;
          run(text, "text");
        }}
        className="glass-strong flex items-center gap-1.5 rounded-2xl py-1.5 pl-3 pr-1.5"
      >
        <label htmlFor={inputId} className="sr-only">What would you like to explore or edit? Parsed locally; nothing is saved until you confirm.</label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => { setText(e.target.value); if (outcome) setOutcome(null); }}
          placeholder="What would you like to explore or edit?"
          autoComplete="off"
          spellCheck={false}
          data-testid="prompt-input"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-slate-50 outline-none placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={() => setVoiceOpen((v) => !v)}
          aria-pressed={voiceOpen}
          aria-label={voiceOpen ? "Close voice input" : "Voice input"}
          title="Voice input (optional)"
          data-testid="mic-button"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${voiceOpen ? "border-cyan-300/70 bg-cyan-400/15" : "border-white/15"}`}
        >
          <Mic className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          title={disabled ? disabledReason : "Parse locally and open the proposal review"}
          data-testid="inspect-proposal"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-cyan-300/60 bg-cyan-400/15 px-3.5 text-sm font-medium text-cyan-50 hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
          <span className="max-[480px]:sr-only">Inspect proposal</span>
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-300">
        <span className="rounded-full border border-white/15 px-2 py-0.5" data-testid="parsed-locally-label">{PARSER_LABEL}</span>
        {onExploreBody && (
          <button
            type="button"
            onClick={onExploreBody}
            data-testid="explore-body-parts"
            className="rounded-full border border-white/20 px-2.5 py-0.5 text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            Explore body parts
          </button>
        )}
        {status && <span role="status" data-testid="inline-status" className="text-slate-100">{status}</span>}
        {selectedPosition !== null && !text && !outcome && (
          <span className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap max-[560px]:hidden">
            Try
            {EXAMPLE_PROMPTS.slice(2, 3).map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-md px-1.5 py-0.5 font-mono text-slate-200 underline-offset-2 hover:bg-white/10 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                {ex}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
