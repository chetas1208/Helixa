/**
 * Voice capture adapter + pure state machine.
 *
 * - There is NO backend speech-to-text. The only real implementation is the browser Web Speech API,
 *   a progressive enhancement that may send audio to the browser vendor. It is never required.
 * - The adapter interface is injectable so tests can supply a deterministic transcript:
 *     window.__V12_VOICE_ADAPTER__ = createMockVoiceAdapter({ transcript: "change base 4 to A" })
 * - Partial transcripts are display-only. A transcript only becomes usable via an explicit user
 *   confirmation (VoiceCapture), and an edit needs a second, separate confirmation.
 * - No audio is stored; nothing here touches storage.
 */

export type VoiceErrorCode =
  | "permission_denied"
  | "unsupported"
  | "interrupted"
  | "no_speech"
  | "network"
  | "audio_capture"
  | "unknown";

export const VOICE_ERROR_MESSAGE: Record<VoiceErrorCode, string> = {
  permission_denied: "Microphone permission was denied. Allow microphone access in your browser, or type the edit instead.",
  unsupported: "Voice transcription not configured. This browser has no speech recognition and no server transcription is available. Text works fully.",
  interrupted: "Capture was interrupted before a transcript was produced. You can try again or type the edit.",
  no_speech: "No speech was detected. Try again, closer to the microphone, or type the edit.",
  network: "The speech service could not be reached (network error). Type the edit instead.",
  audio_capture: "No microphone was found or it is in use by another application.",
  unknown: "Voice capture failed. Type the edit instead.",
};

export interface VoiceHandlers {
  /** Interim text. Display only: must never trigger anything. */
  onPartial(text: string): void;
  /** Final text for the utterance(s) so far. Still needs the user's explicit confirmation. */
  onFinal(text: string): void;
  onError(code: VoiceErrorCode): void;
  /** Always called exactly once when the underlying session ends (after final/error/stop/cancel). */
  onEnd(): void;
  /** The mic really opened (permission granted). */
  onStart?(): void;
}

export interface VoiceSession {
  /** Stop listening and deliver what was heard as final. */
  stop(): void;
  /** Abort and discard everything. No onFinal after cancel. */
  cancel(): void;
}

export interface VoiceAdapter {
  readonly kind: "web-speech" | "mock" | "none";
  isSupported(): boolean;
  /** Must be called from a user gesture. */
  start(handlers: VoiceHandlers): VoiceSession;
}

// ---------- pure state machine ----------

export type VoicePhase = "idle" | "requesting" | "listening" | "review" | "error";

export interface VoiceState {
  phase: VoicePhase;
  partial: string;
  /** Editable final transcript (user may change it before using it). */
  transcript: string;
  truncated: boolean;
  elapsedMs: number;
  error: VoiceErrorCode | null;
}

export const MAX_TRANSCRIPT_CHARS = 300;

export type VoiceEvent =
  | { type: "request" }
  | { type: "started" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "tick"; elapsedMs: number }
  | { type: "error"; code: VoiceErrorCode }
  | { type: "ended" }
  | { type: "edit"; text: string }
  | { type: "cancel" }
  | { type: "discard" };

export const initialVoiceState: VoiceState = { phase: "idle", partial: "", transcript: "", truncated: false, elapsedMs: 0, error: null };

export function clampTranscript(text: string): { text: string; truncated: boolean } {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_TRANSCRIPT_CHARS ? { text: t.slice(0, MAX_TRANSCRIPT_CHARS), truncated: true } : { text: t, truncated: false };
}

export function voiceReducer(s: VoiceState, e: VoiceEvent): VoiceState {
  switch (e.type) {
    case "request":
      return { ...initialVoiceState, phase: "requesting" };
    case "started":
      return s.phase === "requesting" ? { ...s, phase: "listening", elapsedMs: 0 } : s;
    case "partial":
      return s.phase === "listening" || s.phase === "requesting" ? { ...s, partial: e.text.slice(0, MAX_TRANSCRIPT_CHARS * 2) } : s;
    case "tick":
      return s.phase === "listening" ? { ...s, elapsedMs: e.elapsedMs } : s;
    case "final": {
      if (s.phase !== "listening" && s.phase !== "requesting") return s;
      const c = clampTranscript(e.text);
      if (!c.text) return s;
      return { ...s, phase: "review", transcript: c.text, truncated: c.truncated, partial: "" };
    }
    case "error":
      // Keep any already-final transcript reviewable; otherwise surface the error.
      if (s.phase === "review") return s;
      return { ...initialVoiceState, phase: "error", error: e.code };
    case "ended":
      // Ending while still listening/requesting with nothing final means nothing was heard.
      if (s.phase === "listening" || s.phase === "requesting") {
        return s.partial.trim()
          ? { ...s, phase: "review", transcript: clampTranscript(s.partial).text, truncated: clampTranscript(s.partial).truncated, partial: "" }
          : { ...initialVoiceState, phase: "error", error: s.phase === "requesting" ? "interrupted" : "no_speech" };
      }
      return s;
    case "edit": {
      if (s.phase !== "review") return s;
      const c = clampTranscript(e.text);
      return { ...s, transcript: e.text.slice(0, MAX_TRANSCRIPT_CHARS), truncated: c.truncated || e.text.length > MAX_TRANSCRIPT_CHARS };
    }
    case "cancel":
    case "discard":
      return initialVoiceState;
    default:
      return s;
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ---------- Web Speech API adapter ----------

interface SpeechRecognitionAlt { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlt; length: number }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionErrorLike { error: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function mapSpeechError(code: string): VoiceErrorCode {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission_denied";
    case "no-speech":
      return "no_speech";
    case "network":
      return "network";
    case "audio-capture":
      return "audio_capture";
    case "aborted":
      return "interrupted";
    case "language-not-supported":
    case "bad-grammar":
      return "unsupported";
    default:
      return "unknown";
  }
}

export const webSpeechAdapter: VoiceAdapter = {
  kind: "web-speech",
  isSupported: () => getSpeechCtor() !== null,
  start(h) {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      queueMicrotask(() => { h.onError("unsupported"); h.onEnd(); });
      return { stop() {}, cancel() {} };
    }
    const rec = new Ctor();
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    let cancelled = false;
    let errored = false;
    let ended = false;
    rec.onstart = () => h.onStart?.();
    rec.onresult = (e) => {
      if (cancelled) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += (finalText ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      h.onPartial((finalText ? finalText + " " : "") + interim);
    };
    rec.onerror = (e) => {
      if (cancelled) return;
      errored = true;
      h.onError(mapSpeechError(e.error));
    };
    rec.onend = () => {
      if (ended) return;
      ended = true;
      if (!cancelled && !errored && finalText.trim()) h.onFinal(finalText.trim());
      h.onEnd();
    };
    try {
      rec.start();
    } catch {
      errored = true;
      h.onError("unknown");
      ended = true;
      h.onEnd();
    }
    return {
      stop: () => { try { rec.stop(); } catch { /* already stopped */ } },
      cancel: () => { cancelled = true; try { rec.abort(); } catch { /* already stopped */ } },
    };
  },
};

/** Adapter used when there is neither Web Speech nor a configured server STT. */
export const unavailableVoiceAdapter: VoiceAdapter = {
  kind: "none",
  isSupported: () => false,
  start(h) {
    queueMicrotask(() => { h.onError("unsupported"); h.onEnd(); });
    return { stop() {}, cancel() {} };
  },
};

// ---------- deterministic mock (for tests / demos) ----------

export interface MockVoiceOptions {
  /** Final transcript to deliver. Omit with `error` to simulate failures. */
  transcript?: string;
  partials?: string[];
  error?: VoiceErrorCode;
  /** Simulated latency per step in ms (default 0 = next macrotask). */
  stepMs?: number;
  /** When false, the session never ends by itself until stop() (default true: auto-finishes). */
  autoFinish?: boolean;
}

export function createMockVoiceAdapter(opts: MockVoiceOptions = {}): VoiceAdapter {
  return {
    kind: "mock",
    isSupported: () => opts.error !== "unsupported",
    start(h) {
      const step = opts.stepMs ?? 0;
      let done = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const at = (ms: number, fn: () => void) => { timers.push(setTimeout(() => { if (!done) fn(); }, ms)); };
      const finish = () => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        h.onEnd();
      };
      let t = step;
      at(t, () => {
        if (opts.error === "permission_denied" || opts.error === "unsupported") { h.onError(opts.error); finish(); return; }
        h.onStart?.();
      });
      if (opts.error && opts.error !== "permission_denied" && opts.error !== "unsupported") {
        at((t += step + 1), () => { h.onError(opts.error as VoiceErrorCode); finish(); });
      } else if (!opts.error) {
        for (const p of opts.partials ?? []) at((t += step + 1), () => h.onPartial(p));
        if (opts.autoFinish !== false) {
          at((t += step + 1), () => { if (opts.transcript) h.onFinal(opts.transcript); finish(); });
        }
      }
      return {
        stop: () => { if (done) return; if (opts.transcript) h.onFinal(opts.transcript); finish(); },
        cancel: () => { done = true; timers.forEach(clearTimeout); h.onEnd(); },
      };
    },
  };
}

declare global {
  interface Window {
    /** Test hook: provide a deterministic VoiceAdapter. Never changes DNA; transcripts still need confirmation. */
    __V12_VOICE_ADAPTER__?: VoiceAdapter;
  }
}

/** Resolve the adapter: injected test adapter, else Web Speech, else "none". */
export function resolveVoiceAdapter(): VoiceAdapter {
  if (typeof window !== "undefined" && window.__V12_VOICE_ADAPTER__) return window.__V12_VOICE_ADAPTER__;
  return webSpeechAdapter.isSupported() ? webSpeechAdapter : unavailableVoiceAdapter;
}
