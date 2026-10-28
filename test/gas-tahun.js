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
const y = seed.year, y0 = y - 1, YEARS = seed.years;

// Harapan dihitung SEBELUM tab tahun lalu dibangun (urutan sama dengan tahap 2 di Apps Script: setup, lalu tahun lalu)
const M = ctx.readTable_('Maintenance'), status = {};
M.forEach(r => { const k = r['Status'] + (r['Status review'] ? '/' + r['Status review'] : ''); status[k] = (status[k] || 0) + 1; });
const ARSIP_TABS = ss.getSheets().map(s => s.getName()).filter(n => /^Arsip( Log| Sparepart)? \d{4}$/.test(n)).sort();
const counts = { maintenance: M.length, status, log: ctx.readTable_('Log').length, pemakaian: ctx.readTable_('Pemakaian Sparepart').length,
  kpiData: ctx.readTable_('KPI data').length, lines: ctx.readTable_('Lines').length, users: ctx.readTable_('Users').length,
  arsip: Object.fromEntries(ARSIP_TABS.map(n => [n, ctx.readTable_(n).length])) };
const dashboard = as(seed.ADMIN, () => ctx.apiDashboard({ periode: 'ytd' })).kpi;
const arsip = M.filter(r => ctx.isArchivable_(r, y0)).length;
YEARS.slice(1).forEach(yr => { ctx.withLock_(() => { ctx.buildRekap_(yr); ctx.buildLaporan_(yr); }); ctx.buildKpi_(yr); });

const laporan = (yr) => {
  const sh = ss.getSheetByName('Laporan ' + yr), w = sh.data[1].length;
  return { head: sh.data[1].slice(0, w - 1), rows: sh.data.slice(2).filter(r => r[w - 1]).map(r => r.slice(0, w).map(enc)) };
};
const kpi = (yr) => ss.getSheetByName('KPI ' + yr).data.slice(1).filter(r => r.length && r[0]).map(r => r.map(enc));
const kpiClosed = (yr) => kpi(yr).filter(r => r[1] === 'Plant' && /^Ditutup/.test(String(r[11]))).length;
const tpm = {};
ss.getSheets().filter(s => /^TPM /.test(s.getName())).forEach(s => { tpm[s.getName()] = s.data.slice(8).filter(r => r && typeof r[1] === 'number').length; });
const LAP = {}; YEARS.forEach(yr => { LAP[yr] = laporan(yr); });
const cols = ctx.masterData_().report, pj = cols.map(c => c.sumber).indexOf('Project'), perBaterai = {};
ctx.masterData_().allBatteries.forEach(b => { perBaterai['Maintenance ' + b] = LAP[y].rows.filter(r => r[pj] === b).length; });

// Potongan data (2.6.4): tiap potongan gzip + base64 sendiri (≤ ±380 KB) → Apps Script membuka satu potongan sekali jalan,
// bukan seluruh data sekaligus (2 tahun ±32 MB JSON: risiko batas memori). meta.blobs[kunci] = [[file, baris awal, jumlah baris], …]
const TABEL = ['Users', 'Factory', 'Projects', 'Lines', 'Sparepart', 'Pilihan', 'Config', 'KPI data', 'Input Manual', 'Pemakaian Sparepart', 'Log', 'Maintenance']
  .concat(ARSIP_TABS);
const MAXB64 = 380 * 1024, files = [], blobs = {}, width = {}, nrows = {};
const pack = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 }).toString('base64');
let jsonBytes = 0, gzBytes = 0;
function addRows(key, rows) {
  blobs[key] = [];
  for (let from = 0; from < rows.length;) {
    let n = Math.min(4000, rows.length - from), b64;
    for (;;) { b64 = pack({ from, rows: rows.slice(from, from + n) }); if (b64.length <= MAXB64 || n === 1) break; n = Math.ceil(n / 2); }
    files.push(b64); blobs[key].push([files.length, from, n]);
    jsonBytes += JSON.stringify(rows.slice(from, from + n)).length; gzBytes += b64.length * 3 / 4;
    from += n;
  }
  if (!rows.length) { files.push(pack({ from: 0, rows: [] })); blobs[key].push([files.length, 0, 0]); }
}
TABEL.forEach(n => { const rows = table(n); width[n] = rows[0].length; nrows[n] = rows.length; addRows('tab:' + n, rows); });
YEARS.forEach(yr => { addRows('lap:' + yr, LAP[yr].rows); addRows('kpi:' + yr, kpi(yr)); });
const EXP = { laporanHead: Object.fromEntries(YEARS.map(yr => [yr, LAP[yr].head])), kpiClosed: Object.fromEntries(YEARS.map(yr => [yr, kpiClosed(yr)])), tpm, perBaterai, dashboard };
files.push(pack(EXP)); blobs.exp = [[files.length, 0, 0]];

const MONTH = String(new Date(seed.generatedMs + 7 * 3600e3).getUTCMonth() + 1).padStart(2, '0');
const prevKey = MONTH === '01' ? (y - 1) + '-12' : y + '-' + String(Number(MONTH) - 1).padStart(2, '0');
const pic = 'agus@example.com';
const meta = {
  admin: seed.ADMIN, year: y, years: YEARS, start: seed.start, end: seed.end, days: seed.days, profil: seed.profil, todayKey: seed.todayKey,
  generatedMs: seed.generatedMs, jobs: counts.maintenance, kb: Math.round(gzBytes / 1024), counts, arsip, prevKey, pic, picName: 'Agus Setiawan',
  manualLine: seed.manualLine, isian: seed.isian, pics15: seed.pics15, parts20: seed.parts20, tabel: TABEL, width, rows: nrows, blobs,
  judul: seed.profil === 'bogor2' ? 'UJI 2 TAHUN (master Bogor, ±24/hari)' : 'UJI 1 TAHUN',
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
  'function ujtFile_(i) { return [' + files.map((_, i) => 'UJT_DATA_' + (i + 1) + '_').join(', ') + '][i - 1]; }\n\n' +
  fs.readFileSync(path.join(__dirname, 'gas', 'UjiTahun.js'), 'utf8'));
files.forEach((b64, i) => fs.writeFileSync(path.join(OUT, 'UjiTahunData' + (i + 1) + '.js'), stamp + 'var UJT_DATA_' + (i + 1) + '_ = "' + b64 + '";\n'));

const st = seed.stats, d = st.dur.slice().sort((a, b) => a - b), q = (p) => d[Math.floor(p * (d.length - 1))];
const total = fs.readdirSync(OUT).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log('build/gas-tahun (' + seed.profil + '): ' + fs.readdirSync(OUT).length + ' file, ' + (total / 1048576).toFixed(1) + ' MB · data ' + Math.round(jsonBytes / 1048576) + ' MB JSON → gzip ' + meta.kb + ' KB (' + files.length + ' potongan) · ' +
  counts.maintenance + ' pekerjaan di Maintenance ' + seed.start + ' – ' + seed.end + ' · Log ' + counts.log + ' · Pemakaian ' + counts.pemakaian + ' · arsip ' + JSON.stringify(counts.arsip));
console.log('alur ' + JSON.stringify(st.flow) + ' · status ' + JSON.stringify(status) + ' · durasi median ' + q(0.5) + ' / p90 ' + q(0.9) + ' · error generator ' + JSON.stringify(seed.errors));
console.log(YEARS.map(yr => 'Laporan ' + yr + ': ' + LAP[yr].rows.length + ' · KPI ' + yr + ' ' + kpi(yr).length + ' baris (' + kpiClosed(yr) + ' bulan ditutup)').join(' · ') +
  ' · arsip ' + y0 + ' nanti: ' + arsip + ' · TPM ' + JSON.stringify(tpm) + ' · per baterai ' + JSON.stringify(perBaterai));
