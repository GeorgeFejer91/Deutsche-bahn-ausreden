import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announcementParts, downloadName, splitTextPages } from '../src/announcement.js';

test('novel Unicode stations, leading zeroes and editable excuse survive assembly', () => {
  const parts = announcementParts({ start: '  Köln\nHbf  ', destination: 'Łódź Fabryczna', train: 'ICE 0815', excuse: 'Die Weiche träumt noch' });
  assert.equal(parts.start, 'Köln Hbf');
  assert.match(parts.context, /Łódź Fabryczna/);
  assert.match(parts.context, /I C E null acht eins fünf/);
  assert.match(parts.fullText, /Die Weiche träumt noch\. Wir bitten um Ihr Verständnis\.$/);
  assert.throws(() => announcementParts({ start: '', destination: 'B', train: '1', excuse: 'A' }));
  assert.equal(downloadName('ICE 0815'), 'durchsage-ice-0815.mp3');
});

test('measured text paging preserves every character and grapheme', () => {
  const text = 'Ärger über 🚆 und 👨‍👩‍👧‍👦. EinsehrlangesWortOhneLeerzeichen.';
  const size = value => [...new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(value)].length;
  const pages = splitTextPages(text, value => size(value) <= 12);
  assert.equal(pages.join(''), text);
  assert.ok(pages.every(page => size(page) <= 12));
  assert.ok(pages.some(page => page.includes('👨‍👩‍👧‍👦')));
  assert.throws(() => splitTextPages('a', () => false));
});
