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

const STORAGE_KEY = "jupietre-voice-prefs-v1";
const HISTORY_KEY = "jupietre-voice-history-v1";

interface Prefs {
  alwaysOn: boolean;
  wakeWord: string;
  silenceMs: number;
}

const DEFAULT_PREFS: Prefs = {
  alwaysOn: false,
  wakeWord: "jupietre ticket",
  silenceMs: 2000,
};

interface HistoryItem {
  sessionId: string;
  transcript: string;
  capturedAt: number;
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

/**
 * Strip the wake phrase out of a captured chunk and return the remainder.
 * Case-insensitive, tolerant of leading/trailing whitespace and punctuation
 * that the recognizer sometimes inserts.
 */
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

  // Captured pending transcript = what's already past the wake word (or
  // everything since `start()` in PTT mode), waiting to be sent.
  const [pending, setPending] = useState("");
  const pendingRef = useRef("");
  pendingRef.current = pending;

  const wakeArmedRef = useRef(false); // true once wake word has been heard
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const submit = useCallback(
    async (text: string) => {
      const transcript = text.trim();
      if (!transcript) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await fetch("/api/voice/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setSubmitError(data?.error ?? `Failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as { sessionId: string };
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
      }
    },
    [],
  );

  // Schedule an auto-submit after `silenceMs` of no new chunks. Reset by
  // every chunk; cleared when we actually fire.
  const scheduleAutoSubmit = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      const text = pendingRef.current;
      if (text.trim().length > 0) {
        wakeArmedRef.current = false;
        void submit(text);
      }
    }, prefs.silenceMs);
  }, [prefs.silenceMs, submit]);

  const handleChunk = useCallback(
    (chunk: string) => {
      if (prefs.alwaysOn) {
        // In wake-word mode, suppress every chunk until the phrase appears.
        if (!wakeArmedRef.current) {
          if (chunk.toLowerCase().includes(prefs.wakeWord.toLowerCase())) {
            wakeArmedRef.current = true;
            const tail = stripWakePhrase(chunk, prefs.wakeWord);
            setPending(tail);
            pendingRef.current = tail;
            scheduleAutoSubmit();
          }
          return;
        }
        // Already armed — keep collecting.
        setPending((prev) => {
          const next = (prev + " " + chunk).trim();
          pendingRef.current = next;
          return next;
        });
        scheduleAutoSubmit();
        return;
      }

      // PTT mode — every chunk extends the pending transcript. The user
      // submits manually via the button; no silence timeout.
      setPending((prev) => {
        const next = (prev + " " + chunk).trim();
        pendingRef.current = next;
        return next;
      });
    },
    [prefs.alwaysOn, prefs.wakeWord, scheduleAutoSubmit],
  );

  const speech = useSpeechRecognition({ onChunk: handleChunk });

  // When the user toggles always-on, kick the recognizer to match. The hook
  // already auto-restarts after errors / Chrome's 60s timeout.
  useEffect(() => {
    if (!speech.supported) return;
    if (prefs.alwaysOn) {
      speech.start();
    } else {
      // Don't auto-stop here — the user might be in the middle of a PTT
      // capture. Just let PTT control take over.
    }
    // Intentionally only depends on alwaysOn; we don't want to restart on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.alwaysOn, speech.supported]);

  // Cleanup the silence timer on unmount.
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const togglePtt = () => {
    if (speech.listening) {
      speech.stop();
      // If we've got pending text, send it now.
      const text = pendingRef.current;
      if (text.trim().length > 0) {
        void submit(text);
      }
    } else {
      setPending("");
      pendingRef.current = "";
      setSubmitError(null);
      speech.start();
    }
  };

  return (
    <>
      {/* Floating mic button */}
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

      {/* Panel */}
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
                Your browser doesn&apos;t expose the Web Speech API. Try Chrome
                or Edge — Firefox doesn&apos;t support it.
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
                  <p className="text-[12px] text-danger">{submitError}</p>
                ) : null}
                {speech.error ? (
                  <p className="text-[11px] text-fg-subtle">
                    recognition: {speech.error}
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
                      ? pending.trim()
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
            everything until silence and auto-send.
          </p>
        </div>
      </label>

      <div>
        <label
          htmlFor="wake"
          className="block text-[12px] text-fg-muted mb-1"
        >
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
          Two-word phrases trigger less often by accident. Avoid common
          words.
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
