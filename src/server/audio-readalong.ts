import type { WordTiming } from "../shared/contracts";
import { estimateTimingSpan, estimateWordTimings } from "./audio-timings";

const PCM_SAMPLE_RATE = 24_000;
const PCM_BYTES_PER_SAMPLE = 2;

function pcmBytesToMs(bytes: number) {
  return Math.round((bytes / PCM_BYTES_PER_SAMPLE / PCM_SAMPLE_RATE) * 1000);
}

type PendingTranscript = { text: string; offset: number };
type PendingAudio = { audio: string; startMs: number; endMs: number };

export type AudioReadAlongOutput =
  | { type: "text"; text: string }
  | { type: "timing"; timings: Array<WordTiming>; spans?: Array<WordTiming> }
  | { type: "audio"; audio: string };

export class AudioReadAlongBuilder {
  private spokenText = "";
  private pcmBytes = 0;
  private readonly transcripts: Array<PendingTranscript> = [];
  private readonly audios: Array<PendingAudio> = [];

  readonly timings: Array<WordTiming> = [];
  readonly spans: Array<WordTiming> = [];

  addTranscript(text: string): Array<AudioReadAlongOutput> {
    const transcript = this.addPendingTranscript(text);
    return [
      { type: "text", text },
      ...(this.audios.length ? this.pair(transcript, this.audios.shift()!) : []),
    ];
  }

  addAudio(audio: string, byteLength: number): Array<AudioReadAlongOutput> {
    const pendingAudio = this.addPendingAudio(audio, byteLength);
    const transcript = this.transcripts.shift();
    if (transcript) return this.pair(transcript, pendingAudio);

    this.audios.push(pendingAudio);
    return this.flushOlderUnpairedAudio();
  }

  addAudioTranscript(
    audio: string,
    byteLength: number,
    text: string,
  ): Array<AudioReadAlongOutput> {
    const outputs = this.flushUnpairedAudio();
    this.transcripts.length = 0;
    const pendingAudio = this.addPendingAudio(audio, byteLength);
    const transcript = this.addPendingTranscript(text);
    outputs.push({ type: "text", text }, ...this.pair(transcript, pendingAudio));
    return outputs;
  }

  finish(): Array<AudioReadAlongOutput> {
    return this.flushUnpairedAudio();
  }

  private addPendingTranscript(text: string) {
    const transcript = { text, offset: this.spokenText.length };
    this.spokenText += text;
    this.transcripts.push(transcript);
    return transcript;
  }

  private addPendingAudio(audio: string, byteLength: number) {
    const startMs = pcmBytesToMs(this.pcmBytes);
    this.pcmBytes += byteLength;
    return { audio, startMs, endMs: pcmBytesToMs(this.pcmBytes) };
  }

  private flushOlderUnpairedAudio(): Array<AudioReadAlongOutput> {
    const outputs: Array<AudioReadAlongOutput> = [];
    while (this.audios.length > 1) {
      outputs.push({ type: "audio", audio: this.audios.shift()!.audio });
    }
    return outputs;
  }

  private flushUnpairedAudio(): Array<AudioReadAlongOutput> {
    return this.audios.splice(0).map((audio) => ({
      type: "audio" as const,
      audio: audio.audio,
    }));
  }

  private pair(
    transcript: PendingTranscript,
    audio: PendingAudio,
  ): Array<AudioReadAlongOutput> {
    const transcriptIndex = this.transcripts.indexOf(transcript);
    if (transcriptIndex >= 0) this.transcripts.splice(transcriptIndex, 1);
    const startMs = audio.startMs;
    const endMs = Math.max(audio.startMs + 1, audio.endMs);
    const timings = estimateWordTimings(transcript.text, {
      charOffset: transcript.offset,
      startMs,
      endMs,
    });
    const span = estimateTimingSpan(transcript.text, {
      charOffset: transcript.offset,
      startMs,
      endMs,
    });

    const outputs: Array<AudioReadAlongOutput> = [];
    if (timings.length) {
      this.timings.push(...timings);
      if (span) this.spans.push(span);
      outputs.push({
        type: "timing",
        timings,
        ...(span ? { spans: [span] } : {}),
      });
    }
    outputs.push({ type: "audio", audio: audio.audio });
    return outputs;
  }
}
