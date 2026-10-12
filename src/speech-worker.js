import { FixedVoiceEngine } from './speech-engine.js';

let engine, busy = false;
self.onmessage = async event => {
  const { id, type, baseUrl, voiceUrl, text } = event.data;
  if (!Number.isSafeInteger(id) || busy) {
    self.postMessage({ type: 'error', id, message: 'Die Stimme verarbeitet bereits eine Durchsage.' });
    return;
  }
  busy = true;
  const progress = (message, progress) => self.postMessage({ type: 'progress', id, message, progress });
  try {
    if (type === 'load') {
      if (!engine) {
        const candidate = new FixedVoiceEngine();
        try {
          const details = await candidate.load(baseUrl, voiceUrl, progress);
          engine = candidate;
          self.postMessage({ type: 'ready', id, ...details });
        } catch (error) { await candidate.dispose(); throw error; }
      } else self.postMessage({ type: 'ready', id });
    } else if (type === 'generate' && engine) {
      const result = await engine.generate(text, progress);
      self.postMessage({ type: 'result', id, ...result }, [result.samples.buffer]);
    } else throw Error('Die Stimme wurde noch nicht geladen.');
  } catch (error) {
    console.error(error);
    self.postMessage({ type: 'error', id, message: error.message || 'Die Stimme konnte in diesem Browser nicht gestartet werden.' });
  } finally { busy = false; }
};
