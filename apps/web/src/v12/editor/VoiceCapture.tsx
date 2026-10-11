import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Check, Mic, Square, X } from "lucide-react";
import * as hooks from "../api/hooks";
import {
  formatElapsed,
  initialVoiceState,
  MAX_TRANSCRIPT_CHARS,
  resolveVoiceAdapter,
  VOICE_ERROR_MESSAGE,
  voiceReducer,
} from "./voiceAdapter";
import type { VoiceAdapter, VoiceSession } from "./voiceAdapter";

/**
 * D may later export `useTranscriptionAvailability`. Until then server STT counts as NOT configured.
 * The hook is looked up once at module load so the hook order is stable.
 */
type Availability = { data?: { available?: boolean } | boolean | null };
const useServerSttAvailability: () => Availability =
  typeof (hooks as Record<string, unknown>).useTranscriptionAvailability === "function"
    ? ((hooks as Record<string, unknown>).useTranscriptionAvailability as () => Availability)
    : () => ({ data: null });

export interface VoiceCaptureProps {
  /** Injected adapter (tests). Defaults to window.__V12_VOICE_ADAPTER__ -> Web Speech -> unavailable. */
  adapter?: VoiceAdapter;
  /** The user confirmed the (possibly edited) transcript. Parsing/drafting happens in the caller; this is NOT an edit confirmation. */
  onUseTranscript: (text: string) => void;
  onClose: () => void;
}

/**
 * Visible, cancellable voice capture. Partial transcripts are display-only and never submit.
 * Flow: [Start listening] -> listening (elapsed, Stop, Cancel) -> review (editable text) ->
 * [Use transcript] (confirmation 1) -> caller shows the proposal -> user confirms the edit (confirmation 2).
 * Audio is never recorded or stored by this app; nothing here touches browser storage.
 */
export function VoiceCapture({ adapter, onUseTranscript, onClose }: VoiceCaptureProps) {
  const ad = useMemo(() => adapter ?? resolveVoiceAdapter(), [adapter]);
  const server = useServerSttAvailability();
  const serverAvailable = typeof server.data === "boolean" ? server.data : !!server.data?.available;
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [acknowledged, setAcknowledged] = useState(false);
  const sessionRef = useRef<VoiceSession | null>(null);
  const startedAt = useRef(0);
  const live = useRef<HTMLParagraphElement>(null);

  const supported = ad.isSupported();

  // elapsed timer while listening (4 Hz, not per frame)
  useEffect(() => {
    if (state.phase !== "listening") return;
    startedAt.current = Date.now();
    const t = setInterval(() => dispatch({ type: "tick", elapsedMs: Date.now() - startedAt.current }), 250);
    return () => clearInterval(t);
  }, [state.phase]);

  // always release the microphone when the component goes away
  useEffect(() => () => { sessionRef.current?.cancel(); sessionRef.current = null; }, []);

  const start = useCallback(() => {
    sessionRef.current?.cancel();
    dispatch({ type: "request" });
    sessionRef.current = ad.start({
      onStart: () => dispatch({ type: "started" }),
      onPartial: (text) => dispatch({ type: "partial", text }),
      onFinal: (text) => dispatch({ type: "final", text }),
      onError: (code) => dispatch({ type: "error", code }),
      onEnd: () => { dispatch({ type: "ended" }); sessionRef.current = null; },
    });
  }, [ad]);

  const stop = () => sessionRef.current?.stop();
  const cancel = () => { sessionRef.current?.cancel(); sessionRef.current = null; dispatch({ type: "cancel" }); };
  const discard = () => { dispatch({ type: "discard" }); };

  const busy = state.phase === "requesting" || state.phase === "listening";

  return (
    <div className="glass-strong pointer-events-auto w-full rounded-xl p-3 text-sm" data-testid="voice-capture" data-phase={state.phase} data-adapter={ad.kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-100">Voice input</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-300">
            {ad.kind === "web-speech"
              ? "Uses your browser's speech recognition. Audio may be sent to your browser vendor's speech service. HELIXA does not record or store audio."
              : ad.kind === "mock"
                ? "Test transcription adapter (no microphone)."
                : "Voice transcription not configured."}
          </p>
        </div>
        <button type="button" onClick={() => { cancel(); onClose(); }} aria-label="Close voice input" className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {!supported && state.phase !== "error" && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-slate-200" role="status">
          <strong className="font-medium">Voice transcription not configured.</strong>{" "}
          This browser has no speech recognition{serverAvailable ? " (a server transcription service was reported, but it is not connected in this build)" : " and no server transcription is available"}. Typing an edit works fully.
        </div>
      )}

      {supported && state.phase === "idle" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!acknowledged && ad.kind === "web-speech" ? (
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="h-4 w-4 accent-cyan-300" />
              I understand audio may leave this device.
            </label>
          ) : null}
          <button
            type="button"
            onClick={start}
            disabled={ad.kind === "web-speech" && !acknowledged}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-400/10 px-3 py-1.5 text-sm font-medium text-cyan-50 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            <Mic className="h-4 w-4" aria-hidden /> Start listening
          </button>
          <span className="text-xs text-slate-400">Nothing is sent to the edit pipeline until you confirm the transcript.</span>
        </div>
      )}

      {busy && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-rose-300/60 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-100" data-testid="voice-indicator">
              <span aria-hidden className="h-2 w-2 rounded-full bg-rose-400 motion-safe:animate-pulse" />
              {state.phase === "requesting" ? "Waiting for microphone permission" : `Listening ${formatElapsed(state.elapsedMs)}`}
            </span>
            <button type="button" onClick={stop} disabled={state.phase !== "listening"} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1 text-xs text-slate-100 hover:bg-white/10 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
              <Square className="h-3.5 w-3.5" aria-hidden /> Stop
            </button>
            <button type="button" onClick={cancel} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1 text-xs text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
              <X className="h-3.5 w-3.5" aria-hidden /> Cancel
            </button>
          </div>
          <p ref={live} aria-live="off" className="min-h-[1.5rem] rounded-md bg-black/20 px-2 py-1 text-sm italic text-slate-300" data-testid="voice-partial">
            {state.partial ? `${state.partial} (draft transcript, not used)` : "Say, for example: change base 4 to A"}
          </p>
        </div>
      )}

      {state.phase === "review" && (
        <div className="mt-3 space-y-2">
          <label htmlFor="voice-transcript" className="block text-xs font-medium text-slate-200">
            Transcript. Check and edit before using it.
          </label>
          <textarea
            id="voice-transcript"
            value={state.transcript}
            onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
            maxLength={MAX_TRANSCRIPT_CHARS}
            rows={2}
            data-testid="voice-transcript"
            className="w-full resize-none rounded-lg border border-white/15 bg-slate-950/60 px-2.5 py-2 text-sm text-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          />
          {state.truncated && <p className="text-xs text-amber-200" role="status">Long transcript shortened to {MAX_TRANSCRIPT_CHARS} characters. Review carefully.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { onUseTranscript(state.transcript); dispatch({ type: "discard" }); }} disabled={!state.transcript.trim()} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/60 bg-cyan-400/15 px-3 py-1.5 text-sm font-medium text-cyan-50 hover:bg-cyan-400/25 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" data-testid="voice-use">
              <Check className="h-4 w-4" aria-hidden /> Use this transcript
            </button>
            <button type="button" onClick={discard} className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Discard</button>
            <button type="button" onClick={start} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Record again</button>
          </div>
          <p className="text-xs text-slate-400">Using the transcript only drafts a proposal. You still confirm the edit separately.</p>
        </div>
      )}

      {state.phase === "error" && state.error && (
        <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-3" role="alert" data-testid="voice-error" data-code={state.error}>
          <p className="text-slate-100">{VOICE_ERROR_MESSAGE[state.error]}</p>
          <div className="mt-2 flex gap-2">
            {state.error !== "unsupported" && supported && (
              <button type="button" onClick={start} className="rounded-lg border border-white/20 px-3 py-1 text-xs text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Try again</button>
            )}
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1 text-xs text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Type instead</button>
          </div>
        </div>
      )}
    </div>
  );
}
