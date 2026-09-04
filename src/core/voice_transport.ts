import { sanitizeServerText, type ApiClient } from "./transport.js";
import {
  VOICE_STT_PATH,
  VOICE_TTS_PATH,
  type CapturedAudio,
  type SynthesizedAudio,
  type VoiceContextHints,
  type VoiceProfile,
  type VoiceTransport,
} from "./voice.js";

export const MAX_VOICE_HINT_TERMS = 48;
export const MAX_VOICE_HINT_CHARS = 900;

export class VoiceProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceProtocolError";
  }
}

function cancelRejectedVoiceBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // A locked or already-consumed stream is already outside our ownership.
  }
}

function rejectVoiceResponse(response: Response, message: string): never {
  cancelRejectedVoiceBody(response);
  throw new VoiceProtocolError(message);
}

function isNoStore(cacheControl: string | null): boolean {
  return cacheControl
    ?.split(",")
    .some((directive) => directive.trim().toLocaleLowerCase("en-US") === "no-store") ?? false;
}

/** Match Cloud's compact hint format without sending the pronunciation map or
 * an unbounded view of terminal state on every utterance. */
export function serializeVoiceHints(hints: VoiceContextHints | undefined): string {
  if (!hints) return "";
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of hints.terms) {
    const term = raw.trim();
    if (!term || term.length > 48) continue;
    const key = term.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_VOICE_HINT_TERMS) break;
  }
  const parts: string[] = [];
  const situation = hints.situation?.trim().slice(0, 200);
  if (situation) parts.push(situation);
  if (terms.length) parts.push(`Likely vocabulary: ${terms.join(", ")}`);
  return parts.join(". ").slice(0, MAX_VOICE_HINT_CHARS);
}

function safeFilename(audio: CapturedAudio): string {
  const fallback = audio.mime.includes("wav") ? "clip.wav" : audio.mime.includes("ogg") ? "clip.ogg" : "clip.webm";
  const candidate = audio.filename?.trim();
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(candidate) ? candidate : fallback;
}

/** Thin host adapter over Cloud's authoritative Voice routes. It never accepts
 * provider names or credentials: Cloud retains routing, fallback, gates, and
 * billing ownership. HttpError status 401/402/413/5xx remains available to the
 * controller so STT failure and optional TTS degradation can diverge. */
export class CloudVoiceTransport implements VoiceTransport {
  constructor(
    private readonly api: ApiClient,
    private readonly timeoutMs?: number,
  ) {}

  async transcribe(
    audio: CapturedAudio,
    options: { signal: AbortSignal; hints?: VoiceContextHints },
  ): Promise<string> {
    if (audio.bytes.byteLength === 0) throw new VoiceProtocolError("cannot transcribe an empty recording");
    if (!Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0) {
      throw new VoiceProtocolError("recording duration must be positive");
    }
    const form = new FormData();
    form.append("audio", new Blob([Uint8Array.from(audio.bytes)], { type: audio.mime }), safeFilename(audio));
    form.append("duration_s", String(audio.durationSeconds));
    const hints = serializeVoiceHints(options.hints);
    if (hints) form.append("hints", hints);

    const body = await this.api.postForm<{ text?: unknown }>(VOICE_STT_PATH, form, options.signal, this.timeoutMs);
    if (!body || typeof body.text !== "string") {
      throw new VoiceProtocolError("transcription response did not contain text");
    }
    return body.text;
  }

  async synthesize(
    text: string,
    options: {
      signal: AbortSignal;
      voice: VoiceProfile;
      purpose: "conversation" | "chat" | "expressive" | "narration";
    },
  ): Promise<SynthesizedAudio> {
    const speakable = text.trim();
    if (!speakable) throw new VoiceProtocolError("cannot synthesize empty text");
    const response = await this.api.postJsonBinary(
      VOICE_TTS_PATH,
      { text: speakable, voice: options.voice, purpose: options.purpose },
      options.signal,
      this.timeoutMs,
    );
    const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "audio/mpeg";
    if (!mime.toLocaleLowerCase("en-US").startsWith("audio/")) {
      return rejectVoiceResponse(response, "speech response was not audio");
    }
    const model = sanitizeServerText(response.headers.get("x-aether-voice-model") ?? "");
    if (!model) {
      return rejectVoiceResponse(response, "speech response did not include model provenance");
    }
    if (!isNoStore(response.headers.get("cache-control"))) {
      return rejectVoiceResponse(response, "speech response was not marked no-store");
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime,
      model,
    };
  }
}
