/**
 * Data uji lapangan 2.6 untuk spreadsheet uji di Apps Script asli (dipakai test/gas-uji.js):
 * 104 pekerjaan (100 bukan-Cancelled = 100 baris Laporan) ±12 minggu terakhir, dibuat lewat API asli di atas mock
 * dengan jam palsu, berurutan waktu (satu hari = beberapa pekerjaan berurutan, tanpa bentrok line / teknisi).
 * Teknisi fiktif memakai @example.com (email tidak pernah terkirim); Config uji mematikan email peringatan.
 */
'use strict';
const { ctx, ss, clock, user, bawaanLama } = require('./mock');
bawaanLama();   // 2.6.9: isi bawaan versi sebelumnya (setup kini menulis baris CONTOH)

const RealNow = Date.now;
let shiftMs = 0;
Object.defineProperty(clock, 'now', { get: () => RealNow() + shiftMs, set: (v) => { shiftMs = v - RealNow(); } });
const setTime = (ms) => { shiftMs = ms - RealNow(); };
const as = (email, fn) => { const p = user.email; user.email = email; try { return fn(); } finally { user.email = p; } };

const ADMIN = 'admin@uji.invalid';           // diganti email pelaksana saat ujiIsiData() di Apps Script
const ENZO = 'teknisi@uji.invalid';          // teknisi uji tanpa akun nyata (email asli bisa bentrok dengan pelaksana = Admin)
const T = { budi: 'budi@example.com', andi: 'andi@example.com', sari: 'sari@example.com', dewi: 'dewi@example.com',
  rizki: 'rizki@example.com', li: 'li@example.com', enzo: ENZO };
const TECHS = [T.budi, T.andi, T.sari, T.dewi, T.rizki, T.enzo];

// ---------- hari (WIB) ----------
const DAY = 86400000;
const nowMs = RealNow();
const wibMidnight = (ms) => { const j = new Date(ms + 7 * 3600e3); return Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - 7 * 3600e3; };
const today0 = wibMidnight(nowMs);
const dow = (ms) => new Date(ms + 7 * 3600e3).getUTCDay();          // 0 = Minggu
const at = (day0, hh, mm) => setTime(day0 + (hh * 60 + (mm || 0)) * 60000);

// ---------- master ----------
setTime(today0 - 90 * DAY);
ctx.setup();
const rowOf = (sheet, obj) => ctx.objToRow_(ss.getSheetByName(sheet).data[0].map(h => String(h).trim()), obj);
const U = ss.getSheetByName('Users');
U.data = [U.data[0]];
[[ADMIN, 'Admin Uji', 'Admin', 'Ya', ''], [T.budi, 'Budi Santoso', 'Teknisi', 'Ya', ''], [T.andi, 'Andi Wijaya', 'Teknisi', 'Ya', ''],
 [T.sari, 'Sari Lestari', 'Teknisi', 'Ya', ''], [T.dewi, 'Dewi Anggraini', 'Teknisi', 'Ya', ''], [T.rizki, 'Rizki Pratama', 'Teknisi', 'Ya', ''],
 [T.li, 'Li Wei 李伟', 'Teknisi', 'Ya', 'zh'], [ENZO, 'Teknisi Uji', 'Teknisi', 'Ya', ''], ['lama@example.com', 'Teknisi Lama', 'Teknisi', 'Tidak', '']]
  .forEach(u => U.appendRow(rowOf('Users', { Email: u[0], Nama: u[1], Peran: u[2], Aktif: u[3], Bahasa: u[4] })));
const F = ss.getSheetByName('Factory');
F.data[1][2] = 'Bogor'; F.data[2][2] = 'Cikarang';
const P = ss.getSheetByName('Projects'), ph = P.data[0];
P.data.slice(1).forEach(r => {
  const b = r[ph.indexOf('Baterai')];
  r[ph.indexOf('Fase')] = { VF7: 'Trial', Limo7: 'Mass Production', E22H: 'Mass Production', E245: 'Ramp-up' }[b];
  r[ph.indexOf('Target MTTR (menit)')] = { VF7: 45, Limo7: 40, E22H: 35, E245: 45 }[b];
  r[ph.indexOf('Target MTBF (jam)')] = { VF7: 150, Limo7: 200, E22H: 120, E245: 100 }[b];
});
const L = ss.getSheetByName('Lines');
// [Line ID, Nama, Factory, Baterai, Area, Proses, Nama (中文), Nama (English)]
[['L01', 'Assy Cell 1 - Stacking', 'F1', '', 'Hall A', 'Assembly', '电芯组装 1 - 叠片机', 'Cell Assembly 1 - Stacking'],
 ['L01-W', 'Assy Cell 1 - Welding', 'F1', '', 'Hall A', 'Assembly', '电芯组装 1 - 焊接机', 'Cell Assembly 1 - Welding'],
 ['L02', 'Assy Cell 2', 'F1', '', 'Hall A', 'Assembly', '电芯组装 2', 'Cell Assembly 2'],
 ['L03-A', 'Formation 1A', 'F1', '', 'Hall B', 'Formation', '化成 1A', 'Formation 1A'],
 ['L03-B', 'Formation 1B', 'F1', '', 'Hall B', 'Formation', '化成 1B', ''],
 ['L09', 'Assy lama (dibongkar)', 'F1', 'VF7', 'Hall A', 'Assembly', '旧组装线', 'Old assembly line'],
 ['L11', 'Assy E22H', 'F2', 'E22H', 'Gedung 2', 'Modul Line', '模组线 E22H', 'Module Line E22H'],
 ['L12', 'Assy E245', 'F2', 'E245', 'Gedung 2', 'Modul Line', '模组线 E245', 'Module Line E245'],
 ['L13', 'Packing', 'F2', '', 'Gedung 2', 'Packing', '包装', 'Packing']].forEach(l => L.appendRow(rowOf('Lines', {
  'Line ID': l[0], 'Nama Line': l[1], 'Factory ID': l[2], 'Baterai': l[3], 'Area': l[4], 'Proses': l[5], 'Aktif': 'Ya', 'Nama (中文)': l[6], 'Nama (English)': l[7] })));
// Config uji: email peringatan mati (teknisi fiktif), jam operasi 2 shift Sen–Sab + libur 17 Agustus
const year = new Date(today0 + 7 * 3600e3).getUTCFullYear();
const CONFIG = { EMAIL_PERINGATAN: 'Tidak', NAMA_APLIKASI: 'MTTR Uji 2.6', JAM_OPERASI_PER_HARI: 16, HARI_OPERASI: 'Sen-Sab', TANGGAL_LIBUR: '17/08/' + year };
const C = ss.getSheetByName('Config'), ch = C.data[0];
Object.keys(CONFIG).forEach(k => { const r = C.data.find((x, i) => i && x[ch.indexOf('Key')] === k); r[ch.indexOf('Value')] = CONFIG[k]; });
ctx.invalidateMaster_();

// ---------- isi pekerjaan ----------
const pid = (j, n, m) => ctx.partId_(j, n, m);
const PART = {
  sensor: { id: pid('Elektrikal', 'Sensor Proximity', 'Omron E2E-X5ME1'), qty: 1 }, fuse: { id: pid('Elektrikal', 'Fuse', '10A'), qty: 2 },
  relay: { id: pid('Elektrikal', 'Relay', 'Omron MY2N 24VDC'), qty: 1 }, bearing: { id: pid('Mekanikal', 'Bearing', '6205-2RS'), qty: 2 },
  belt: { id: pid('Mekanikal', 'Timing Belt', 'HTD 5M-450'), qty: 1 }, selang: { id: pid('Pneumatik', 'Selang PU', '8 mm'), qty: 3 },
  valve: { id: pid('Pneumatik', 'Solenoid Valve', 'SMC SY5120'), qty: 1 }, plc: { id: pid('Program', 'Backup Program PLC', ''), qty: 1 }
};
const manual = (jenis, nama, model, qty) => ({ manual: true, jenis, nama, model, qty });
// per jenis: [masalah, penyebab, penanganan, detail masalah, part, stop line]
const JENIS = {
  Elektrikal: [['Sensor error', 'Kabel/konektor longgar', 'Kencangkan/perbaiki koneksi', 'Kabel sensor putus di konektor', [PART.sensor]],
    ['Mesin berhenti', 'Komponen aus', 'Ganti part', 'Fuse panel putus, mesin mati total', [PART.fuse, PART.relay]],
    ['Lainnya: lampu indikator mati', 'Komponen aus', 'Ganti part', '', [manual('Elektrikal', 'Lampu indikator', '24VDC hijau', 2)]]],
  Mekanikal: [['Suara/getaran abnormal', 'Komponen aus', 'Ganti part', 'Bearing motor conveyor aus', [PART.bearing]],
    ['Mesin berhenti', 'Komponen aus', 'Ganti part', 'Timing belt putus', [PART.belt, PART.bearing]],
    ['Lainnya: pintu safety tidak terkunci', 'Kabel/konektor longgar', 'Kencangkan/perbaiki koneksi', '', []]],
  Pneumatik: [['Kebocoran', 'Komponen aus', 'Ganti part', 'Selang angin bocor di fitting', [PART.selang]],
    ['Mesin berhenti', 'Kotor/kontaminasi', 'Bersihkan', 'Solenoid macet karena kotor', [PART.valve]]],
  Program: [['Mesin berhenti', 'Setting berubah', 'Setting ulang', 'Program PLC hang, perlu restart', [PART.plc]],
    ['Sensor error', 'Setting berubah', 'Setting ulang', 'Parameter timer berubah', []]],
  Operasional: [['Hasil produk NG', 'Salah operasi', 'Setting ulang', 'Operator salah pilih resep', [], 'Tidak'],
    ['Mesin berhenti', 'Salah operasi', 'Setting ulang', 'Tombol emergency tertekan', []]],
  Produk: [['Hasil produk NG', 'Setting berubah', 'Setting ulang', 'Posisi jig bergeser, produk miring', [], 'Tidak']],
  MES: [['Lainnya: data MES tidak terkirim', 'Setting berubah', 'Setting ulang', 'Koneksi ke server MES putus', [], 'Tidak'],
    ['Mesin berhenti', 'Setting berubah', 'Setting ulang', 'Barcode scanner tidak terbaca MES', []]]
};
const JORDER = ['Elektrikal', 'Mekanikal', 'Elektrikal', 'Pneumatik', 'Mekanikal', 'Program', 'Elektrikal', 'Operasional', 'Mekanikal',
  'Pneumatik', 'Elektrikal', 'Produk', 'Mekanikal', 'MES', 'Elektrikal', 'Program', 'Pneumatik', 'Mekanikal', 'Operasional', 'Elektrikal'];
const ZH = [['加热板温度不稳定', '更换温控器并重新校准'], ['传送带打滑', '调整张紧轮'], ['气缸动作缓慢', '清洁电磁阀'], ['MES 数据上传失败', '重启网关']];
const COMBOS = [['L01', 'VF7'], ['L11', 'E22H'], ['L01-W', 'Limo7'], ['L12', 'E245'], ['L02', 'VF7'], ['L13', 'E245'], ['L03-A', 'VF7'],
  ['L01', 'Limo7'], ['L11', 'E22H'], ['L03-B', 'Limo7'], ['L02', 'Limo7'], ['L13', 'E22H'], ['L12', 'E245'], ['L01-W', 'VF7']];

const ids = { pending: [], cancelled: [], abandoned: [] };
const open = (email, line, bat, stopLine) => as(email, () => ctx.apiStart(line, { baterai: bat, stopLine }).open.id);
const selesai = (email, id, k, jenis, v) => {
  const [masalah, penyebab, penanganan, detail, parts] = v;
  const isLain = masalah.indexOf('Lainnya: ') === 0;
  const x = { values: { 'Jenis kerusakan': jenis, Masalah: isLain ? 'Lainnya' : masalah, Penyebab: penyebab, Penanganan: penanganan },
    other: isLain ? { Masalah: masalah.slice(9) } : {}, parts: parts.map(p => Object.assign({}, p)), tanpaPart: !parts.length };
  if (email === T.li) { const z = ZH[k % ZH.length]; x.values['Detail masalah'] = z[0]; x.values['Detail penanganan'] = z[1]; }
  else if (detail && k % 3 !== 2) x.values['Detail masalah'] = detail;
  if (k % 8 === 5) x.values['Catatan'] = 'Perlu dicek ulang minggu depan';
  if (k % 5 === 4) x.pics = [TECHS[(TECHS.indexOf(email) + 1) % TECHS.length]].concat(k % 10 === 9 ? [TECHS[(TECHS.indexOf(email) + 2) % TECHS.length]] : []);
  as(email, () => ctx.apiComplete(id, x));
};

// hari operasi (Sen–Sab) dari ±12 minggu lalu sampai kemarin; satu hari Minggu (lembur) ikut
const days = [];
for (let d = 82; d >= 1; d--) { const t = today0 - d * DAY; if (dow(t) !== 0 || d === 40) days.push(t); }
const NORMAL = 93;
const perDay = days.map(() => []);
for (let i = 0; i < NORMAL; i++) perDay[Math.floor(i * days.length / NORMAL)].push(i);
// kejadian khusus ditempel ke hari tertentu (urutan waktu tetap)
const special = {};
const put = (dayIdx, ev) => { (special[dayIdx] = special[dayIdx] || []).push(ev); };
const N = days.length;
put(Math.floor(N * 0.45), 'abandon-hitung'); put(N - 9, 'abandon-keluarkan'); put(N - 2, 'abandon-tunggu');
put(Math.floor(N * 0.3), 'cancel'); put(N - 12, 'cancel'); put(N - 5, 'cancel'); put(N - 1, 'cancel');   // 2.6.1: Cancel tanpa review
put(N - 4, 'pending-lewat'); put(N - 3, 'pending-tanggal'); put(N - 1, 'pending-besok'); put(N - 1, 'pending-shift');

let k = 0;
days.forEach((day0, di) => {
  let tMin = 7 * 60 + 30 + (di * 17) % 50;                           // jam mulai pekerjaan pertama hari itu
  perDay[di].forEach((i) => {
    const email = i % 9 === 4 ? T.li : TECHS[i % TECHS.length];
    let [line, bat] = COMBOS[(i * 5) % COMBOS.length];
    if (di < N * 0.35 && i % 11 === 3) { line = 'L09'; bat = 'VF7'; }   // line yang kemudian dibongkar (nonaktif)
    const jenis = JORDER[i % JORDER.length], v = JENIS[jenis][i % JENIS[jenis].length];
    const aktif = 15 + (i * 23) % 70;
    at(day0, 0, tMin);
    const id = open(email, line, bat, v[5] || '');
    if (i % 5 === 1) {                                                // pause sebentar
      at(day0, 0, tMin + 10); as(email, () => ctx.apiPause(id, { values: { 'Alasan pause': i % 2 ? 'Ambil part/alat' : 'Istirahat' } }));
      at(day0, 0, tMin + 25); as(email, () => ctx.apiResume(id));
      tMin += 15;
    }
    if (i % 7 === 3) {                                                // pending → dilanjutkan teknisi lain sore hari → selesai
      at(day0, 0, tMin + 35);
      as(email, () => ctx.apiPending(id, { values: { 'Pekerjaan dilakukan': 'Bongkar & cek, part pengganti belum ada', 'Yang tertunda': 'Menunggu part' }, tenggat: 'HARI_INI' }));
      const next = TECHS[(TECHS.indexOf(email) + 3) % TECHS.length] === email ? T.budi : TECHS[(TECHS.indexOf(email) + 3) % TECHS.length];
      tMin += 35 + 240;
      at(day0, 0, tMin); as(next, () => ctx.apiContinue(id, line));
      at(day0, 0, tMin + aktif); selesai(next, id, k++, jenis, v);
      tMin += aktif + 30;
      return;
    }
    at(day0, 0, tMin + aktif);
    selesai(email, id, k++, jenis, v);
    tMin += aktif + 60 + (i * 13) % 90;
  });
  (special[di] || []).forEach((ev) => {
    tMin = Math.max(tMin, 18 * 60);
    if (ev.indexOf('cancel') === 0) {
      at(day0, 0, tMin); const id = open(T.dewi, 'L13', 'E245');
      at(day0, 0, tMin + 3);
      as(T.dewi, () => ctx.apiCancel(id, { values: { 'Alasan cancel': di % 2 ? 'Salah line' : 'Input ganda' } }));
      ids.cancelled.push(id);
      tMin += 20;
    } else if (ev.indexOf('abandon') === 0) {                           // shift malam: lupa ditutup → peringatan 3 jam → Abandoned 4 jam
      at(day0, 22, 0); const id = open(T.rizki, 'L12', 'E245');
      at(day0, 25, 5); ctx.checkTimeouts();
      at(day0, 26, 10); ctx.checkTimeouts();
      at(day0, 27, 0);
      if (ev === 'abandon-hitung') as(ADMIN, () => ctx.apiReview(id, { action: 'HITUNG', activeMin: 45, note: 'Konfirmasi via telepon: selesai ±45 menit' }));
      if (ev === 'abandon-keluarkan') as(ADMIN, () => ctx.apiReview(id, { action: 'KELUARKAN', note: 'Tidak jelas, tidak dihitung' }));
      ids.abandoned.push(id);
    } else if (ev.indexOf('pending') === 0) {
      const who = { 'pending-lewat': T.andi, 'pending-tanggal': T.sari, 'pending-besok': T.li, 'pending-shift': T.budi }[ev];
      const line = { 'pending-lewat': 'L03-A', 'pending-tanggal': 'L11', 'pending-besok': 'L03-B', 'pending-shift': 'L02' }[ev];
      const bat = { 'L03-A': 'VF7', L11: 'E22H', 'L03-B': 'Limo7', L02: 'VF7' }[line];
      at(day0, 0, tMin); const id = open(who, line, bat);
      at(day0, 0, tMin + 40);
      const tenggat = { 'pending-lewat': 'HARI_INI', 'pending-tanggal': 'TANGGAL', 'pending-besok': 'BESOK', 'pending-shift': 'SHIFT' }[ev];
      const tgl = ctx.Utilities.formatDate(new Date(today0 + 7 * DAY), 'Asia/Jakarta', 'yyyy-MM-dd');
      as(who, () => ctx.apiPending(id, { values: { 'Pekerjaan dilakukan': who === T.li ? '已检查充电模块，通讯板损坏' : 'Cek wiring & konektor, kabel putus',
        'Yang tertunda': ev === 'pending-tanggal' ? 'Menunggu jadwal stop produksi' : 'Menunggu part', Catatan: who === T.li ? '备件已下单' : 'Part sudah di-PO' },
      tenggat, tanggal: tgl }));
      ids.pending.push(id);
      tMin += 60;
    }
  });
});
// line L09 dibongkar: nonaktif (data lama tetap dihitung KPI bulan itu)
const lh = L.data[0];
L.data.find((r, i) => i && r[lh.indexOf('Line ID')] === 'L09')[lh.indexOf('Aktif')] = 'Tidak';
ctx.invalidateMaster_();
setTime(nowMs);

// ---------- urutan yang sama dengan ujiIsiData() di Apps Script: setup ulang, tutup bulan lalu ----------
const M = new Date(today0 + 7 * 3600e3).getUTCMonth() + 1;
const prevKey = M === 1 ? (year - 1) + '-12' : year + '-' + String(M - 1).padStart(2, '0');
ctx.setup();
as(ADMIN, () => ctx.apiTutupBulan(prevKey));

const todayKey = ctx.Utilities.formatDate(new Date(nowMs), 'Asia/Jakarta', 'yyyy-MM-dd');
module.exports = { ADMIN, ENZO, CONFIG, ids, year, prevKey, todayKey, generatedMs: nowMs, picEmail: T.budi };
