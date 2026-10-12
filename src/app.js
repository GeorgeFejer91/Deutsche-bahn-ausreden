import './styles.css';
import { prepareWithSegments, measureLineStats, measureNaturalWidth, setLocale } from '@chenglou/pretext';
import { announcementParts, downloadName, normalizeText, splitTextPages } from './announcement.js';
import { assembleAudio, encodeMp3, loadClip, SAMPLE_RATE } from './audio.js';

setLocale('de');
const $ = id => document.getElementById(id);
const form = $('generator'), textarea = $('excuse');
const state = { excuse: '', selected: null, catalogue: null, formPage: 0, textPage: 0, textPages: [''], resultPage: 0, resultPages: [''], resultText: '', compact: false, tight: false, busy: false, result: false };
const routeNames = ['start', 'destination', 'train'];
const lastFormPage = () => state.tight ? 3 : 1;
let worker = null, workerReady = false, requestId = 0, controller = null, objectUrl = null, scheduled = false;
const pending = new Map(), preparedCache = new Map();
const textProbe = document.createElement('div');
textProbe.id = 'text-probe';
textProbe.setAttribute('aria-hidden', 'true');
document.body.append(textProbe);

function status(text, error = false) {
  $('status').textContent = text;
  $('status').parentElement.toggleAttribute('data-error', error);
  scheduleLayout();
}

function textMetrics(element, text, width = null) {
  const style = getComputedStyle(element);
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const spacing = Number.parseFloat(style.letterSpacing) || 0;
  const key = `${font}|${spacing}|${style.whiteSpace}|${text}`;
  if (!preparedCache.has(key)) {
    if (preparedCache.size > 64) preparedCache.clear();
    preparedCache.set(key, prepareWithSegments(text, font, { letterSpacing: spacing, whiteSpace: style.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal' }));
  }
  const prepared = preparedCache.get(key);
  const innerWidth = width ?? Math.max(1, element.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0));
  const lineHeight = Number.parseFloat(style.lineHeight);
  return { ...measureLineStats(prepared, Math.max(1, innerWidth)), naturalWidth: measureNaturalWidth(prepared), lineHeight, innerWidth };
}

function renderedSample(element, text, width) {
  const style = getComputedStyle(element);
  Object.assign(textProbe.style, { width: `${width}px`, font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, whiteSpace: style.whiteSpace, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap, direction: style.direction });
  textProbe.textContent = text;
  return { height: textProbe.scrollHeight, width: textProbe.scrollWidth };
}

function paginate(element, text, innerHeight) {
  const wordSpacing = Number.parseFloat(getComputedStyle(element).wordSpacing) || 0;
  return splitTextPages(text, candidate => {
    const metrics = textMetrics(element, candidate);
    // Pretext does not model custom word spacing. Render a matching, noninteractive
    // measurement sample in that case; never claim Pretext parity for the override.
    if (wordSpacing) {
      const rendered = renderedSample(element, candidate, metrics.innerWidth);
      return rendered.height <= innerHeight - 3 && rendered.width <= metrics.innerWidth + 1;
    }
    return metrics.lineCount * metrics.lineHeight <= innerHeight - 3 && metrics.maxLineWidth <= metrics.innerWidth - 1;
  });
}

function renderedTextFits(element, singleLine) {
  const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = [...range.getClientRects()];
  const left = bounds.left + (Number.parseFloat(style.paddingLeft) || 0);
  const right = bounds.right - (Number.parseFloat(style.paddingRight) || 0);
  const tops = new Set(rects.map(rect => Math.round(rect.top)));
  return (!singleLine || tops.size <= 1) && rects.every(rect => rect.left >= left - 1 && rect.right <= right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1);
}

function drawFormPage(focus = false) {
  const last = lastFormPage();
  $('route-fields').hidden = state.compact && state.formPage === last;
  $('excuse-fields').hidden = state.compact && state.formPage !== last;
  routeNames.forEach((name, index) => { $(name).closest('label').hidden = state.compact && state.tight && state.formPage !== index; });
  $('form-pages').hidden = !state.compact || state.busy || (state.tight && state.formPage === last);
  $('route-back').hidden = !state.compact || !state.tight || state.formPage !== last || state.busy;
  $('previous').disabled = state.formPage === 0;
  $('next').disabled = state.formPage === last;
  $('form-page-count').textContent = `${state.formPage + 1} von ${last + 1}`;
  $('generate').hidden = state.busy || (state.compact && state.formPage !== last);
  if (focus) {
    const target = state.formPage === last ? textarea : $(routeNames[state.tight ? state.formPage : 0]);
    target.focus({ preventScroll: true });
    if (target === textarea) textarea.setSelectionRange(0, 0);
  }
}

function drawTextPage(caret = null) {
  textarea.value = state.textPages[state.textPage] || '';
  $('text-page-count').textContent = `Text · ${state.textPage + 1} von ${state.textPages.length}`;
  $('text-previous').disabled = state.textPage === 0;
  $('text-next').disabled = state.textPage === state.textPages.length - 1;
  if (caret !== null) textarea.setSelectionRange(caret, caret);
}

function layout() {
  scheduled = false;
  const type = getComputedStyle(textarea);
  const wordSpacing = Number.parseFloat(type.wordSpacing) || 0;
  const typeScale = Math.max(1, Number.parseFloat(type.fontSize) / 16, Number.parseFloat(type.lineHeight) / 24, 1 + wordSpacing / 16 + 2 * (Number.parseFloat(type.letterSpacing) || 0) / 16);
  const compact = innerWidth / typeScale < 760 || innerHeight / typeScale < 680;
  const tight = innerHeight / typeScale < 580;
  document.body.dataset.measurement = wordSpacing ? 'browser-spacing' : 'pretext-and-dom';
  const unsupported = innerWidth < 320 || innerHeight / typeScale < (innerWidth < 620 ? 440 : 360);
  document.body.classList.toggle('unsupported', unsupported);
  document.body.classList.toggle('tight', tight);
  if (unsupported) {
    $('no-fit').hidden = false;
    document.body.dataset.textFit = 'no-fit';
    document.body.dataset.geometryFit = 'no-fit';
    return;
  }
  $('no-fit').hidden = true;
  if (state.compact !== compact || state.tight !== tight) {
    const wasExcuse = state.formPage === lastFormPage();
    state.compact = compact;
    state.tight = tight;
    state.formPage = wasExcuse ? lastFormPage() : 0;
    document.body.classList.toggle('compact', compact);
    drawFormPage();
  }
  if (!state.result && !textarea.closest('[hidden]')) {
    const style = getComputedStyle(textarea);
    const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    const oldPager = $('text-pages').hidden ? 0 : $('text-pages').getBoundingClientRect().height + Number.parseFloat(getComputedStyle($('excuse-fields')).rowGap);
    const expandedHeight = textarea.clientHeight - padding + oldPager;
    const metrics = textMetrics(textarea, state.excuse);
    const textHeight = wordSpacing ? renderedSample(textarea, state.excuse, metrics.innerWidth).height : metrics.lineCount * metrics.lineHeight;
    const needsPages = textHeight > expandedHeight - 3;
    if ($('text-pages').hidden === needsPages) {
      $('text-pages').hidden = !needsPages;
      scheduleLayout();
      return;
    }
    const nextPages = paginate(textarea, state.excuse, textarea.clientHeight - padding);
    const focused = document.activeElement === textarea;
    const oldPrefix = state.textPages.slice(0, state.textPage).join('').length;
    const caret = focused ? oldPrefix + textarea.selectionStart : null;
    state.textPages = nextPages;
    if (caret !== null) {
      let offset = 0;
      state.textPage = nextPages.findIndex((page, index) => {
        const match = caret < offset + page.length || index === nextPages.length - 1;
        if (!match) offset += page.length;
        return match;
      });
      drawTextPage(Math.max(0, caret - offset));
    } else {
      state.textPage = Math.min(state.textPage, nextPages.length - 1);
      drawTextPage();
    }
  }
  if (state.result) {
    const region = $('announcement');
    const extra = $('result-pages').hidden ? 0 : $('result-pages').getBoundingClientRect().height + Number.parseFloat(getComputedStyle($('result')).rowGap);
    const height = region.clientHeight + extra;
    const metrics = textMetrics(region, state.resultText);
    const regionSpacing = Number.parseFloat(getComputedStyle(region).wordSpacing) || 0;
    const textHeight = regionSpacing ? renderedSample(region, state.resultText, metrics.innerWidth).height : metrics.lineCount * metrics.lineHeight;
    const needed = textHeight > height - 3;
    if ($('result-pages').hidden === needed) {
      $('result-pages').hidden = !needed;
      scheduleLayout();
      return;
    }
    state.resultPages = paginate(region, state.resultText, region.clientHeight);
    state.resultPage = Math.min(state.resultPage, state.resultPages.length - 1);
    drawResultPage();
  }
  const failures = [];
  for (const element of document.querySelectorAll('[data-measure]')) {
    if (!element.getClientRects().length || element.closest('[hidden]')) continue;
    const metrics = textMetrics(element, element.textContent);
    const style = getComputedStyle(element);
    const height = element.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);
    const pretextFits = metrics.lineCount * metrics.lineHeight <= height + 1
      && metrics.maxLineWidth <= metrics.innerWidth + 1
      && (element.dataset.measure !== 'line' || (metrics.lineCount <= 1 && metrics.naturalWidth <= metrics.innerWidth + 1));
    const customSpacing = Number.parseFloat(style.wordSpacing) || 0;
    element.dataset.measurement = customSpacing ? 'browser-spacing' : 'pretext-and-dom';
    const fits = (customSpacing || pretextFits) && renderedTextFits(element, element.dataset.measure === 'line');
    element.dataset.textFit = String(fits);
    if (!fits) failures.push(element.id || element.textContent);
  }
  const clipped = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    || document.documentElement.scrollHeight > document.documentElement.clientHeight + 1
    || [...document.querySelectorAll('.editor,#excuse-fields,textarea,#announcement')].some(element => element.getClientRects().length && !element.closest('[hidden]') && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1));
  document.body.dataset.textFit = failures.length || clipped ? 'no-fit' : 'fit';
  document.body.dataset.geometryFit = clipped ? 'no-fit' : 'fit';
  $('no-fit').hidden = !clipped;
}

function scheduleLayout() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    try { layout(); } catch { document.body.dataset.textFit = 'no-fit'; $('no-fit').hidden = false; }
  });
}

function updateExcuse(value, selected = null) {
  state.excuse = normalizeText(value);
  state.selected = selected;
  state.textPage = 0;
  state.textPages = [state.excuse];
  drawTextPage();
  scheduleLayout();
}

textarea.addEventListener('input', event => {
  if (event.isComposing) return;
  const prefix = state.textPages.slice(0, state.textPage).join('');
  const suffix = state.textPages.slice(state.textPage + 1).join('');
  const value = textarea.value.replace(/[\r\n\t]/gu, ' ');
  state.excuse = prefix + value + suffix;
  textarea.setCustomValidity(state.excuse.length > 1000 ? 'Bitte höchstens 1.000 Zeichen eingeben.' : '');
  state.textPages[state.textPage] = value;
  if (state.selected && normalizeText(state.selected.text) !== normalizeText(state.excuse)) state.selected = null;
  $('excuse-help').textContent = state.selected ? 'Vorbereitete Ausrede ausgewählt.' : 'Eigene Ausrede wird in derselben Stimme erstellt.';
  scheduleLayout();
});
textarea.addEventListener('compositionend', () => textarea.dispatchEvent(new Event('input')));
$('text-previous').addEventListener('click', () => { state.textPage--; drawTextPage(0); textarea.focus({ preventScroll: true }); scheduleLayout(); });
$('text-next').addEventListener('click', () => { state.textPage++; drawTextPage(0); textarea.focus({ preventScroll: true }); scheduleLayout(); });
$('previous').addEventListener('click', () => { state.formPage = Math.max(0, state.formPage - 1); drawFormPage(true); scheduleLayout(); });
$('route-back').addEventListener('click', () => { state.formPage = lastFormPage() - 1; drawFormPage(true); scheduleLayout(); });
$('next').addEventListener('click', () => {
  const current = state.tight ? $(routeNames[state.formPage]) : null;
  if (current ? current.reportValidity() : validateRoute()) {
    state.formPage = Math.min(lastFormPage(), state.formPage + 1); drawFormPage(true); scheduleLayout();
  }
});

async function catalogue() {
  if (state.catalogue) return state.catalogue;
  const response = await fetch(new URL('./audio/excuses.json', document.baseURI));
  if (!response.ok) throw Error('Die vorbereiteten Ausreden sind noch nicht verfügbar.');
  const data = await response.json();
  if (!Array.isArray(data.excuses) || !data.excuses.length || !data.closing?.url) throw Error('Die vorbereiteten Ausreden sind unvollständig.');
  state.catalogue = data;
  return data;
}

$('random').addEventListener('click', async () => {
  try {
    const choices = (await catalogue()).excuses.filter(item => item.id !== state.selected?.id);
    const list = choices.length ? choices : state.catalogue.excuses;
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const choice = list[Math.floor(random[0] / 2 ** 32 * list.length)];
    updateExcuse(choice.text, choice);
    $('excuse-help').textContent = 'Vorbereitete Ausrede ausgewählt. Sie können den Text ändern.';
    status('Eine vorbereitete Ausrede wurde ausgewählt.');
  } catch (error) { status(error.message, true); }
});

function validateRoute() {
  for (const [index, name] of routeNames.entries()) {
    if (!normalizeText($(name).value)) {
      state.formPage = state.tight ? index : 0;
      drawFormPage();
      $(name).focus({ preventScroll: true });
      $(name).reportValidity();
      return false;
    }
  }
  return true;
}

function workerRequest(type, payload = {}) {
  if (!worker) {
    worker = new Worker(new URL('./speech-worker.js', document.baseURI), { type: 'module' });
    const owner = worker;
    owner.onmessage = event => {
      if (worker !== owner) return;
      const message = event.data;
      if (!pending.has(message.id)) return;
      if (message.type === 'progress') {
        status(message.message);
        $('progress').hidden = false;
        if (Number.isFinite(message.progress)) $('progress').value = message.progress;
      } else {
        const promise = pending.get(message.id);
        pending.delete(message.id);
        if (message.type === 'error') {
          owner.terminate(); worker = null; workerReady = false;
          promise.reject(Error(message.message));
        }
        else promise.resolve(message);
      }
    };
    owner.onerror = () => {
      if (worker !== owner) return;
      for (const entry of pending.values()) entry.reject(Error('Die Stimme konnte in diesem Browser nicht gestartet werden.'));
      pending.clear();
      owner.terminate(); worker = null; workerReady = false;
    };
  }
  const id = ++requestId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ type, id, ...payload }); });
}

async function speech(text, segment) {
  if (!workerReady) {
    const details = await workerRequest('load', { baseUrl: new URL('./models/', document.baseURI).href, voiceUrl: new URL('./voice/gs-deutsche-bahn-durchsage-4s.json', document.baseURI).href });
    document.body.dataset.engineMetrics = JSON.stringify(details);
    workerReady = true;
  }
  const result = await workerRequest('generate', { text });
  if (!(result.samples instanceof Float32Array) || result.sampleRate !== SAMPLE_RATE) throw Error('Die Stimme hat keine gültigen Audiodaten zurückgegeben.');
  const previous = JSON.parse(document.body.dataset.generationMetrics || '[]');
  previous.push({ segment, milliseconds: result.generationMilliseconds, seconds: result.samples.length / SAMPLE_RATE, steps: result.steps, timings: result.timings, device: result.device });
  document.body.dataset.generationMetrics = JSON.stringify(previous);
  return result.samples;
}

function assetUrl(value) {
  const url = new URL(value, document.baseURI);
  if (url.origin !== location.origin) throw Error('Audio muss von dieser Website geladen werden.');
  return url;
}

function busy(value) {
  state.busy = value;
  $('route-fields').disabled = value;
  textarea.disabled = value;
  $('random').disabled = value;
  $('generate').disabled = value;
  $('generate').hidden = value || (state.compact && state.formPage !== lastFormPage());
  $('cancel').hidden = !value;
  $('progress').hidden = !value;
  drawFormPage();
  scheduleLayout();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || !validateRoute()) return;
  if (!normalizeText(state.excuse)) {
    state.formPage = lastFormPage(); drawFormPage(); textarea.focus({ preventScroll: true }); textarea.reportValidity(); return;
  }
  let parts;
  try { parts = announcementParts({ start: $('start').value, destination: $('destination').value, train: $('train').value, excuse: state.excuse }); }
  catch (error) { status(error.message, true); return; }
  const selected = state.selected;
  controller = new AbortController();
  const signal = controller.signal;
  busy(true);
  document.body.dataset.generationMetrics = '[]';
  $('progress').value = 0;
  status('Die Stimme wird geladen. Der erste Start kann etwas dauern.');
  try {
    const clips = await catalogue().catch(() => null);
    const context = await speech(parts.context, 'context');
    signal.throwIfAborted();
    const reason = selected && normalizeText(selected.text) === parts.excuse
      ? await loadClip(assetUrl(selected.url), signal)
      : await speech(parts.reason, 'excuse');
    signal.throwIfAborted();
    const closing = clips?.closing?.url
      ? await loadClip(assetUrl(clips.closing.url), signal)
      : await speech(parts.closing, 'closing');
    signal.throwIfAborted();
    status('Die MP3 wird erstellt.');
    const samples = assembleAudio([context, reason, closing]);
    const mp3 = encodeMp3(samples);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(mp3);
    $('player').src = objectUrl;
    $('download').href = objectUrl;
    $('download').download = downloadName(parts.train);
    $('duration').textContent = `${Math.round(samples.length / SAMPLE_RATE)} Sekunden`;
    state.resultText = parts.fullText;
    state.resultPage = 0;
    state.result = true;
    form.hidden = true; $('result').hidden = false;
    status('Die Durchsage ist fertig.');
    scheduleLayout();
  } catch (error) {
    status(error.name === 'AbortError' ? 'Die Erstellung wurde abgebrochen.' : error.message, error.name !== 'AbortError');
  } finally { busy(false); controller = null; }
});

$('cancel').addEventListener('click', () => {
  controller?.abort();
  worker?.terminate(); worker = null; workerReady = false;
  for (const entry of pending.values()) entry.reject(new DOMException('Abgebrochen', 'AbortError'));
  pending.clear();
});

function drawResultPage() {
  $('announcement').textContent = state.resultPages[state.resultPage] || '';
  $('result-page-count').textContent = `Text · ${state.resultPage + 1} von ${state.resultPages.length}`;
  $('result-previous').disabled = state.resultPage === 0;
  $('result-next').disabled = state.resultPage === state.resultPages.length - 1;
}
$('result-previous').addEventListener('click', () => { state.resultPage--; drawResultPage(); scheduleLayout(); });
$('result-next').addEventListener('click', () => { state.resultPage++; drawResultPage(); scheduleLayout(); });
$('edit').addEventListener('click', () => {
  $('player').pause(); state.result = false; form.hidden = false; $('result').hidden = true; state.formPage = 0; drawFormPage(true); scheduleLayout();
});

await document.fonts.ready;
const resize = new ResizeObserver(scheduleLayout);
resize.observe(document.body); resize.observe(textarea); resize.observe($('announcement'));
addEventListener('resize', scheduleLayout);
addEventListener('pagehide', event => {
  controller?.abort();
  worker?.terminate(); worker = null; workerReady = false;
  for (const entry of pending.values()) entry.reject(new DOMException('Abgebrochen', 'AbortError'));
  pending.clear();
  if (!event.persisted && objectUrl) URL.revokeObjectURL(objectUrl);
});
scheduleLayout();
