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

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const mimeRef = useRef<string>("");

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
      recorderRef.current = null;
    };
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
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
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
      recorder.start(/* timeslice */ 1000);
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

  return { supported, recording, error, start, stop };
}
