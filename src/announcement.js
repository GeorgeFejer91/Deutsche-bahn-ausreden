const digits = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];

export function normalizeText(value) {
  return String(value).normalize('NFC').replace(/[\u0000-\u001f\u007f\s]+/gu, ' ').trim();
}

export function announcementParts({ start, destination, train, excuse }) {
  const values = { start: normalizeText(start), destination: normalizeText(destination), train: normalizeText(train), excuse: normalizeText(excuse) };
  for (const [name, value] of Object.entries(values)) if (!value) throw Error(`Bitte ${name === 'start' ? 'den Startbahnhof' : name === 'destination' ? 'den Zielbahnhof' : name === 'train' ? 'die Zugnummer' : 'eine Ausrede'} eingeben.`);
  if (values.start.length > 80 || values.destination.length > 80 || values.train.length > 20 || values.excuse.length > 1000) throw Error('Bitte kürzen Sie die Eingabe.');
  const spokenTrain = values.train.replace(/\d/gu, digit => ` ${digits[Number(digit)]} `).replace(/\bICE\b/giu, 'I C E').replace(/\bIC\b/giu, 'I C').replace(/\bRE\b/giu, 'R E').replace(/\bRB\b/giu, 'R B').replace(/\s+/gu, ' ').trim();
  const context = `Eine Information zu Zug ${spokenTrain} von ${values.start} nach ${values.destination}. Dieser Zug hat Verspätung. Grund dafür:`;
  const reason = /[.!?]$/u.test(values.excuse) ? values.excuse : `${values.excuse}.`;
  const closing = 'Wir bitten um Ihr Verständnis.';
  return { ...values, context, reason, closing, fullText: `${context} ${reason} ${closing}` };
}

export function downloadName(train) {
  const name = normalizeText(train).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/gu, '') || 'zug';
  return `durchsage-${name.toLowerCase()}.mp3`;
}

// Preserve every source character. The caller supplies real Pretext fit checks.
export function splitTextPages(text, fits) {
  if (!text) return [''];
  const segments = [...new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(text)].map(item => item.segment);
  const pages = [];
  let start = 0;
  while (start < segments.length) {
    let low = start + 1, high = segments.length, best = start;
    while (low <= high) {
      const end = Math.floor((low + high) / 2);
      if (fits(segments.slice(start, end).join(''))) { best = end; low = end + 1; } else high = end - 1;
    }
    if (best === start) throw Error('Text passt bei dieser Fenstergröße nicht.');
    let end = best;
    if (best < segments.length) {
      for (let i = best - 1; i > start + (best - start) * .5; i--) {
        if (/\s/u.test(segments[i])) { end = i + 1; break; }
      }
    }
    pages.push(segments.slice(start, end).join(''));
    start = end;
  }
  return pages;
}
