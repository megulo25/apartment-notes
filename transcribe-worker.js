// Speech-to-text that runs entirely in the browser (Whisper via transformers.js).
// The model (~77 MB) downloads once and is then cached by the browser.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm';

const MODEL = 'onnx-community/whisper-base.en';
let asrPromise = null;

function loadModel() {
  if (!asrPromise) {
    asrPromise = pipeline('automatic-speech-recognition', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: p => self.postMessage({ type: 'progress', data: p }),
    }).catch(err => { asrPromise = null; throw err; });
  }
  return asrPromise;
}

self.onmessage = async ({ data }) => {
  const { id, audio } = data;
  try {
    const asr = await loadModel();
    self.postMessage({ type: 'status', id, status: 'transcribing' });
    const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(out) ? out.map(o => o.text).join(' ') : out.text) || '';
    self.postMessage({ type: 'done', id, text: text.trim() });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err?.message || String(err) });
  }
};
