// Voice for the chat page: listen through the microphone, and speak short lines.
// Hearing is done by this site's own server. What is spoken is never the written
// answer: it is a brief acknowledgement, a phrase about what is happening during
// a wait, and one short line made for the ear when the answer is ready.

// Plays short clips one after another; a new recording silences whatever is playing.
export function createPlayer({makeAudio = src => new Audio(src), synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance} = {}) {
  let queue = Promise.resolve(), current = null, generation = 0;
  const playClip = (base64, mine) => new Promise(resolve => {
    if (mine !== generation) return resolve();
    const audio = makeAudio('data:audio/mpeg;base64,' + base64); current = audio;
    audio.onended = audio.onerror = () => { if (current === audio) current = null; resolve(); };
    Promise.resolve(audio.play()).catch(() => { if (current === audio) current = null; resolve(); });
  });
  // Without a server voice, fall back to the browser's own, so the feature still works locally.
  const speakLocally = (text, mine) => new Promise(resolve => {
    if (mine !== generation || !synth || !Utterance) return resolve();
    const utterance = new Utterance(text); utterance.lang = 'en-GB'; utterance.onend = utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
  return {
    say({ audio, text }) { const mine = generation; queue = queue.then(() => audio ? playClip(audio, mine) : text ? speakLocally(text, mine) : null); return queue; },
    stop() { generation++; try { current?.pause(); } catch { /* already stopped */ } current = null; try { synth?.cancel(); } catch { /* nothing speaking */ } queue = Promise.resolve(); },
  };
}

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(Error('The recording could not be read.'));
  reader.readAsDataURL(blob);
});

// Decides when the speaker has finished: after some speech, a stretch of quiet ends the recording.
export function createSilenceWatch({ quietMs = 1300, graceMs = 5000, maxMs = 14000, threshold = 0.018 } = {}) {
  let spoke = false, quietSince = null;
  return function shouldStop(level, elapsedMs) {
    if (elapsedMs >= maxMs) return true;
    if (level >= threshold) { spoke = true; quietSince = null; return false; }
    if (!spoke) return elapsedMs >= graceMs;          // nothing said at all: give up
    quietSince ??= elapsedMs;
    return elapsedMs - quietSince >= quietMs;
  };
}

// One recording: resolves with {audio, mime} when the speaker stops (or stop() is called), or null if nothing was captured.
export async function record({ media = navigator.mediaDevices, Recorder = globalThis.MediaRecorder, AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext, onLevel = () => {}, watch = createSilenceWatch() } = {}) {
  if (!media?.getUserMedia || !Recorder) throw Error('This browser cannot record audio.');
  let stream;
  try { stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
  catch (error) { throw Error(error.name === 'NotAllowedError' ? 'The microphone is blocked for this page. Allow it in the browser’s address bar and try again.' : 'No microphone was found.'); }
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => Recorder.isTypeSupported(type));
  if (!mime) { stream.getTracks().forEach(track => track.stop()); throw Error('This browser cannot record in a format the server reads.'); }
  const recorder = new Recorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 }), chunks = [];
  let context = null, timer = null;
  const finished = new Promise(resolve => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      clearInterval(timer); stream.getTracks().forEach(track => track.stop()); try { await context?.close(); } catch { /* already closed */ }
      const blob = new Blob(chunks, { type: mime });
      resolve(blob.size < 800 ? null : { audio: await blobToBase64(blob), mime });
    };
  });
  const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  recorder.start(200);
  if (AudioCtx) {
    try {
      context = new AudioCtx();
      const analyser = context.createAnalyser(); analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize), started = performance.now();
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0; for (const s of samples) sum += s * s;
        const level = Math.sqrt(sum / samples.length);
        onLevel(level);
        if (watch(level, performance.now() - started)) stop();
      }, 100);
    } catch { /* no level meter: the user stops the recording by hand */ }
  }
  return { finished, stop };
}
