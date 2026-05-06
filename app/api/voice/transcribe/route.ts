import type { NextRequest } from "next/server";
import { getServerSession } from "@/lib/auth/session";

/**
 * POST audio (multipart form-data, field "audio") + optional "language" hint.
 * Forwards to OpenAI's Whisper API and returns { text }.
 *
 * Web Speech API gives us live preview + wake-word detection in the browser;
 * Whisper gives us the actual high-quality transcript that becomes the
 * Linear ticket. The widget calls this on submit, then forwards Whisper's
 * `text` to /api/voice/capture.
 */

const WHISPER_MODEL = "whisper-1";

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "OPENAI_API_KEY not configured on the server. Add it to your Dokploy env to enable Whisper transcription.",
      },
      { status: 500 },
    );
  }

  let inForm: FormData;
  try {
    inForm = await req.formData();
  } catch (err) {
    return Response.json(
      {
        error:
          "Expected multipart/form-data with an 'audio' file. " +
          (err instanceof Error ? err.message : ""),
      },
      { status: 400 },
    );
  }

  const audio = inForm.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json(
      { error: "Missing 'audio' file in form data" },
      { status: 400 },
    );
  }

  // Whisper requires a filename with a recognized extension. Browsers default
  // to type "audio/webm" (Chrome) or "audio/mp4" (Safari). Map the mime to a
  // sensible extension so OpenAI doesn't reject the upload.
  const ext = (() => {
    const t = audio.type.toLowerCase();
    if (t.includes("webm")) return "webm";
    if (t.includes("ogg")) return "ogg";
    if (t.includes("mp4") || t.includes("m4a")) return "m4a";
    if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
    if (t.includes("wav")) return "wav";
    return "webm";
  })();

  const upstream = new FormData();
  upstream.append(
    "file",
    new File([audio], `voice.${ext}`, { type: audio.type || "audio/webm" }),
  );
  upstream.append("model", WHISPER_MODEL);
  upstream.append("response_format", "json");

  const language = inForm.get("language");
  if (typeof language === "string" && language.trim() && language !== "auto") {
    upstream.append("language", language.trim());
  }

  // Optional vocabulary hint — biases the recognizer toward project-specific
  // jargon. Hardcoded for now; future versions could pull from per-team
  // settings or recent ticket titles.
  upstream.append(
    "prompt",
    "Jupietre, Linear, Dokploy, agent, MCP, Claude, repo, worktree, PR, dashboard.",
  );

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
  } catch (err) {
    return Response.json(
      {
        error: `Failed to reach OpenAI: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      {
        error: `OpenAI returned ${res.status}: ${detail.slice(0, 400) || res.statusText}`,
      },
      { status: 502 },
    );
  }

  let data: { text?: string };
  try {
    data = (await res.json()) as { text?: string };
  } catch {
    return Response.json(
      { error: "OpenAI returned an unparseable response" },
      { status: 502 },
    );
  }

  const text = (data.text ?? "").trim();
  if (!text) {
    return Response.json(
      { error: "Whisper returned an empty transcript — was anything recorded?" },
      { status: 422 },
    );
  }

  return Response.json({ text });
}
