"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pick a mimeType the local MediaRecorder understands. Chrome prefers
 * audio/webm, Safari needs audio/mp4. We try in priority order and fall
 * back to the empty string (= "let the browser decide"), which always works
 * but produces a less compact file.
 */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // Some Safari builds throw on isTypeSupported — ignore.
    }
  }
  return "";
}

export interface AudioRecorderControls {
  supported: boolean;
  recording: boolean;
  error: string | null;
  /** Live mic input level, 0..1. Updated ~30x/s while recording. Useful as
   *  a UI signal so the operator can see their voice is being picked up. */
  level: number;
  /** Begin a new recording. Resolves once the mic is open. */
  start(): Promise<void>;
  /** Finish the current recording. Resolves with the captured blob. Returns
   *  null if there was nothing to capture (no chunks produced). */
  stop(): Promise<Blob | null>;
}

/**
 * MediaRecorder wrapper used in tandem with useSpeechRecognition. Web Speech
 * does live-preview transcription; this hook captures the actual audio that
 * gets shipped to Whisper for the high-quality result.
 *
 * The mic stream is opened on first start() and reused thereafter — keeps
 * the browser's mic indicator stable instead of toggling per-recording.
 */
export function useAudioRecorder(): AudioRecorderControls {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const mimeRef = useRef<string>("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
    return () => {
      // Tear down on unmount — the user navigated away.
      const stream = streamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      if (levelRafRef.current !== null) {
        cancelAnimationFrame(levelRafRef.current);
        levelRafRef.current = null;
      }
      recorderRef.current = null;
    };
  }, []);

  // Live mic level — RMS over a short FFT window. Cheap; no audio data is
  // copied. Stops when no recorder is active so we don't burn battery.
  const startLevelMeter = useCallback((stream: MediaStream) => {
    if (!stream) return;
    if (audioCtxRef.current) return; // already running
    try {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyzerRef.current = analyser;

      const buffer = new Uint8Array(analyser.fftSize);
      const tick = () => {
        const a = analyzerRef.current;
        if (!a) return;
        a.getByteTimeDomainData(buffer);
        // RMS over the byte-domain (centered at 128). Map 0..~80 → 0..1.
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        setLevel(Math.min(1, rms * 4));
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {
      // AudioContext not allowed in this context — no level meter, fine.
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError("MediaRecorder not supported");
      return;
    }
    if (recorderRef.current && recorderRef.current.state === "recording") {
      // Already recording — caller's bug, but harmless to ignore.
      return;
    }

    try {
      if (!streamRef.current) {
        // Disable Chrome's video-call-tuned audio processing — echo
        // cancellation and noise suppression were trained against distant
        // speakers and will gate too aggressively for dictation, swallowing
        // whole words and producing the silent-audio Whisper hallucination
        // ("Thanks for watching. Bye.") Auto-gain stays on so soft voices
        // are still amplified.
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        startLevelMeter(streamRef.current);
      }
      const mimeType = mimeRef.current || pickMimeType();
      mimeRef.current = mimeType;

      const recorder = new MediaRecorder(
        streamRef.current,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      recorder.onstop = () => {
        const blob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, {
                type: mimeRef.current || "audio/webm",
              })
            : null;
        chunksRef.current = [];
        const resolve = stopResolverRef.current;
        stopResolverRef.current = null;
        if (resolve) resolve(blob);
        setRecording(false);
      };
      recorder.onerror = (e) => {
        const errEvent = e as unknown as { error?: { message?: string } };
        setError(errEvent.error?.message ?? "Recorder error");
      };

      recorderRef.current = recorder;
      // No timeslice — fire dataavailable once on stop so the resulting WebM
      // has a single, well-formed container with valid header metadata.
      // Whisper sometimes returns empty transcripts on streamed multi-chunk
      // recordings where duration is set to -1.
      recorder.start();
      setRecording(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mic unavailable";
      setError(message);
      setRecording(false);
    }
  }, [supported]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        resolve(null);
        return;
      }
      stopResolverRef.current = resolve;
      try {
        recorder.stop();
      } catch (err) {
        // Already stopped — resolve directly.
        stopResolverRef.current = null;
        setRecording(false);
        if (err instanceof Error) setError(err.message);
        resolve(null);
      }
    });
  }, []);

  return { supported, recording, error, level, start, stop };
}
