// One entry point for attaching files to the next message, used by the
// composer's attach button, paste, and drag-and-drop onto the chat.
// Images get the two-tier prepare (capped original + inline thumbnail);
// audio files become 16 kHz WAV voice notes (one per message).
import { audioToWavDataUrl } from "./audio";
import { updateUi } from "./db";
import { prepareImage } from "./images";

const MAX_ATTACHMENTS = 4;
const MAX_AUDIO_BYTES = 25_000_000;

export async function attachFiles(files: Iterable<File>) {
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      const prepared = await prepareImage(file).catch(() => undefined);
      if (!prepared) continue;
      updateUi((state) => {
        if (state.composerImages.length >= MAX_ATTACHMENTS) return;
        state.composerImages = [...state.composerImages, prepared];
      });
    } else if (file.type.startsWith("audio/")) {
      if (file.size > MAX_AUDIO_BYTES) continue;
      const recording = await audioToWavDataUrl(file).catch(() => undefined);
      if (!recording) continue;
      updateUi((state) => {
        state.composerAudio = recording;
      });
    }
  }
}
