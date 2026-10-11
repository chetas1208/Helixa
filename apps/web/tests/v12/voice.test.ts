import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_TRANSCRIPT_CHARS, VOICE_ERROR_MESSAGE, clampTranscript, createMockVoiceAdapter, formatElapsed, initialVoiceState, mapSpeechError,
  resolveVoiceAdapter, unavailableVoiceAdapter, voiceReducer, type VoiceAdapter, type VoiceEvent, type VoiceHandlers, type VoiceState,
} from "../../src/v12/editor/voiceAdapter";

const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState) => events.reduce(voiceReducer, from);

/** Drive an adapter into the reducer exactly as VoiceCapture would, and record every handler call. */
function drive(adapter: VoiceAdapter) {
  const log: string[] = [];
  let state = voiceReducer(initialVoiceState, { type: "request" });
  const h: VoiceHandlers = {
    onStart: () => { log.push("start"); state = voiceReducer(state, { type: "started" }); },
    onPartial: (t) => { log.push(`partial:${t}`); state = voiceReducer(state, { type: "partial", text: t }); },
    onFinal: (t) => { log.push(`final:${t}`); state = voiceReducer(state, { type: "final", text: t }); },
    onError: (c) => { log.push(`error:${c}`); state = voiceReducer(state, { type: "error", code: c }); },
    onEnd: () => { log.push("end"); state = voiceReducer(state, { type: "ended" }); },
  };
  const session = adapter.start(h);
  return { log, session, get state() { return state; } };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("voice state machine: transcript needs confirmation", () => {
  it("request -> started -> partial -> final lands in REVIEW (never auto-applies)", () => {
    const s = run([{ type: "request" }, { type: "started" }, { type: "partial", text: "change base" }, { type: "final", text: "change base 4 to A" }]);
    expect(s.phase).toBe("review");
    expect(s.transcript).toBe("change base 4 to A");
    expect(s.partial).toBe("");
  });

  it("partial transcripts are display-only: they never move past 'listening'", () => {
    const s = run([{ type: "request" }, { type: "started" }, { type: "partial", text: "change base 4 to A" }]);
    expect(s.phase).toBe("listening");
    expect(s.transcript).toBe("");
    expect(s.partial).toBe("change base 4 to A");
  });

  it("partials/finals outside capture are ignored (no late events after cancel)", () => {
    expect(run([{ type: "partial", text: "x" }])).toEqual(initialVoiceState);
    expect(run([{ type: "final", text: "x" }])).toEqual(initialVoiceState);
    const cancelled = run([{ type: "request" }, { type: "started" }, { type: "cancel" }, { type: "final", text: "change base 4 to A" }, { type: "partial", text: "late" }]);
    expect(cancelled).toEqual(initialVoiceState);
  });

  it("the final transcript is editable only in review, and is truncated honestly at the cap", () => {
    expect(run([{ type: "edit", text: "hello" }]).transcript).toBe("");
    const s = run([{ type: "request" }, { type: "started" }, { type: "final", text: "x" }, { type: "edit", text: "y".repeat(MAX_TRANSCRIPT_CHARS + 50) }]);
    expect(s.transcript).toHaveLength(MAX_TRANSCRIPT_CHARS);
    expect(s.truncated).toBe(true);
    const long = clampTranscript("z ".repeat(400));
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(clampTranscript("  a   b  ")).toEqual({ text: "a b", truncated: false });
  });

  it("an empty final transcript does not enter review", () => {
    expect(run([{ type: "request" }, { type: "started" }, { type: "final", text: "   " }]).phase).toBe("listening");
  });

  it("discard returns to idle and clears the transcript", () => {
    const s = run([{ type: "request" }, { type: "started" }, { type: "final", text: "change base 4 to A" }, { type: "discard" }]);
    expect(s).toEqual(initialVoiceState);
  });

  it("errors: surfaced from capture; ignored once a transcript is already under review", () => {
    expect(run([{ type: "request" }, { type: "error", code: "permission_denied" }])).toMatchObject({ phase: "error", error: "permission_denied" });
    const kept = run([{ type: "request" }, { type: "started" }, { type: "final", text: "keep me" }, { type: "error", code: "network" }]);
    expect(kept.phase).toBe("review");
    expect(kept.transcript).toBe("keep me");
  });

  it("ending with nothing heard is an error (no_speech) and ending before the mic opened is 'interrupted'", () => {
    expect(run([{ type: "request" }, { type: "started" }, { type: "ended" }])).toMatchObject({ phase: "error", error: "no_speech" });
    expect(run([{ type: "request" }, { type: "ended" }])).toMatchObject({ phase: "error", error: "interrupted" });
  });

  it("ending while only a partial exists promotes it to REVIEW (still requires confirmation)", () => {
    const s = run([{ type: "request" }, { type: "started" }, { type: "partial", text: "change base four" }, { type: "ended" }]);
    expect(s).toMatchObject({ phase: "review", transcript: "change base four" });
  });

  it("elapsed time only ticks while listening", () => {
    expect(run([{ type: "tick", elapsedMs: 5000 }]).elapsedMs).toBe(0);
    expect(run([{ type: "request" }, { type: "started" }, { type: "tick", elapsedMs: 5000 }]).elapsedMs).toBe(5000);
    expect([formatElapsed(0), formatElapsed(65_000), formatElapsed(-5), formatElapsed(599_999)]).toEqual(["0:00", "1:05", "0:00", "9:59"]);
  });

  it("every error code has a human message with a text fallback", () => {
    for (const [code, msg] of Object.entries(VOICE_ERROR_MESSAGE)) {
      expect(msg.length, code).toBeGreaterThan(20);
      if (code !== "interrupted") expect(msg.toLowerCase(), code).toMatch(/type|text|microphone|browser|speech|configured/);
    }
    expect(VOICE_ERROR_MESSAGE.unsupported).toMatch(/Voice transcription not configured/);
  });

  it("maps Web Speech error codes", () => {
    expect([mapSpeechError("not-allowed"), mapSpeechError("service-not-allowed"), mapSpeechError("no-speech"), mapSpeechError("network"), mapSpeechError("audio-capture"), mapSpeechError("aborted"), mapSpeechError("bad-grammar"), mapSpeechError("???")])
      .toEqual(["permission_denied", "permission_denied", "no_speech", "network", "audio_capture", "interrupted", "unsupported", "unknown"]);
  });
});

describe("mock adapter drives every scenario deterministically", () => {
  it("happy path: partials then a final transcript, then end", async () => {
    const d = drive(createMockVoiceAdapter({ transcript: "change base 4 to A", partials: ["change", "change base 4"] }));
    await settle();
    expect(d.log).toEqual(["start", "partial:change", "partial:change base 4", "final:change base 4 to A", "end"]);
    expect(d.state).toMatchObject({ phase: "review", transcript: "change base 4 to A" });
  });

  it("permission denied", async () => {
    const d = drive(createMockVoiceAdapter({ error: "permission_denied" }));
    await settle();
    expect(d.log).toEqual(["error:permission_denied", "end"]);
    expect(d.state).toMatchObject({ phase: "error", error: "permission_denied", transcript: "" });
  });

  it("unsupported browser", async () => {
    const a = createMockVoiceAdapter({ error: "unsupported" });
    expect(a.isSupported()).toBe(false);
    const d = drive(a);
    await settle();
    expect(d.state).toMatchObject({ phase: "error", error: "unsupported" });
  });

  it("network error and audio capture error mid-session", async () => {
    for (const code of ["network", "audio_capture", "no_speech", "interrupted"] as const) {
      const d = drive(createMockVoiceAdapter({ error: code }));
      await settle();
      expect(d.state, code).toMatchObject({ phase: "error", error: code });
    }
  });

  it("cancel discards: no final after cancel, exactly one end", async () => {
    const d = drive(createMockVoiceAdapter({ transcript: "change base 4 to A", partials: ["change"], stepMs: 5, autoFinish: false }));
    await new Promise((r) => setTimeout(r, 8));
    d.session.cancel();
    await settle();
    expect(d.log.filter((l) => l.startsWith("final"))).toEqual([]);
    expect(d.log.filter((l) => l === "end")).toHaveLength(1);
    expect(d.state.transcript).toBe("");
  });

  it("stop delivers what was heard as final", async () => {
    const d = drive(createMockVoiceAdapter({ transcript: "set position 12 to G", autoFinish: false }));
    await settle();
    expect(d.state.phase).toBe("listening");
    d.session.stop();
    await settle();
    expect(d.state).toMatchObject({ phase: "review", transcript: "set position 12 to G" });
  });

  it("silence: auto-finish without a transcript ends with no_speech", async () => {
    const d = drive(createMockVoiceAdapter({}));
    await settle();
    expect(d.state).toMatchObject({ phase: "error", error: "no_speech" });
  });

  it("the 'none' adapter reports unsupported (honest, no fake transcription)", async () => {
    expect(unavailableVoiceAdapter.isSupported()).toBe(false);
    const d = drive(unavailableVoiceAdapter);
    await settle();
    expect(d.state).toMatchObject({ phase: "error", error: "unsupported" });
  });
});

describe("adapter resolution", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("prefers the injected adapter, else Web Speech, else 'none'", () => {
    const injected = createMockVoiceAdapter({ transcript: "x" });
    vi.stubGlobal("window", { __V12_VOICE_ADAPTER__: injected });
    expect(resolveVoiceAdapter()).toBe(injected);
    vi.stubGlobal("window", {});
    expect(resolveVoiceAdapter().kind).toBe("none");
    vi.stubGlobal("window", { webkitSpeechRecognition: class {} });
    expect(resolveVoiceAdapter().kind).toBe("web-speech");
  });
});
