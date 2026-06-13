// PCM16 → WAV. Audio-output models stream raw 24 kHz mono PCM16 chunks;
// wrapping the concatenated samples in a 44-byte RIFF header is all it
// takes to make a seekable file for the content store — no encoder needed.
//
// Also: whisper word timestamps for read-along highlighting. OpenRouter
// has no transcription endpoint and chat models can't timestamp reliably,
// so this is the one direct-to-OpenAI call in the app — optional, keyed
// on OPENAI_API_KEY.
import type { RecognizedWord } from "./audio-timings";
import { env } from "./env";

// whisper-1 list price; used to charge the alignment to the ledger.
export const WHISPER_USD_PER_MINUTE = 0.006;

export async function whisperWordTimings(
  wav: Uint8Array,
): Promise<Array<RecognizedWord>> {
  if (!env.OPENAI_API_KEY) return [];

  const form = new FormData();
  form.append("file", new File([wav as BufferSource], "speech.wav", { type: "audio/wav" }));
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`whisper failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    words?: Array<{ word: string; start: number; end: number }>;
  };
  return (payload.words ?? []).filter(
    (word) =>
      typeof word.word === "string" &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end),
  );
}

export function wavFromPcm16(
  pcm: Uint8Array,
  sampleRate = 24_000,
  channels = 1,
) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = sampleRate * channels * 2;

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, pcm.length, true);

  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}
