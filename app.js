import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

const $ = id => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');
const processCanvas = document.createElement('canvas');
const pctx = processCanvas.getContext('2d', { willReadFrequently: true });
const CARD_MM = 85.6;

let stream = null;
let facing = 'user';
let landmarker = null;
let running = false;
let lastFace = 0;
let lastCard = 0;
let face = null;
let card = null;
let samples = [];
let recent = [];
let lastAccepted = 0;
let audio = null;
let cardWorker = null;
let cardReady = false;
let cardBusy = false;
let loaderTimer = null;
let loaderStarted = 0;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

function getContainRect(srcW, srcH, dstW, dstH) {
  if (!srcW || !srcH || !dstW || !dstH) return { x: 0, y: 0, width: dstW, height: dstH, scale: 1 };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return {
    x: (dstW - width) / 2,
    y: (dstH - height) / 2,
    width,
    height,
    scale,
  };
}

function mapPoint(p) {
  const rect = getContainRect(processCanvas.width, processCanvas.height, overlay.width, overlay.height);
  return {
    x: rect.x + (p.x / processCanvas.width) * rect.width,
    y: rect.y + (p.y / processCanvas.height) * rect.height,
  };
}

function loadSamples() {
  samples = [];
  renderAverage();
}

function renderAverage() {
  if (!samples.length) {
    $('average').textContent = '–';
    $('sampleCount').textContent = 'aktuális oldalbetöltés: 0';
    return;
  }
  $('average').textContent = mean(samples.map(x => x.total)).toFixed(1);
  $('sampleCount').textContent = `aktuális oldalbetöltés: ${samples.length}`;
}

function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(.001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(.13, audio.currentTime + .02);
    g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .18);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + .2);
  } catch {}
}

function showLoader(step, detail) {
  loaderStarted = Date.now();
  $('loader').classList.remove('hidden');
  setLoader(step, detail);
  clearInterval(loaderTimer);
  loaderTimer = setInterval(() => {
    $('loaderElapsed').textContent = `Eltelt idő: ${Math.floor((Date.now() - loaderStarted) / 1000)} mp`;
  }, 300);
}

function setLoader(step, detail) {
  $('loaderStep').textContent = step;
  $('loaderDetail').textContent = detail || '';
}

function hideLoader() {
  clearInterval(loaderTimer);
  $('loader').classList.add('hidden');
}

async function initCardWorker() {
  if (cardWorker) return;
  setLoader('Kártyafelismerő indítása', 'Kis, saját JavaScript-felismerő indul háttérszálon.');
  await paint();
  await new Promise((resolve, reject) => {
    cardWorker = new Worker('./card-worker.js');
    const timeout = setTimeout(() => reject(new Error('A kártyafelismerő nem indult el.')), 5000);
    cardWorker.onmessage = e => {
      if (e.data.type === 'ready') {
        cardReady = true;
        clearTimeout(timeout);
        resolve();
      } else if (e.data.type === 'result') {
        card = e.data.card;
        cardBusy = false;
      } else if (e.data.type === 'error') {
        cardBusy = false;
      }
    };
    cardWorker.onerror = () => reject(new Error('A kártyafelismerő háttérszála leállt.'));
  });
}

async function loadFaceModel() {
  if (landmarker) return;
  setLoader('Arcmodell letöltése', 'MediaPipe WASM és a Face Landmarker modell töltődik. Ez az egyetlen nagyobb letöltés.');
  await paint();
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
  setLoader('Arcmodell inicializálása', 'A modell a telefonon indul. Első alkalommal ez pár másodperc lehet.');
  await paint();
  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numFaces: 1
  });
}

async function openCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: facing,
      width: { ideal: 1920 },
      height: { ideal: 1440 },
      aspectRatio: { ideal: 4 / 3 }
    },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  document.querySelector('.viewer').classList.toggle('environment', facing === 'environment');
  $('start').classList.add('hidden');
  $('stop').classList.remove('hidden');
  $('flip').disabled = false;
}

async function start() {
  try {
    $('start').disabled = true;
    samples = [];
    renderAverage();
    stop(false);
    $('message').textContent = 'Kameraengedély kérése…';
    await openCamera();
    $('message').textContent = 'A kamera működik. A felismerők töltődnek a háttérben…';
    showLoader('Felismerők előkészítése', 'A kamera már él. Először a kártyafelismerő, utána az arcmodell indul.');
    await initCardWorker();
    await loadFaceModel();
    hideLoader();
    $('message').textContent = 'Tartsd a fejedet a kereten belül, és a bankkártyát az arcod mellé.';
    $('quality').textContent = 'Arc és bankkártya keresése';
    running = true;
    recent = [];
    requestAnimationFrame(loop);
  } catch (e) {
    hideLoader();
    stop(false);
    $('message').textContent = `Nem indítható: ${e.message}`;
    $('quality').textContent = 'Indítási hiba';
    $('start').disabled = false;
  }
}

function stop(show = true) {
  running = false;
  face = null;
  card = null;
  recent = [];
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  $('start').classList.remove('hidden');
  $('stop').classList.add('hidden');
  $('start').disabled = false;
  $('flip').disabled = true;
  if (show) {
    $('quality').textContent = 'Kamera leállítva';
    $('message').textContent = 'Nyomd meg az indítást az új méréshez.';
  }
}

async function flip() {
  facing = facing === 'user' ? 'environment' : 'user';
  stop(false);
  await start();
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  const pw = 360;
  const ph = Math.round(pw * h / w);
  if (processCanvas.width !== pw || processCanvas.height !== ph) {
    processCanvas.width = pw;
    processCanvas.height = ph;
  }
}

function drawVideoContain() {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  const dw = processCanvas.width;
  const dh = processCanvas.height;
  if (!sw || !sh) return;

  const rect = getContainRect(sw, sh, dw, dh);
  pctx.save();
  pctx.clearRect(0, 0, dw, dh);
  if (facing === 'user') {
    pctx.translate(dw, 0);
    pctx.scale(-1, 1);
  }
  pctx.drawImage(video, 0, 0, sw, sh, rect.x, rect.y, rect.width, rect.height);
  pctx.restore();
}

function detectFace(now) {
  const result = landmarker.detectForVideo(processCanvas, now);
  const lm = result.faceLandmarks?.[0];
  if (!lm) {
    face = null;
    return;
  }
  const px = i => ({ x: lm[i].x * processCanvas.width, y: lm[i].y * processCanvas.height });
  const ap = ids => ({ x: mean(ids.map(i => px(i).x)), y: mean(ids.map(i => px(i).y)) });
  const a = ap([468, 469, 470, 471, 472]);
  const b = ap([473, 474, 475, 476, 477]);
  const eyes = [a, b].sort((x, y) => x.x - y.x);
  face = { left: eyes[0], right: eyes[1], nose: px(168) };
}

function requestCard() {
  if (!cardReady || cardBusy) return;
  cardBusy = true;
  const image = pctx.getImageData(0, 0, processCanvas.width, processCanvas.height);
  cardWorker.postMessage({ type: 'detect', width: image.width, height: image.height, buffer: image.data.buffer }, [image.data.buffer]);
}

function calculate() {
  if (!face || !card) return null;
  const scale = CARD_MM / card.width;
  const total = dist(face.left, face.right) * scale;
  const right = Math.abs(face.nose.x - face.left.x) * scale;
  const left = Math.abs(face.right.x - face.nose.x) * scale;
  if (total < 50 || total > 80 || right < 24 || right > 42 || left < 24 || left > 42) return null;
  const tilt = Math.abs(face.left.y - face.right.y) / dist(face.left, face.right);
  if (tilt > .09) return null;
  return { total, right, left };
}

function drawGuides() {
  const w = overlay.width;
  const h = overlay.height;
  const rect = getContainRect(video.videoWidth || 1, video.videoHeight || 1, w, h);
  const centerX = rect.x + rect.width * .5;
  const faceWidth = Math.min(rect.width * .44, 280 * (w / 390));
  const faceHeight = Math.min(rect.height * .40, 360 * (h / 844));
  const faceY = rect.y + rect.height * .36;
  const eyeY = faceY;
  const cardWidth = Math.min(rect.width * .28, 180 * (w / 390));
  const cardHeight = cardWidth / 1.586;
  const cardX = centerX + faceWidth * .62;
  const cardY = faceY + faceHeight * .02;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(2, w / 320);
  ctx.beginPath();
  ctx.ellipse(centerX, faceY, faceWidth / 2, faceHeight / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = 'rgba(96,165,250,0.8)';
  ctx.beginPath();
  ctx.moveTo(centerX - faceWidth * .42, eyeY);
  ctx.lineTo(centerX + faceWidth * .42, eyeY);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(251,191,36,0.9)';
  ctx.strokeRect(cardX - cardWidth / 2, cardY - cardHeight / 2, cardWidth, cardHeight);
  ctx.setLineDash([]);

  const font = `${Math.max(16, w / 26)}px system-ui`;
  ctx.font = `700 ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.textAlign = 'center';
  ctx.fillText('SZEMVONAL', centerX, eyeY - 14);
  ctx.fillStyle = 'rgba(251,191,36,0.95)';
  ctx.fillText('KÁRTYA HELYE', cardX, cardY - cardHeight / 2 - 12);
  ctx.font = `600 ${Math.max(14, w / 32)}px system-ui`;
  ctx.fillStyle = 'rgba(251,191,36,0.95)';
  ctx.fillText('érintsd az arcodhoz', cardX, cardY + cardHeight / 2 + 24);
  ctx.restore();
}

function draw(result) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  drawGuides();
  ctx.lineWidth = Math.max(3, overlay.width / 250);
  ctx.font = `700 ${Math.max(20, overlay.width / 25)}px system-ui`;
  ctx.textAlign = 'center';

  if (card) {
    const q = card.points.map(mapPoint);
    ctx.strokeStyle = '#fbbf24';
    ctx.beginPath();
    q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
  }

  if (face) {
    const a = mapPoint(face.left);
    const b = mapPoint(face.right);
    ctx.strokeStyle = result ? '#22c55e' : '#ef4444';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    [a, b].forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    if (result) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const text = `${result.total.toFixed(1)} mm`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = '#07110cdd';
      ctx.fillRect(m.x - tw / 2 - 10, m.y - 44, tw + 20, 34);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, m.x, m.y - 18);
    }
  }
}

function updateUi(result) {
  if (result) {
    $('pd').textContent = result.total.toFixed(1);
    $('rightPd').textContent = result.right.toFixed(1);
    $('leftPd').textContent = result.left.toFixed(1);
    $('quality').textContent = 'Stabil mérés keresése…';
    recent.push({ ...result, t: performance.now() });
    recent = recent.filter(x => performance.now() - x.t < 1800);
    if (recent.length >= 7) {
      const vals = recent.map(x => x.total);
      const spread = Math.max(...vals) - Math.min(...vals);
      if (spread <= 1.3) {
        const stable = {
          total: median(vals),
          right: median(recent.map(x => x.right)),
          left: median(recent.map(x => x.left))
        };
        $('quality').textContent = 'Mérés stabil';
        if (Date.now() - lastAccepted > 3500) {
          samples.push(stable);
          samples = samples.slice(-30);
          lastAccepted = Date.now();
          beep();
          renderAverage();
        }
      }
    }
  } else {
    $('pd').textContent = '–';
    $('rightPd').textContent = '–';
    $('leftPd').textContent = '–';
    recent = [];
    if (!face && !card) $('quality').textContent = 'Arc és bankkártya keresése';
    else if (!face) $('quality').textContent = 'Tedd távolabb a telefont, és nézz szemből a kamerába';
    else if (!card) $('quality').textContent = 'Tedd a bankkártyát az arcod mellé, ne a kamera felé';
    else $('quality').textContent = 'Tartsd egyenesen a fejed';
  }
}

function loop(now) {
  if (!running) return;
  resize();
  if (video.readyState >= 2) {
    drawVideoContain();
    if (now - lastFace > 130) {
      detectFace(now);
      lastFace = now;
    }
    if (now - lastCard > 320) {
      requestCard();
      lastCard = now;
    }
    const result = calculate();
    draw(result);
    updateUi(result);
  }
  requestAnimationFrame(loop);
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
$('flip').addEventListener('click', flip);
$('clear').addEventListener('click', () => {
  samples = [];
  renderAverage();
});
window.addEventListener('beforeunload', () => {
  stop(false);
  cardWorker?.terminate();
});
loadSamples();