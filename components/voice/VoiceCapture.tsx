"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MicrophoneIcon,
  XIcon,
  ArrowSquareOutIcon,
  WaveformIcon,
  GearIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useAudioRecorder } from "./useAudioRecorder";

const STORAGE_KEY = "jupietre-voice-prefs-v2";
const HISTORY_KEY = "jupietre-voice-history-v1";

type LangPref = "auto" | "en" | "nl" | "de" | "fr" | "es";

interface Prefs {
  alwaysOn: boolean;
  wakeWord: string;
  silenceMs: number;
  language: LangPref;
}

const DEFAULT_PREFS: Prefs = {
  alwaysOn: false,
  wakeWord: "jupietre ticket",
  silenceMs: 2000,
  language: "auto",
};

interface HistoryItem {
  sessionId: string;
  transcript: string;
  capturedAt: number;
}

/** Map our pref code to the BCP-47 tag Web Speech wants. */
function speechLangFor(pref: LangPref): string {
  switch (pref) {
    case "en":
      return "en-US";
    case "nl":
      return "nl-NL";
    case "de":
      return "de-DE";
    case "fr":
      return "fr-FR";
    case "es":
      return "es-ES";
    case "auto":
    default:
      return "en-US"; // Web Speech doesn't auto-detect; fall back to English.
  }
}

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      alwaysOn: parsed.alwaysOn ?? DEFAULT_PREFS.alwaysOn,
      wakeWord: parsed.wakeWord ?? DEFAULT_PREFS.wakeWord,
      silenceMs: parsed.silenceMs ?? DEFAULT_PREFS.silenceMs,
      language: parsed.language ?? DEFAULT_PREFS.language,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: Prefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage full / disabled — fine.
  }
}

function loadHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryItem[];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
  } catch {
    // ignore
  }
}

/** Strip the wake phrase out of a chunk and return the remainder. */
function stripWakePhrase(text: string, wake: string): string {
  const idx = text.toLowerCase().indexOf(wake.toLowerCase());
  if (idx < 0) return text.trim();
  return text.slice(idx + wake.length).replace(/^[\s,.:;!?-]+/, "").trim();
}

export function VoiceCapture() {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Loud + visible state during the Whisper round-trip so the operator
  // doesn't think the click did nothing.
  const [transcribing, setTranscribing] = useState(false);

  // The live preview transcript from Web Speech. Used for UI feedback only;
  // Whisper's response is what actually gets submitted.
  const [pending, setPending] = useState("");
  const pendingRef = useRef("");
  pendingRef.current = pending;

  const wakeArmedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against double-submission when the user clicks stop AND the
  // silence timer fires in always-on mode, both racing toward submit.
  const inFlightRef = useRef(false);

  // Load prefs + history on mount.
  useEffect(() => {
    setPrefs(loadPrefs());
    setHistory(loadHistory());
  }, []);

  // Persist prefs whenever they change (skip the very first render where
  // we just hydrated from storage).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    savePrefs(prefs);
  }, [prefs]);

  const recorder = useAudioRecorder();

  const submit = useCallback(
    async (audio: Blob | null, livePreview: string) => {
      // We always have a Web Speech preview as fallback. Whisper is the
      // primary; we only fall back if the audio blob is missing or the
      // call fails.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setSubmitting(true);
      setSubmitError(null);
      try {
        let transcript = livePreview.trim();

        if (audio && audio.size > 2_000) {
          setTranscribing(true);
          try {
            const form = new FormData();
            // Wrap as a File with an explicit filename + mime so the
            // multipart Content-Type propagates to the server. Without
            // this, Bun's parser sometimes drops the blob type and the
            // server logs end up showing `type=(unknown)`.
            const ext = (audio.type.includes("mp4") ? "m4a" : "webm");
            const audioFile = new File([audio], `voice.${ext}`, {
              type: audio.type || "audio/webm",
            });
            form.append("audio", audioFile);
            if (prefs.language !== "auto") {
              form.append("language", prefs.language);
            }
            const res = await fetch("/api/voice/transcribe", {
              method: "POST",
              body: form,
            });
            if (res.ok) {
              const data = (await res.json()) as { text?: string };
              if (data.text && data.text.trim()) {
                transcript = data.text.trim();
              }
            } else {
              const data = (await res.json().catch(() => null)) as {
                error?: string;
              } | null;
              // Whisper failed — keep the live preview but surface the
              // error so the operator knows quality may be worse.
              setSubmitError(
                `Whisper failed: ${data?.error ?? res.status}. Using live-preview transcript instead.`,
              );
            }
          } catch (err) {
            setSubmitError(
              `Whisper request failed: ${err instanceof Error ? err.message : "unknown"}. Using live-preview transcript instead.`,
            );
          } finally {
            setTranscribing(false);
          }
        } else if (audio) {
          // Tiny audio blob — Whisper would just return empty. Surface a
          // useful message so the operator knows to speak longer next time.
          setSubmitError(
            `Audio capture was very short (${audio.size} bytes). Hold the mic open longer; falling back to live preview.`,
          );
        }

        if (!transcript) {
          setSubmitError("Nothing transcribed — try again.");
          return;
        }

        const captureRes = await fetch("/api/voice/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
        if (!captureRes.ok) {
          const data = (await captureRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          setSubmitError(data?.error ?? `Failed (${captureRes.status})`);
          return;
        }
        const data = (await captureRes.json()) as { sessionId: string };
        const item: HistoryItem = {
          sessionId: data.sessionId,
          transcript,
          capturedAt: Date.now(),
        };
        setHistory((h) => {
          const next = [item, ...h].slice(0, 10);
          saveHistory(next);
          return next;
        });
        setPending("");
        pendingRef.current = "";
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setSubmitting(false);
        inFlightRef.current = false;
      }
    },
    [prefs.language],
  );

  // Schedule an auto-submit after silenceMs of no new chunks (always-on mode).
  const scheduleAutoSubmit = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(async () => {
      const text = pendingRef.current;
      if (text.trim().length === 0) return;
      wakeArmedRef.current = false;
      // Capture the audio that's accumulated since wake-word fired.
      const audio = await recorder.stop();
      void submit(audio, text);
      // Re-arm the recorder for the next wake-word cycle.
      void recorder.start();
    }, prefs.silenceMs);
  }, [prefs.silenceMs, recorder, submit]);

  const handleChunk = useCallback(
    (chunk: string) => {
      if (prefs.alwaysOn) {
        if (!wakeArmedRef.current) {
          if (chunk.toLowerCase().includes(prefs.wakeWord.toLowerCase())) {
            wakeArmedRef.current = true;
            // Start a fresh audio recording right at the wake-word boundary
            // so Whisper only hears the actual task, not the ambient noise
            // that came before.
            void recorder.stop().then(() => recorder.start());
            const tail = stripWakePhrase(chunk, prefs.wakeWord);
            setPending(tail);
            pendingRef.current = tail;
            scheduleAutoSubmit();
          }
          return;
        }
        setPending((prev) => {
          const next = (prev + " " + chunk).trim();
          pendingRef.current = next;
          return next;
        });
        scheduleAutoSubmit();
        return;
      }

      // PTT mode — extend the live preview transcript on every chunk.
      setPending((prev) => {
        const next = (prev + " " + chunk).trim();
        pendingRef.current = next;
        return next;
      });
    },
    [prefs.alwaysOn, prefs.wakeWord, recorder, scheduleAutoSubmit],
  );

  const speech = useSpeechRecognition({
    lang: speechLangFor(prefs.language),
    onChunk: handleChunk,
  });

  // Always-on mode: keep Web Speech running. Audio recorder stays idle until
  // the wake-word fires, then captures the actual task.
  useEffect(() => {
    if (!speech.supported) return;
    if (prefs.alwaysOn) {
      speech.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.alwaysOn, speech.supported]);

  // Cleanup the silence timer on unmount.
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const togglePtt = async () => {
    if (speech.listening) {
      speech.stop();
      const audio = await recorder.stop();
      const text = pendingRef.current;
      if (text.trim().length > 0 || audio) {
        void submit(audio, text);
      }
    } else {
      setPending("");
      pendingRef.current = "";
      setSubmitError(null);
      speech.start();
      void recorder.start();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close voice capture" : "Open voice capture"}
        className={cn(
          "fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full",
          "flex items-center justify-center",
          "ring-1 transition-all duration-200",
          speech.listening
            ? "bg-danger-soft text-danger ring-[color:var(--danger-soft)] shadow-[0_0_24px_-4px_var(--danger-soft)]"
            : "bg-fg text-bg ring-fg hover:opacity-90 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]",
        )}
      >
        {speech.listening ? (
          <WaveformIcon weight="bold" className="h-5 w-5" />
        ) : (
          <MicrophoneIcon weight="bold" className="h-5 w-5" />
        )}
        {speech.listening ? (
          <motion.span
            className="absolute inset-0 rounded-full ring-1 ring-danger"
            animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              "fixed bottom-20 right-5 z-50 w-[360px] max-w-[calc(100vw-2.5rem)]",
              "rounded-2xl ring-1 ring-hairline bg-surface-1/95 backdrop-blur-xl",
              "shadow-[0_24px_56px_-16px_rgba(0,0,0,0.5)] overflow-hidden",
            )}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-fg">Voice</span>
                {speech.listening ? (
                  <span className="text-[11px] text-danger flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
                    listening
                  </span>
                ) : null}
                {transcribing ? (
                  <span className="text-[11px] text-accent flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                    whisper
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSettings((s) => !s)}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2"
                  aria-label="Settings"
                >
                  <GearIcon weight="regular" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2"
                  aria-label="Close"
                >
                  <XIcon weight="regular" className="h-4 w-4" />
                </button>
              </div>
            </div>

            {!speech.supported ? (
              <div className="px-4 py-6 text-[12px] text-fg-muted leading-relaxed">
                Your browser doesn&apos;t expose the Web Speech API. Try
                Chrome or Edge — Firefox doesn&apos;t support it.
              </div>
            ) : showSettings ? (
              <SettingsPanel prefs={prefs} setPrefs={setPrefs} />
            ) : (
              <div className="px-4 pb-4 space-y-3">
                <div className="rounded-xl ring-1 ring-hairline bg-surface-2/60 p-3 min-h-[80px] text-[13px] text-fg leading-relaxed whitespace-pre-wrap">
                  {pending || speech.interim ? (
                    <>
                      {pending}
                      {speech.interim ? (
                        <span className="text-fg-subtle italic">
                          {pending ? " " : ""}
                          {speech.interim}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-fg-subtle italic">
                      {prefs.alwaysOn
                        ? `Listening for "${prefs.wakeWord}"...`
                        : "Tap the mic to start. Speak. Tap again to send."}
                    </span>
                  )}
                </div>

                {submitError ? (
                  <p className="text-[12px] text-danger leading-relaxed">
                    {submitError}
                  </p>
                ) : null}
                {speech.error ? (
                  <p className="text-[11px] text-fg-subtle">
                    speech: {speech.error}
                  </p>
                ) : null}
                {recorder.error ? (
                  <p className="text-[11px] text-fg-subtle">
                    recorder: {recorder.error}
                  </p>
                ) : null}

                {!prefs.alwaysOn ? (
                  <Button
                    type="button"
                    onClick={togglePtt}
                    loading={submitting}
                    disabled={submitting}
                    variant={speech.listening ? "danger" : "primary"}
                    className="w-full"
                  >
                    {speech.listening
                      ? pending.trim() || recorder.recording
                        ? "Stop & send to ticket"
                        : "Stop"
                      : "Start listening"}
                  </Button>
                ) : (
                  <p className="text-[11px] text-fg-subtle leading-relaxed">
                    Always-on mode. Say{" "}
                    <code className="font-mono text-fg">{prefs.wakeWord}</code>{" "}
                    followed by your task. Auto-sends after{" "}
                    {Math.round(prefs.silenceMs / 1000)}s of silence.
                  </p>
                )}

                {history.length > 0 ? (
                  <div className="pt-2 border-t border-hairline">
                    <h3 className="text-[11px] uppercase tracking-wide text-fg-subtle mb-1.5">
                      Recent
                    </h3>
                    <ul className="space-y-1">
                      {history.slice(0, 4).map((h) => (
                        <li
                          key={h.sessionId}
                          className="flex items-center gap-2 text-[12px]"
                        >
                          <span className="flex-1 truncate text-fg-muted">
                            {h.transcript}
                          </span>
                          <a
                            href={`/sessions/${h.sessionId}`}
                            className="text-fg-subtle hover:text-fg shrink-0"
                            title="Open session"
                          >
                            <ArrowSquareOutIcon
                              weight="regular"
                              className="h-3.5 w-3.5"
                            />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function SettingsPanel({
  prefs,
  setPrefs,
}: {
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
}) {
  return (
    <div className="px-4 pb-4 space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={prefs.alwaysOn}
          onChange={(e) =>
            setPrefs({ ...prefs, alwaysOn: e.target.checked })
          }
          className="mt-0.5"
        />
        <div className="flex-1">
          <div className="text-[13px] text-fg">Always-on with wake word</div>
          <p className="text-[11px] text-fg-subtle leading-relaxed mt-0.5">
            Listen continuously. When the wake phrase is heard, capture
            everything until silence and auto-send to Whisper.
          </p>
        </div>
      </label>

      <div>
        <label htmlFor="wake" className="block text-[12px] text-fg-muted mb-1">
          Wake phrase
        </label>
        <input
          id="wake"
          type="text"
          value={prefs.wakeWord}
          onChange={(e) =>
            setPrefs({ ...prefs, wakeWord: e.target.value })
          }
          className={cn(
            "w-full h-9 px-3 rounded-xl text-[13px] font-mono",
            "bg-surface-2 ring-1 ring-hairline focus:ring-strong outline-none",
            "transition-colors",
          )}
          placeholder="jupietre ticket"
        />
        <p className="text-[11px] text-fg-subtle mt-1 leading-relaxed">
          Two-word phrases trigger less often by accident.
        </p>
      </div>

      <div>
        <label htmlFor="lang" className="block text-[12px] text-fg-muted mb-1">
          Language hint
        </label>
        <select
          id="lang"
          value={prefs.language}
          onChange={(e) =>
            setPrefs({ ...prefs, language: e.target.value as LangPref })
          }
          className={cn(
            "w-full h-9 px-2 rounded-xl text-[13px]",
            "bg-surface-2 ring-1 ring-hairline focus:ring-strong outline-none",
            "transition-colors",
          )}
        >
          <option value="auto">Auto-detect</option>
          <option value="en">English</option>
          <option value="nl">Dutch (Nederlands)</option>
          <option value="de">German (Deutsch)</option>
          <option value="fr">French (Français)</option>
          <option value="es">Spanish (Español)</option>
        </select>
        <p className="text-[11px] text-fg-subtle mt-1 leading-relaxed">
          Pinning the language usually beats auto-detect for short utterances.
        </p>
      </div>

      <div>
        <label
          htmlFor="silence"
          className="block text-[12px] text-fg-muted mb-1"
        >
          Silence timeout: {Math.round(prefs.silenceMs / 1000)}s
        </label>
        <input
          id="silence"
          type="range"
          min={1000}
          max={6000}
          step={500}
          value={prefs.silenceMs}
          onChange={(e) =>
            setPrefs({ ...prefs, silenceMs: Number(e.target.value) })
          }
          className="w-full"
        />
      </div>
    </div>
  );
}
