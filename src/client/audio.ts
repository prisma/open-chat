// Audio in the browser: live playback of streamed model speech, and
// microphone dictation encoded to WAV.
//
// Live playback consumes message.audio.delta events straight off the SSE
// feed — base64 PCM16 chunks (24 kHz mono) scheduled gaplessly on an
// AudioContext. Replay-after uses the assembled WAV from the content store
// through a plain <audio> element instead.

const PCM_SAMPLE_RATE = 24_000;
const DICTATION_SAMPLE_RATE = 16_000;

let context: AudioContext | undefined;
let liveMessageId = "";
let nextStartTime = 0;
let liveSources: Array<AudioBufferSourceNode> = [];

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function enqueueLiveAudio(messageId: string, base64Pcm: string) {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  if (liveMessageId !== messageId) {
    stopLiveAudio();
    liveMessageId = messageId;
    nextStartTime = context.currentTime;
  }

  const bytes = base64ToBytes(base64Pcm);
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const buffer = context.createBuffer(1, pcm.length, PCM_SAMPLE_RATE);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i]! / 32768;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const at = Math.max(context.currentTime, nextStartTime);
  source.start(at);
  nextStartTime = at + buffer.duration;
  liveSources.push(source);
  source.onended = () => {
    liveSources = liveSources.filter((s) => s !== source);
  };
}

export function stopLiveAudio() {
  for (const source of liveSources) {
    try {
      source.stop();
    } catch {
      // already ended
    }
  }
  liveSources = [];
  liveMessageId = "";
}

// ---- Dictation ----------------------------------------------------------

export type Recording = { dataUrl: string; durationMs: number };

function wavFromSamples(samples: Float32Array, sampleRate: number) {
  const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      wav.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  wav.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  ascii(36, "data");
  wav.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    wav.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  let binary = "";
  const bytes = new Uint8Array(wav.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** Decode any audio blob/file and re-encode as 16 kHz mono WAV. */
export async function audioToWavDataUrl(blob: Blob): Promise<Recording> {
  const decodeContext = new AudioContext();
  try {
    const decoded = await decodeContext.decodeAudioData(
      await blob.arrayBuffer(),
    );
    const length = Math.ceil(decoded.duration * DICTATION_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, length, DICTATION_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return {
      dataUrl: wavFromSamples(
        rendered.getChannelData(0),
        DICTATION_SAMPLE_RATE,
      ),
      durationMs: Math.round(decoded.duration * 1000),
    };
  } finally {
    void decodeContext.close();
  }
}

export type Dictation = { stop(): Promise<Recording>; cancel(): void };

export async function startDictation(): Promise<Dictation> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Array<Blob> = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.start();

  const teardown = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop: () =>
      new Promise<Recording>((resolve, reject) => {
        recorder.onstop = () => {
          teardown();
          audioToWavDataUrl(new Blob(chunks, { type: recorder.mimeType }))
            .then(resolve, reject);
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // never started
      }
      teardown();
    },
  };
}
