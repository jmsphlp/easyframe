/* ============================================================
   EasyFrame - Core logic
   - Photos: render with Canvas API
   - Videos: re-encode with MediaRecorder (broadest support)
   - Everything client-side, no uploads
   ============================================================ */

// ---------- State ----------
const state = {
  file: null,
  files: [],
  previewUrls: [],
  type: null,            // 'image' | 'video'
  source: null,          // HTMLImageElement | HTMLVideoElement
  ratio: '1:1',          // 'original' | 'W:H'
  color: '#ffffff',
  borderPct: 8,          // 0..40, percent of shorter side
  quality: 'balanced',   // 'high' | 'balanced' | 'small'
  exporting: false,
};

const qualitySettings = {
  high: { imageType: 'image/png', imageQuality: undefined, imageExt: 'png', videoBitrate: 16_000_000 },
  balanced: { imageType: 'image/jpeg', imageQuality: 0.95, imageExt: 'jpg', videoBitrate: 8_000_000 },
  small: { imageType: 'image/jpeg', imageQuality: 0.82, imageExt: 'jpg', videoBitrate: 4_000_000 },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const landing = $('landing');
const editor = $('editor');
const typedText = $('typedText');
const fileInput = $('fileInput');
const canvas = $('previewCanvas');
const video = $('previewVideo');
const batchPreview = $('batchPreview');
const ratioGrid = $('ratioGrid');
const colorRow = document.querySelector('.color-row');
const customColor = $('customColor');
const slider = $('borderSlider');
const borderValue = $('borderValue');
const qualityGrid = $('qualityGrid');
const exportBtn = $('exportBtn');
const shareBtn = $('shareBtn');
const resetBtn = $('resetBtn');
const installBtn = $('installBtn');
const selectionSummary = $('selectionSummary');
const landingStatus = $('landingStatus');
const statusEl = $('status');
const ctx = canvas.getContext('2d');

// ---------- Hero typing ----------
const heroTitles = [
  'Borders for photos and videos',
  'Frame every post without cropping',
  'Batch-ready photo exports',
  'Private edits, polished outputs',
];
let heroTitleIndex = 0;
let typedIndex = 0;
let isDeleting = false;

typedText.textContent = '';

function typeHeroTitle() {
  const currentTitle = heroTitles[heroTitleIndex];
  typedText.textContent = currentTitle.slice(0, typedIndex);

  if (!isDeleting && typedIndex < currentTitle.length) {
    typedIndex += 1;
    setTimeout(typeHeroTitle, 55);
    return;
  }

  if (!isDeleting) {
    isDeleting = true;
    setTimeout(typeHeroTitle, 1400);
    return;
  }

  if (typedIndex > 0) {
    typedIndex -= 1;
    setTimeout(typeHeroTitle, 28);
    return;
  }

  isDeleting = false;
  heroTitleIndex = (heroTitleIndex + 1) % heroTitles.length;
  setTimeout(typeHeroTitle, 250);
}

typeHeroTitle();

// ---------- File picker ----------
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  await loadFiles(files);
});

async function loadFiles(files) {
  const hasVideo = files.some((file) => file.type.startsWith('video/'));
  const hasImage = files.some((file) => file.type.startsWith('image/'));
  const hasUnsupported = files.some((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'));

  if (hasUnsupported) {
    setLandingStatus('Unsupported file type', 'error');
    return;
  }

  if (files.length > 1 && hasVideo) {
    setLandingStatus('Videos are single-file only. Select one video, or select multiple photos.', 'error');
    fileInput.value = '';
    return;
  }

  if (!hasImage && !hasVideo) return;
  await loadFile(files[0], files);
}

async function loadFile(file, files = [file]) {
  state.file = file;
  state.files = files;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');

  if (!isVideo && !isImage) {
    setStatus('Unsupported file type', 'error');
    return;
  }

  state.type = isVideo ? 'video' : 'image';
  selectionSummary.textContent = getSelectionSummary();
  setLandingStatus('');

  // Tear down previous
  if (state.source && state.source.src?.startsWith('blob:')) {
    URL.revokeObjectURL(state.source.src);
  }
  clearPreviewUrls();

  const url = URL.createObjectURL(file);

  if (isImage) {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => new Promise((r) => (img.onload = r)));
    state.source = img;
    video.hidden = true;
    canvas.hidden = false;
    renderBatchPreview();
  } else {
    video.src = url;
    video.hidden = false;
    canvas.hidden = false;
    await new Promise((res) => {
      video.onloadedmetadata = res;
    });
    video.play().catch(() => {}); // autoplay best-effort
    state.source = video;
    batchPreview.hidden = true;
  }

  landing.hidden = true;
  editor.hidden = false;
  setStatus(state.type === 'image' && state.files.length > 1 ? `Previewing first photo. Export will process ${state.files.length} photos.` : '');
  renderPreview();

  if (state.type === 'video') {
    // Keep canvas in sync with video frames
    requestAnimationFrame(syncVideoFrame);
  }
}

function syncVideoFrame() {
  if (state.type !== 'video' || !state.source) return;
  renderPreview();
  requestAnimationFrame(syncVideoFrame);
}

// ---------- Border math ----------
// Given source dimensions and target ratio, compute the output canvas size
// and the position of the source within it. We ADD pixels, never crop.
function computeFrame(srcW, srcH) {
  let targetRatio;
  if (state.ratio === 'original') {
    targetRatio = srcW / srcH;
  } else {
    const [w, h] = state.ratio.split(':').map(Number);
    targetRatio = w / h;
  }

  const srcRatio = srcW / srcH;

  // Start with a canvas that fits the source plus border on the shorter axis
  const shorter = Math.min(srcW, srcH);
  const borderPx = (state.borderPct / 100) * shorter;

  // Source + symmetrical borders
  let canvasW = srcW + borderPx * 2;
  let canvasH = srcH + borderPx * 2;

  // Now extend whichever axis is too short to hit the target ratio.
  // (We never shrink — that would crop the source.)
  const currentRatio = canvasW / canvasH;

  if (currentRatio < targetRatio) {
    // Need wider canvas — extend width
    canvasW = canvasH * targetRatio;
  } else if (currentRatio > targetRatio) {
    // Need taller canvas — extend height
    canvasH = canvasW / targetRatio;
  }

  const offsetX = (canvasW - srcW) / 2;
  const offsetY = (canvasH - srcH) / 2;

  return {
    canvasW: Math.round(canvasW),
    canvasH: Math.round(canvasH),
    offsetX: Math.round(offsetX),
    offsetY: Math.round(offsetY),
  };
}

// ---------- Preview rendering ----------
function renderPreview() {
  if (!state.source) return;

  const src = state.source;
  const srcW = state.type === 'image' ? src.naturalWidth : src.videoWidth;
  const srcH = state.type === 'image' ? src.naturalHeight : src.videoHeight;
  if (!srcW || !srcH) return;

  const frame = computeFrame(srcW, srcH);

  // For preview we cap dimensions so we're not painting 8000px canvases every frame
  const maxPreview = 1400;
  const previewScale = Math.min(1, maxPreview / Math.max(frame.canvasW, frame.canvasH));
  const pw = Math.round(frame.canvasW * previewScale);
  const ph = Math.round(frame.canvasH * previewScale);

  canvas.width = pw;
  canvas.height = ph;

  ctx.fillStyle = state.color;
  ctx.fillRect(0, 0, pw, ph);

  ctx.drawImage(
    src,
    frame.offsetX * previewScale,
    frame.offsetY * previewScale,
    srcW * previewScale,
    srcH * previewScale
  );
}

// ---------- Controls ----------
ratioGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.ratio-btn');
  if (!btn) return;
  ratioGrid.querySelectorAll('.ratio-btn').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  state.ratio = btn.dataset.ratio;
  renderPreview();
});

colorRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatch:not(.swatch-custom)');
  if (!btn) return;
  colorRow.querySelectorAll('.swatch').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  state.color = btn.dataset.color;
  renderPreview();
});

customColor.addEventListener('input', (e) => {
  state.color = e.target.value;
  colorRow.querySelectorAll('.swatch').forEach((b) => b.classList.remove('is-active'));
  customColor.closest('.swatch').classList.add('is-active');
  renderPreview();
});

slider.addEventListener('input', (e) => {
  state.borderPct = Number(e.target.value);
  borderValue.textContent = `${state.borderPct}%`;
  renderPreview();
});

qualityGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.quality-btn');
  if (!btn) return;
  qualityGrid.querySelectorAll('.quality-btn').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  state.quality = btn.dataset.quality;
});

resetBtn.addEventListener('click', () => {
  if (state.source?.src?.startsWith('blob:')) URL.revokeObjectURL(state.source.src);
  clearPreviewUrls();
  if (state.type === 'video') video.pause();
  state.file = null;
  state.files = [];
  state.source = null;
  state.type = null;
  selectionSummary.textContent = 'Adjust the final canvas without cropping your original media.';
  editor.hidden = true;
  landing.hidden = false;
  fileInput.value = '';
  batchPreview.replaceChildren();
  batchPreview.hidden = true;
  setStatus('');
});

batchPreview.addEventListener('click', async (e) => {
  const btn = e.target.closest('.batch-thumb');
  if (!btn || state.exporting) return;

  const index = Number(btn.dataset.index);
  const file = state.files[index];
  if (!file) return;

  if (state.source?.src?.startsWith('blob:')) URL.revokeObjectURL(state.source.src);

  state.file = file;
  state.source = await loadImageElement(file);
  batchPreview.querySelectorAll('.batch-thumb').forEach((thumb) => thumb.classList.remove('is-active'));
  btn.classList.add('is-active');
  renderPreview();
});

// ---------- Export ----------
exportBtn.addEventListener('click', async () => {
  if (!state.source || state.exporting) return;
  state.exporting = true;
  setExporting(true);
  try {
    if (state.type === 'image') {
      await exportImages();
    } else {
      await exportVideo();
    }
  } catch (err) {
    console.error(err);
    setStatus(`Export failed: ${err.message}`, 'error');
  } finally {
    state.exporting = false;
    setExporting(false);
  }
});

async function exportImages() {
  if (state.files.length <= 1) {
    const { blob, filename } = await renderImageFile(state.file);
    await deliverFile(blob, filename);
    setStatus('Exported.', 'success');
    return;
  }

  for (let i = 0; i < state.files.length; i += 1) {
    setStatus(`Exporting photo ${i + 1} of ${state.files.length}...`);
    const { blob, filename } = await renderImageFile(state.files[i]);
    await deliverFile(blob, filename, { share: false });
  }

  setStatus(`Exported ${state.files.length} photos.`, 'success');
}

async function renderImageFile(file) {
  const src = file === state.file ? state.source : await loadImageElement(file);
  const blob = await renderImageBlob(src);
  const filename = makeFilename(qualitySettings[state.quality].imageExt, file);

  if (src !== state.source && src.src?.startsWith('blob:')) {
    URL.revokeObjectURL(src.src);
  }

  return { blob, filename };
}

function renderBatchPreview() {
  batchPreview.replaceChildren();

  if (state.type !== 'image' || state.files.length <= 1) {
    batchPreview.hidden = true;
    return;
  }

  state.previewUrls = state.files.map((file) => URL.createObjectURL(file));

  state.files.forEach((file, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'batch-thumb' + (index === 0 ? ' is-active' : '');
    btn.dataset.index = String(index);
    btn.setAttribute('aria-label', `Preview ${file.name}`);

    const img = document.createElement('img');
    img.src = state.previewUrls[index];
    img.alt = '';

    const label = document.createElement('span');
    label.textContent = file.name;

    btn.append(img, label);
    batchPreview.append(btn);
  });

  batchPreview.hidden = false;
}

function clearPreviewUrls() {
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls = [];
}

async function loadImageElement(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode().catch(() => new Promise((resolve) => (img.onload = resolve)));
  return img;
}

async function renderImageBlob(image) {
  const srcW = image.naturalWidth;
  const srcH = image.naturalHeight;
  const frame = computeFrame(srcW, srcH);

  // Full-resolution offscreen canvas
  const out = document.createElement('canvas');
  out.width = frame.canvasW;
  out.height = frame.canvasH;
  const octx = out.getContext('2d');

  octx.fillStyle = state.color;
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(image, frame.offsetX, frame.offsetY, srcW, srcH);

  const quality = qualitySettings[state.quality];
  return await new Promise((res) => out.toBlob(res, quality.imageType, quality.imageQuality));
}

async function exportVideo() {
  const src = state.source;
  const srcW = src.videoWidth;
  const srcH = src.videoHeight;
  const frame = computeFrame(srcW, srcH);

  setStatus('Encoding video…');

  // We render each frame onto an offscreen canvas, capture its stream,
  // and feed it to MediaRecorder. The original audio track is attached.
  const out = document.createElement('canvas');
  out.width = frame.canvasW;
  out.height = frame.canvasH;
  const octx = out.getContext('2d');

  // Audio from original
  const audioTracks = src.captureStream ? src.captureStream().getAudioTracks() : [];

  // Restart video for clean export pass
  src.pause();
  src.currentTime = 0;
  await new Promise((r) => (src.onseeked = r));

  const fps = 30;
  const videoStream = out.captureStream(fps);
  audioTracks.forEach((t) => videoStream.addTrack(t));

  // Pick the best supported mime type
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const videoBitrate = qualitySettings[state.quality].videoBitrate;
  const recorder = new MediaRecorder(videoStream, mimeType ? { mimeType, videoBitsPerSecond: videoBitrate } : { videoBitsPerSecond: videoBitrate });

  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const stopped = new Promise((res) => (recorder.onstop = res));
  recorder.start(100);

  // Drive playback + paint frames
  src.play();

  let lastT = -1;
  await new Promise((resolve) => {
    const draw = () => {
      if (src.ended) {
        resolve();
        return;
      }
      if (src.currentTime !== lastT) {
        octx.fillStyle = state.color;
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(src, frame.offsetX, frame.offsetY, srcW, srcH);
        lastT = src.currentTime;
      }
      requestAnimationFrame(draw);
    };
    draw();
  });

  recorder.stop();
  await stopped;

  const extension = (mimeType.includes('mp4') ? 'mp4' : 'webm');
  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  const filename = makeFilename(extension);
  await deliverFile(blob, filename);
  setStatus(`Exported (${(blob.size / 1024 / 1024).toFixed(1)} MB).`, 'success');

  src.pause();
  src.currentTime = 0;
  src.play().catch(() => {});
}

function makeFilename(ext, file = state.file) {
  const base = file?.name?.replace(/\.[^.]+$/, '') || 'easyframe';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}-framed-${stamp}.${ext}`;
}

function getSelectionSummary() {
  if (state.type === 'image' && state.files.length > 1) {
    return `${state.files.length} photos selected. Preview shows the first photo; export applies these settings to all.`;
  }

  return 'Adjust the final canvas without cropping your original media.';
}

// Use Web Share API on iOS where supported (it offers Save to Photos),
// fall back to a download anchor.
async function deliverFile(blob, filename, options = {}) {
  const file = new File([blob], filename, { type: blob.type });

  if (options.share !== false && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- UI helpers ----------
function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ` is-${kind}` : '');
}

function setLandingStatus(msg, kind = '') {
  landingStatus.textContent = msg;
  landingStatus.className = 'landing-status' + (kind ? ` is-${kind}` : '');
}

function setExporting(isExporting) {
  exportBtn.disabled = isExporting;
  exportBtn.querySelector('.export-label').textContent = isExporting ? 'Working' : 'Export';
  exportBtn.querySelector('.export-spinner').hidden = !isExporting;
}

// ---------- PWA install prompt ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}
