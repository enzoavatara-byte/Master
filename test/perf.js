/**
 * Hitung panggilan ke Google Sheets per aksi (di atas mock + data contoh test/seed.js).
 *   node test/perf.js
 *
 * Di Apps Script, waktu sebuah aksi terutama ditentukan oleh jumlah panggilan ke SpreadsheetApp
 * (setiap baca/tulis = satu perjalanan ke server Sheets), bukan oleh jumlah data. Angka di sini
 * adalah jumlah panggilan, bukan milidetik: waktu asli hanya bisa diukur di Apps Script.
 */
'use strict';
const { ctx, ss, cache } = require('./mock');
const { as } = require('./seed');

const counts = {};
const wrap = (proto, names) => names.forEach((n) => {
  const orig = proto[n];
  if (typeof orig !== 'function' || orig.__wrapped) return;
  proto[n] = function () { counts[n] = (counts[n] || 0) + 1; return orig.apply(this, arguments); };
  proto[n].__wrapped = true;
});
const sh = ss.getSheetByName('Users');
wrap(Object.getPrototypeOf(sh.getRange(1, 1)), ['getValues', 'setValues', 'clearContent', 'setFormula', 'setNumberFormat']);
wrap(Object.getPrototypeOf(sh), ['getLastRow', 'getLastColumn', 'getDataRange', 'appendRow']);
wrap(Object.getPrototypeOf(ss), ['getSheetByName']);
const reads = () => (counts.getValues || 0);
const writes = () => (counts.setValues || 0) + (counts.appendRow || 0) + (counts.clearContent || 0);
const total = () => Object.keys(counts).reduce((a, k) => a + counts[k], 0);

const rows = [];
function measure(label, fn) {
  Object.keys(counts).forEach((k) => delete counts[k]);
  const out = fn();
  rows.push([label, reads(), writes(), total()]);
  return out;
}

const T = 'andi@gmail.com';
cache.enabled = true; // seperti di server asli: master disimpan di CacheService
measure('Buka app, cache kosong (pertama / habis edit sheet)', () => as(T, () => { const p = ctx.doGet({ parameter: {} }); return p.vars.boot ? null : ctx.apiBootstrap('', '', {}); }));
measure('Buka app (halaman + data awal)', () => as(T, () => { const p = ctx.doGet({ parameter: {} }); return p.vars.boot ? null : ctx.apiBootstrap('', '', {}); }));
measure('Scan QR line', () => as(T, () => { const p = ctx.doGet({ parameter: { line: 'L02' } }); return p.vars.boot ? null : ctx.apiBootstrap('L02', '', {}); }));
const v = measure('Mulai', () => as(T, () => ctx.apiStart('L02', { mesin: 'M-HPR', baterai: 'VF7' })));
const id = v.open.id;
measure('Pause', () => as(T, () => ctx.apiPause(id, { values: { 'Alasan pause': 'Istirahat' } })));
measure('Resume', () => as(T, () => ctx.apiResume(id)));
measure('Selesai', () => as(T, () => ctx.apiComplete(id, { values: { Masalah: 'Sensor error', Penyebab: 'Komponen aus', Penanganan: 'Ganti part' }, tanpaPart: true })));
measure('Tab Pending', () => as(T, () => ctx.apiListPending({})));
measure('Dashboard', () => as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 })));
measure('Refresh otomatis (tiap 60 dtk)', () => as(T, () => ctx.apiRefresh({})));

const w = [52, 8, 8, 8];
console.log(['Aksi', 'Baca', 'Tulis', 'Total'].map((h, i) => h.padEnd(w[i])).join('│'));
rows.forEach((r) => console.log(r.map((c, i) => String(c).padEnd(w[i])).join('│')));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
