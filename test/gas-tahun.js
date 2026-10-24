/**
 * Siapkan proyek Apps Script UJI 1 TAHUN (spreadsheet uji Cikarang, bukan produksi): build/gas-tahun/ = src/ + UjiTahun.js
 * (menu "🧪 Uji 1 tahun" disisipkan ke salinan Code.js) + UjiTahunData1..n.js (isi sheet & angka harapan dari
 * test/seed-tahun.js di atas mock, gzip + base64, ≤ 400 KB per file).
 *   node test/gas-tahun.js   → build/gas-tahun/   (±5 menit, sebagian besar generator)
 * Lalu push ke proyek uji (clasp, rootDir = build/gas-tahun) → spreadsheet → menu 🧪 Uji 1 tahun → 1 … 7.
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'build', 'gas-tahun');
const seed = require('./seed-tahun');
const { ctx, ss, user } = require('./mock');
const as = (email, fn) => { const p = user.email; user.email = email; try { return fn(); } finally { user.email = p; } };

const enc = (v) => (v instanceof Date ? { d: v.getTime() } : (v === undefined || v === null ? '' : v));
const table = (name) => {
  const sh = ss.getSheetByName(name), w = sh.data[0].length;
  return sh.data.filter((r, i) => i === 0 || (r && r.some(x => x !== '' && x != null))).map(r => { const x = []; for (let j = 0; j < w; j++) x.push(enc(r[j])); return x; });
};
const y = seed.year, y0 = y - 1;

// Harapan dihitung SEBELUM tab tahun lalu dibangun (urutan sama dengan tahap 2 di Apps Script: setup, lalu tahun lalu)
const M = ctx.readTable_('Maintenance'), status = {};
M.forEach(r => { const k = r['Status'] + (r['Status review'] ? '/' + r['Status review'] : ''); status[k] = (status[k] || 0) + 1; });
const counts = { maintenance: M.length, status, log: ctx.readTable_('Log').length, pemakaian: ctx.readTable_('Pemakaian Sparepart').length,
  kpiData: ctx.readTable_('KPI data').length, lines: ctx.readTable_('Lines').length, users: ctx.readTable_('Users').length };
const dashboard = as(seed.ADMIN, () => ctx.apiDashboard({ periode: 'ytd' })).kpi;
const arsip = M.filter(r => ctx.isArchivable_(r, y0)).length;
ctx.withLock_(() => { ctx.buildRekap_(y0); ctx.buildLaporan_(y0); });
ctx.buildKpi_(y0);

const laporan = (yr) => {
  const sh = ss.getSheetByName('Laporan ' + yr), w = sh.data[1].length;
  return { head: sh.data[1].slice(0, w - 1), rows: sh.data.slice(2).filter(r => r[w - 1]).map(r => r.slice(0, w).map(enc)) };
};
const kpi = (yr) => ss.getSheetByName('KPI ' + yr).data.slice(1).filter(r => r.length && r[0]).map(r => r.map(enc));
const kpiClosed = (yr) => kpi(yr).filter(r => r[1] === 'Plant' && /^Ditutup/.test(String(r[11]))).length;
const tpm = {};
ss.getSheets().filter(s => /^TPM /.test(s.getName())).forEach(s => { tpm[s.getName()] = s.data.slice(8).filter(r => r && typeof r[1] === 'number').length; });
const LAP = laporan(y), cols = ctx.masterData_().report, pj = cols.map(c => c.sumber).indexOf('Project'), perBaterai = {};
ctx.masterData_().allBatteries.forEach(b => { perBaterai['Maintenance ' + b] = LAP.rows.filter(r => r[pj] === b).length; });

const DATA = {
  data: {}, expect: { laporan: { [y]: LAP, [y0]: laporan(y0) }, kpi: { [y]: kpi(y), [y0]: kpi(y0) }, kpiClosed: { [y]: kpiClosed(y), [y0]: kpiClosed(y0) },
    tpm, perBaterai, dashboard }
};
['Users', 'Factory', 'Projects', 'Lines', 'Sparepart', 'Pilihan', 'Config', 'KPI data', 'Input Manual', 'Pemakaian Sparepart', 'Log', 'Maintenance']
  .forEach(n => { DATA.data[n] = table(n); });

const json = JSON.stringify(DATA), gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 }), b64 = gz.toString('base64');
const CH = 400 * 1024, parts = [];
for (let i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));

const MONTH = String(new Date(seed.generatedMs + 7 * 3600e3).getUTCMonth() + 1).padStart(2, '0');
const prevKey = MONTH === '01' ? (y - 1) + '-12' : y + '-' + String(Number(MONTH) - 1).padStart(2, '0');
const pic = 'agus@example.com';
const meta = {
  admin: seed.ADMIN, year: y, start: seed.start, end: seed.end, todayKey: seed.todayKey, generatedMs: seed.generatedMs, jobs: counts.maintenance,
  kb: Math.round(gz.length / 1024), counts, arsip, prevKey, pic, picName: 'Agus Setiawan', manualLine: 'GX-YN-01-4109',
  parts: [{ id: ctx.partId_('Elektrikal', 'Sensor photoelectric', 'Omron E3Z-D61'), qty: 1 }, { id: ctx.partId_('Mekanikal', 'Baut', 'M6 x 20 SUS'), qty: 4 }]
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.readdirSync(path.join(ROOT, 'src')).forEach(f => fs.copyFileSync(path.join(ROOT, 'src', f), path.join(OUT, f)));
// menu uji hanya di salinan build; gagal keras bila titik sisip berubah
const codePath = path.join(OUT, 'Code.js'), code = fs.readFileSync(codePath, 'utf8');
const ANCHOR = "    .addItem('Tentang (versi ' + APP.VERSION + ')', 'menuTentang')\n    .addToUi();\n";
if (code.split(ANCHOR).length !== 2) throw new Error('Titik sisip menu di onOpen (Code.js) tidak ketemu tepat satu kali: perbarui ANCHOR di test/gas-tahun.js');
fs.writeFileSync(codePath, code.replace(ANCHOR, ANCHOR + "  try { ujtMenu_(); } catch (e) { /* UJI 1 TAHUN (hanya build uji) */ }\n"));
const stamp = '// DIBUAT OTOMATIS oleh test/gas-tahun.js ' + new Date().toISOString() + ' — jangan diedit, jangan disalin ke produksi.\n';
fs.writeFileSync(path.join(OUT, 'UjiTahun.js'), stamp + 'var UJT_ = ' + JSON.stringify({ meta }) + ';\n' +
  'function ujtChunks_() { return [' + parts.map((_, i) => 'UJT_DATA_' + (i + 1) + '_').join(', ') + ']; }\n\n' +
  fs.readFileSync(path.join(__dirname, 'gas', 'UjiTahun.js'), 'utf8'));
parts.forEach((p, i) => fs.writeFileSync(path.join(OUT, 'UjiTahunData' + (i + 1) + '.js'), stamp + 'var UJT_DATA_' + (i + 1) + '_ = "' + p + '";\n'));

const st = seed.stats, d = st.dur.slice().sort((a, b) => a - b), q = (p) => d[Math.floor(p * (d.length - 1))];
console.log('build/gas-tahun: ' + fs.readdirSync(OUT).length + ' file · data ' + Math.round(json.length / 1048576) + ' MB → gzip ' + meta.kb + ' KB (' + parts.length + ' potongan) · ' +
  counts.maintenance + ' pekerjaan ' + seed.start + ' – ' + seed.end + ' (' + (counts.maintenance / 365).toFixed(1) + '/hari) · Log ' + counts.log + ' · Pemakaian ' + counts.pemakaian);
console.log('alur ' + JSON.stringify(st.flow) + ' · status ' + JSON.stringify(status) + ' · durasi median ' + q(0.5) + ' / p90 ' + q(0.9) + ' · error generator ' + JSON.stringify(seed.errors));
console.log('Laporan ' + y + ': ' + LAP.rows.length + ' · Laporan ' + y0 + ': ' + DATA.expect.laporan[y0].rows.length + ' · KPI ' + y + ' ' + DATA.expect.kpi[y].length + ' baris (' +
  DATA.expect.kpiClosed[y] + ' bulan ditutup) · KPI ' + y0 + ' ' + DATA.expect.kpi[y0].length + ' (' + DATA.expect.kpiClosed[y0] + ') · arsip ' + y0 + ': ' + arsip +
  ' · TPM ' + JSON.stringify(tpm) + ' · per baterai ' + JSON.stringify(perBaterai));
