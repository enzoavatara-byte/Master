/**
 * Siapkan proyek Apps Script UJI (bukan produksi): build/gas-uji/ = src/ + Uji.js (data 104 pekerjaan dari test/seed-uji.js
 * + angka harapan Laporan / Rekap / KPI / TPM yang dihitung kode yang sama di atas mock).
 *   node test/gas-uji.js            → build/gas-uji/
 * Lalu push ke proyek uji (clasp, rootDir = build/gas-uji) → Run ujiIsiData → Run ujiPeriksa → tab "Uji 2.6".
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'build', 'gas-uji');
const seed = require('./seed-uji');
const { ss } = require('./mock');

const enc = (v) => (v instanceof Date ? { d: v.getTime() } : (v === undefined || v === null ? '' : v));
const table = (name) => {
  const sh = ss.getSheetByName(name), w = sh.data[0].length;
  return sh.data.filter((r, i) => i === 0 || (r && r.some(x => x !== '' && x != null))).map(r => { const x = []; for (let j = 0; j < w; j++) x.push(enc(r[j])); return x; });
};
const y = seed.year;
const lap = ss.getSheetByName('Laporan ' + y), lw = lap.data[1].length;
const laporan = lap.data.slice(2).filter(r => r[lw - 1]).map(r => r.slice(0, lw).map(enc));
const rekap = ss.getSheetByName('Rekap ' + y).data.map(r => r.map(enc));
const kpi = ss.getSheetByName('KPI ' + y).data.slice(1).filter(r => r.length && r[0]).map(r => r.map(enc));
const tpm = {};
ss.getSheets().filter(s => /^TPM /.test(s.getName())).forEach(s => {
  tpm[s.getName()] = s.data.slice(8).filter(r => r && r[1] !== '' && r[1] != null && typeof r[1] === 'number').map(r => r.slice(1, 11).map(enc));
});

const UJI = {
  meta: { admin: seed.ADMIN, year: y, prevKey: seed.prevKey, todayKey: seed.todayKey, generatedMs: seed.generatedMs, picEmail: seed.picEmail,
    config: seed.CONFIG, ids: seed.ids },
  data: { Users: table('Users'), Factory: table('Factory'), Projects: table('Projects'), Lines: table('Lines'),
    Maintenance: table('Maintenance'), Log: table('Log'), 'Pemakaian Sparepart': table('Pemakaian Sparepart') },
  expect: { laporanHead: lap.data[1].slice(0, lw - 1), laporan, rekap, kpi, tpm }
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.readdirSync(path.join(ROOT, 'src')).forEach(f => fs.copyFileSync(path.join(ROOT, 'src', f), path.join(OUT, f)));
fs.writeFileSync(path.join(OUT, 'Uji.js'), '// DIBUAT OTOMATIS oleh test/gas-uji.js ' + new Date().toISOString() + ' — jangan diedit, jangan disalin ke produksi.\n' +
  'var UJI_ = ' + JSON.stringify(UJI) + ';\n\n' + fs.readFileSync(path.join(__dirname, 'gas', 'Uji.js'), 'utf8'));
const size = fs.statSync(path.join(OUT, 'Uji.js')).size;
console.log('build/gas-uji: ' + fs.readdirSync(OUT).length + ' file · Uji.js ' + Math.round(size / 1024) + ' KB · ' +
  (UJI.data.Maintenance.length - 1) + ' pekerjaan · Laporan ' + laporan.length + ' · KPI ' + kpi.length + ' · TPM ' +
  Object.keys(tpm).map(k => k + ' ' + tpm[k].length).join(', ') + ' · tutup ' + seed.prevKey);
