"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API isn't in lib.dom yet on most TS configs, and it lives
// under the legacy `webkitSpeechRecognition` constructor in Chrome. Declare
// just enough surface here to type-check without bringing in a polyfill.
interface MinimalRecognitionResult {
  0: { transcript: string };
  isFinal: boolean;
  length: number;
}
interface MinimalRecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: MinimalRecognitionResult };
}
interface MinimalSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: MinimalRecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function getRecognitionCtor(): (new () => MinimalSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => MinimalSpeechRecognition;
    webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechRecognitionState {
  /** Browser exposes the Web Speech API. */
  supported: boolean;
  /** Recognition is currently active (mic open). */
  listening: boolean;
  /** Concatenated final results since start(). Cleared by reset(). */
  finalText: string;
  /** Most recent non-final hypothesis — useful for live UI feedback. */
  interim: string;
  /** Most recent error code from the recognition engine, if any. */
  error: string | null;
}

export interface SpeechRecognitionControls {
  start(): void;
  stop(): void;
  reset(): void;
}

/**
 * Continuous Web Speech API hook with auto-restart.
 *
 * Chrome silently stops the recognizer every ~60s of silence and after some
 * errors. We hook `onend` to restart whenever `wantListening` is true, so the
 * caller's mental model is "listening until I tell you to stop" rather than
 * "listening until the browser feels like it."
 */
export function useSpeechRecognition(opts?: {
  lang?: string;
  /** Callback invoked once per finalized chunk. The chunk text is also
   *  appended to `finalText`; the callback is mostly useful for wake-word
   *  detection where you want to react in real time without diffing state. */
  onChunk?: (chunk: string) => void;
}): SpeechRecognitionState & SpeechRecognitionControls {
  const lang = opts?.lang ?? "en-US";
  const onChunkRef = useRef(opts?.onChunk);
  onChunkRef.current = opts?.onChunk;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MinimalSpeechRecognition | null>(null);
  // Tracks the user's intent — what they last asked us to do. The browser
  // toggles `listening` independently (auto-stops, errors), and we use this
  // flag to decide whether to restart.
  const wantListeningRef = useRef(false);

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onstart = () => {
      setListening(true);
      setError(null);
    };

    rec.onresult = (e) => {
      let interimText = "";
      let appended = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          appended += text;
        } else {
          interimText += text;
        }
      }
      if (appended) {
        setFinalText((prev) => prev + appended);
        onChunkRef.current?.(appended);
      }
      setInterim(interimText);
    };

    rec.onerror = (e) => {
      const code = e.error ?? "unknown";
      setError(code);
      // `no-speech` and `aborted` are routine — don't stop trying. Other
      // errors (`not-allowed`, `audio-capture`, `network`) usually mean the
      // mic is unavailable; let onend restart only if the user still wants
      // it, but log so the operator sees what's happening.
      if (code === "not-allowed" || code === "audio-capture") {
        wantListeningRef.current = false;
      }
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
      // Auto-restart while the user wants to keep listening. Brief microtask
      // delay avoids a Chrome bug where calling start() inside onend can
      // throw "InvalidStateError".
      if (wantListeningRef.current) {
        setTimeout(() => {
          if (wantListeningRef.current) {
            try {
              rec.start();
            } catch {
              // Already started, or torn down — fine.
            }
          }
        }, 150);
      }
    };

    recRef.current = rec;

    return () => {
      wantListeningRef.current = false;
      try {
        rec.abort();
      } catch {
        // ignore
      }
      recRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    wantListeningRef.current = true;
    try {
      rec.start();
    } catch {
      // Already started — fine.
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    wantListeningRef.current = false;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    setFinalText("");
    setInterim("");
    setError(null);
  }, []);

  return {
    supported,
    listening,
    finalText,
    interim,
    error,
    start,
    stop,
    reset,
  };
}
