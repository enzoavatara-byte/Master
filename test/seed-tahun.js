/**
 * Data uji beban 1 tahun (2.6.1) untuk spreadsheet uji Cikarang (dipakai test/gas-tahun.js):
 * ±15 laporan per hari, Senin–Minggu, 365 hari sampai kemarin, dibuat lewat API asli di atas mock dengan jam palsu.
 * Isi = kasus asli Troublelog F1 (test/data/pola-troublelog.json: teks masalah / penyebab / penanganan, durasi, stop line,
 * jumlah PIC, jam kejadian) di line asli "Maintenance Bogor" (test/data/lines-bogor.json). Orang fiktif (@example.com),
 * email peringatan mati. PRNG ber-seed: data sama setiap dijalankan pada tanggal yang sama.
 *   node test/seed-tahun.js   → ringkasan sebaran (tanpa menulis file)
 */
'use strict';
const { ctx, ss, clock, user } = require('./mock');
const POLA = require('./data/pola-troublelog.json');
const LINES = require('./data/lines-bogor.json').lines;

const RealNow = Date.now;
let shiftMs = 0;
Object.defineProperty(clock, 'now', { get: () => RealNow() + shiftMs, set: (v) => { shiftMs = v - RealNow(); } });
const setTime = (ms) => { shiftMs = ms - RealNow(); };
const as = (email, fn) => { const p = user.email; user.email = email; try { return fn(); } finally { user.email = p; } };

// ---------- acak ber-seed ----------
let seed = 0x20261024 >>> 0;
const rnd = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const weighted = (w) => { const s = w.reduce((a, b) => a + b, 0); let x = rnd() * s; for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; } return w.length - 1; };

// ---------- waktu (WIB) ----------
const MIN = 60000, H = 3600000, DAY = 86400000;
const nowMs = RealNow();
const wib0 = (ms) => { const j = new Date(ms + 7 * H); return Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - 7 * H; };
const W = (ms) => new Date(ms + 7 * H);                       // getUTC* = jam WIB
const pad = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = W(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
const dmy = (ms) => { const d = W(ms); return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
const hm = (ms) => { const d = W(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
const today0 = wib0(nowMs), START = today0 - 365 * DAY, CUTOFF = today0;   // data s/d kemarin 24:00
const at0 = (y, m, d) => Date.UTC(y, m - 1, d) - 7 * H;
const monthKey = (ms) => ymd(ms).slice(0, 7);

// ---------- master ----------
setTime(START - DAY + 8 * H);
ctx.setup();
const rowOf = (sheet, obj) => ctx.objToRow_(ss.getSheetByName(sheet).data[0].map(h => String(h).trim()), obj);
const tableOf = (sheet, objs) => { const sh = ss.getSheetByName(sheet); sh.data = [sh.data[0]].concat(objs.map(o => rowOf(sheet, o))); };

const ADMIN = 'admin@uji.invalid';   // diganti email pelaksana di Apps Script
const SPV = 'spv@example.com';
const TECH = {};                     // email → {nama, zh, grup, masuk, keluar}
const GRUP = {
  A: [['agus', 'Agus Setiawan'], ['rudi', 'Rudi Hartono'], ['fajar', 'Fajar Nugroho'], ['wanglei', 'Wang Lei 王磊', 'zh']],
  B: [['dimas', 'Dimas Prasetyo'], ['eko', 'Eko Saputra'], ['hendra', 'Hendra Wijaya'], ['rizal', 'Rizal Fauzi']],
  C: [['bayu', 'Bayu Pratama'], ['joko', 'Joko Susilo'], ['rian', 'Rian Hidayat'], ['zhangwei', 'Zhang Wei 张伟', 'zh']],
  D: [['ilham', 'Ilham Ramadhan'], ['taufik', 'Taufik Hidayat']]          // non-shift, ikut shift pagi
};
const JOIN = { galih: { nama: 'Galih Permana', grup: 'B', masuk: at0(2026, 2, 2) } };   // teknisi baru (Feb)
const LEAVE = { rizal: at0(2026, 7, 1) };                                               // keluar (Jul)
Object.keys(GRUP).forEach(g => GRUP[g].forEach(([k, nama, lang]) => {
  TECH[k + '@example.com'] = { nama, zh: lang === 'zh', grup: g, masuk: 0, keluar: LEAVE[k] || Infinity };
}));
Object.keys(JOIN).forEach(k => { TECH[k + '@example.com'] = Object.assign({ zh: false, keluar: Infinity }, JOIN[k]); });
const userRow = (email) => { const t = TECH[email]; return { Email: email, Nama: t.nama, Peran: 'Teknisi', Aktif: 'Ya', Bahasa: t.zh ? 'zh' : '' }; };
tableOf('Users', [{ Email: ADMIN, Nama: 'Admin Uji', Peran: 'Admin', Aktif: 'Ya', Bahasa: '' },
  { Email: SPV, Nama: 'Supervisor Maintenance', Peran: 'Admin', Aktif: 'Ya', Bahasa: '' }]
  .concat(Object.keys(TECH).filter(e => !TECH[e].masuk).map(userRow)));

tableOf('Factory', [['F1', 'Factory 1 (Limo)'], ['F2', 'Factory 2 (Geely)'], ['F6', 'Factory 6 (2W)'], ['F10', 'Factory 10 (2W)']]
  .map(([id, nama]) => ({ 'Factory ID': id, Nama: nama, Lokasi: 'Bogor', Aktif: 'Ya' })));
tableOf('Projects', [['F1', 'Limo7', 'Mass Production', 40, 150], ['F1', 'VF7', 'Trial', 45, 120], ['F2', 'E22H', 'Mass Production', 35, 120],
  ['F2', 'E245', 'Ramp-up', 45, 100], ['F6', '2W', 'Mass Production', 30, 200], ['F10', '2W', 'Mass Production', 30, 200]]
  .map(([f, b, fase, mttr, mtbf]) => ({ 'Factory ID': f, Baterai: b, Fase: fase, 'Target MTTR (menit)': mttr, Aktif: 'Ya', 'Target MTBF (jam)': mtbf })));

// Lines asli; sumber punya 1 Line ID dobel (GX-YN-01-4097 di F1 & F6) dan nama kembar dalam satu factory → diberi pembeda.
const nameCount = {}, nameSeen = {};
LINES.forEach(l => { const k = l[3] + '|' + l[1]; nameCount[k] = (nameCount[k] || 0) + 1; });
const LN = LINES.map(([id, nama, proses, fac, bat, area, aktif, zh]) => {
  if (id === 'GX-YN-01-4097' && fac === 'F6') id = 'GX-YN-01-4148';
  const k = fac + '|' + nama;
  if (nameCount[k] > 1) { nameSeen[k] = (nameSeen[k] || 0) + 1; nama += ' #' + nameSeen[k]; zh += ' #' + nameSeen[k]; }
  return { id, nama, proses, fac, bat: bat || '2W', area, aktif: 'Ya', zh, w: 1 };
});
tableOf('Lines', LN.map(l => ({ 'Line ID': l.id, 'Nama Line': l.nama, Proses: l.proses, 'Factory ID': l.fac, Baterai: l.bat, Area: l.area,
  Aktif: l.aktif, 'Nama (中文)': l.zh, 'Nama (English)': l.nama })));
LN.forEach(l => { l.w = chance(0.15) ? 4 : 1; });   // ±15% mesin "kronis" (Pareto)

// Katalog dari isi Troublelog
const CATALOG = [
  ['Elektrikal', 'Sensor photoelectric', 'Omron E3Z-D61', 'pcs'], ['Elektrikal', 'Sensor proximity', 'Omron E2E-X5ME1', 'pcs'],
  ['Elektrikal', 'Sensor red switch silinder', 'SMC D-A93', 'pcs'], ['Elektrikal', 'Sensor infrared kamera', 'Keyence PZ-G51N', 'pcs'],
  ['Elektrikal', 'RFID tag pallet', 'Balluff BIS M-1', 'pcs'], ['Elektrikal', 'Kabel sensor', 'M12 4 pin 5 m', 'pcs'],
  ['Elektrikal', 'Kabel LAN', 'Cat6 2 m', 'pcs'], ['Elektrikal', 'Power supply', 'Mean Well NDR-240-24', 'pcs'], ['Elektrikal', 'Fuse', '2A', 'pcs'],
  ['Elektrikal', 'Relay', 'Omron MY2N 24VDC', 'pcs'], ['Elektrikal', 'Coil solenoid', 'SMC 24VDC', 'pcs'], ['Elektrikal', 'Baterai scanner', 'Li-ion 3.7V', 'pcs'],
  ['Pneumatik', 'Selang PU', '6 mm', 'meter'], ['Pneumatik', 'Selang PU', '8 mm', 'meter'], ['Pneumatik', 'Fitting push-in', '10 mm', 'pcs'],
  ['Pneumatik', 'Seal kit silinder', 'SMC CQ2B32', 'set'], ['Pneumatik', 'O-ring alat ukur AT', 'NBR 20x2', 'pcs'],
  ['Pneumatik', 'Balon air tightness', 'Karet 60 mm', 'pcs'], ['Pneumatik', 'Solenoid valve', 'SMC SY5120', 'pcs'],
  ['Mekanikal', 'Static mixer lem', 'MC 10-24', 'pcs'], ['Mekanikal', 'Nozzle lem', '1.2 mm', 'pcs'], ['Mekanikal', 'Inlet valve lem', '2K', 'pcs'],
  ['Mekanikal', 'Gripper / jig OCV', 'FX021', 'pcs'], ['Mekanikal', 'Baut', 'M6 x 20 SUS', 'pcs'], ['Mekanikal', 'Stopper conveyor', '30 mm', 'pcs'],
  ['Mekanikal', 'Lensa pelindung laser', '120 x 5 mm', 'pcs'], ['Mekanikal', 'Lem 2K', 'Kuning / biru', 'cartridge'],
  ['Mekanikal', 'Bearing', '6205-2RS', 'pcs'], ['Mekanikal', 'Timing belt', 'HTD 5M-450', 'pcs'], ['Program', 'Backup program PLC', '', 'kali']];
tableOf('Sparepart', CATALOG.map(([j, n, m, s], i) => ({ 'Jenis Sparepart': j, 'Nama Sparepart': n, Model: m, Satuan: s, Urutan: i + 1, Aktif: 'Ya' })));
const PART = {};
CATALOG.forEach(([j, n, m]) => { PART[n + (n === 'Selang PU' ? ' ' + m : '')] = ctx.partId_(j, n, m); });

// Pilihan sesuai kasus di Troublelog (label 中文 / English diisi admin)
const OPSI = {
  Masalah: [['Robot stuck / alarm', '机器人卡住/报警', 'Robot stuck / alarm'], ['Vision / photo point NG', '视觉/拍照点NG', 'Vision / photo point NG'],
    ['Lem tidak standar / mampet', '胶水不达标/堵塞', 'Glue off-spec / clogged'], ['Conveyor / tray stuck', '输送线/托盘卡住', 'Conveyor / tray stuck'],
    ['RFID / baca kode error', 'RFID/读码错误', 'RFID / code reading error'], ['Sensor error', '传感器故障', 'Sensor error'],
    ['MES / komputer error', 'MES/电脑故障', 'MES / computer error'], ['Printer / scanner error', '打印机/扫码枪故障', 'Printer / scanner error'],
    ['Kebocoran angin / silinder', '漏气/气缸故障', 'Air leak / cylinder'], ['Hasil uji NG (AT / EOL / OCV)', '测试NG（气密/EOL/OCV）', 'Test NG (AT / EOL / OCV)'],
    ['Part lepas / patah / kendur', '零件脱落/断裂/松动', 'Part loose / broken'], ['Kabel / power / servo error', '线缆/电源/伺服故障', 'Cable / power / servo error'],
    ['Hasil welding NG / lensa', '焊接不良/镜片', 'Welding NG / lens']],
  Penyebab: [['Posisi robot / servo hilang', '机器人/伺服位置丢失', 'Robot / servo position lost'], ['Vision / kamera NG', '视觉/相机NG', 'Vision / camera NG'],
    ['Program / parameter / bug', '程序/参数/软件错误', 'Program / parameter / bug'], ['Kabel / konektor longgar', '线缆/接头松动', 'Loose cable / connector'],
    ['Baut kendur / part patah', '螺丝松动/零件断裂', 'Loose bolt / broken part'], ['Komponen aus / rusak / habis', '部件磨损/损坏/耗尽', 'Worn / broken / used up'],
    ['Kotor / tersumbat', '脏污/堵塞', 'Dirty / clogged'], ['Kesalahan operasi', '操作失误', 'Operating error']],
  Penanganan: [['Home / reset / restart', '回原点/复位/重启', 'Home / reset / restart'], ['Adjust / setting ulang', '调整/重新设定', 'Adjust / re-set'],
    ['Bersihkan', '清洁', 'Clean'], ['Ganti part', '更换零件', 'Replace part'], ['Kencangkan / sambung ulang', '紧固/重新连接', 'Tighten / reconnect'],
    ['Remote / panggil vendor', '远程/联系供应商', 'Remote / call vendor']]
};
const OPSI_TAMBAH = { 'Alasan Pause': [['Menunggu operator / produksi', '等待操作员/生产', 'Waiting for operator']],
  'Yang Tertunda': [['Menunggu vendor / teknisi China', '等待供应商/中方技术员', 'Waiting for vendor']],
  'Alasan Cancel': [['Sudah ditangani operator', '操作员已处理', 'Handled by operator']] };
(function () {
  const P = ss.getSheetByName('Pilihan'), h = P.data[0].map(String);
  P.data = P.data.filter((r, i) => i === 0 || !OPSI[r[h.indexOf('Jenis')]]);
  const add = (jenis, list, from) => list.forEach(([v, zh, en], i) => P.appendRow(rowOf('Pilihan',
    { Jenis: jenis, Nilai: v, Urutan: from + i + 1, Aktif: 'Ya', 'Nilai (中文)': zh, 'Nilai (English)': en })));
  Object.keys(OPSI).forEach(j => add(j, OPSI[j], 0));
  Object.keys(OPSI_TAMBAH).forEach(j => add(j, OPSI_TAMBAH[j], 10));
})();
const CONFIG = { NAMA_APLIKASI: 'MTTR Uji 1 Tahun', EMAIL_PERINGATAN: 'Tidak', JAM_OPERASI_PER_HARI: 22, HARI_OPERASI: 'Sen-Min',
  TANGGAL_LIBUR: '01/01/2026, 20/03/2026, 21/03/2026', KPI_MULAI: dmy(START), LAPORAN_LANGSUNG: 'Tidak' };
const setConfig = (k, v) => { const C = ss.getSheetByName('Config'), ch = C.data[0]; const r = C.data.find((x, i) => i && x[ch.indexOf('Key')] === k); r[ch.indexOf('Value')] = v; };
Object.keys(CONFIG).forEach(k => setConfig(k, CONFIG[k]));
ctx.invalidateMaster_();

// ---------- kasus → isian aplikasi ----------
const KLASTER = {
  vision: ['Program', 'Vision / photo point NG'], robot: ['Program', 'Robot stuck / alarm'], lem: ['Mekanikal', 'Lem tidak standar / mampet'],
  rfid: ['Elektrikal', 'RFID / baca kode error'], conveyor: ['Mekanikal', 'Conveyor / tray stuck'], sensor: ['Elektrikal', 'Sensor error'],
  mes: ['MES', 'MES / komputer error'], printer: ['MES', 'Printer / scanner error'], angin: ['Pneumatik', 'Kebocoran angin / silinder'],
  uji: ['Produk', 'Hasil uji NG (AT / EOL / OCV)'], mekanik: ['Mekanikal', 'Part lepas / patah / kendur'],
  listrik: ['Elektrikal', 'Kabel / power / servo error'], laser: ['Mekanikal', 'Hasil welding NG / lensa']
};
const PENYEBAB = [[/bug|program|software|parameter|offs[ei]|setting|limit|teach|\bmes\b|aplikasi|server|internet|jaringan|komunikasi|communication/, 'Program / parameter / bug'],
  [/kotor|debu|kering|gumpal|kontamin|tersumbat|mampet|bercak/, 'Kotor / tersumbat'],
  [/kabel|cable|konektor|connector|soket|socket|\blan\b|loss|longgar/, 'Kabel / konektor longgar'],
  [/baut|baud|bolt|screw|kendur|patah|crack|pecah|lepas/, 'Baut kendur / part patah'],
  [/aus|rusak|broken|mati|habis|bocor|robek|getas|weak|lemah/, 'Komponen aus / rusak / habis'],
  [/operator|salah|tertabrak|ditabrak/, 'Kesalahan operasi'],
  [/robot|home|posisi|stuck|servo|encoder|zero/, 'Posisi robot / servo hilang'],
  [/\bng\b|vision|photo|foto|kamera|camera/, 'Vision / kamera NG']];
const PENANGANAN = [[/vendor|supplier|china|cina|nanshi|nanchi|\btka\b|remote|tiongkok/, 'Remote / panggil vendor'],
  [/ganti|penggantian|pergantian|tuker|tukar|replace|\bbaru\b/, 'Ganti part'],
  [/bersih|clean|flushing/, 'Bersihkan'],
  [/kencang|tighten|sambung|connect|hubungkan|pasang/, 'Kencangkan / sambung ulang'],
  [/adjust|setting|kalibrasi|calibrat|teach|parameter|sesuai|offset|modifikasi|repair progam|program/, 'Adjust / setting ulang'],
  [/home|reset|init|restart|start|auto|manual/, 'Home / reset / restart']];
const PART_RULE = [[/lensa/, 'Lensa pelindung laser'], [/red switch/, 'Sensor red switch silinder'], [/infrared/, 'Sensor infrared kamera'],
  [/sensor (photo|foto)|photoelectric|fotoelektrik/, 'Sensor photoelectric'], [/sensor/, 'Sensor proximity'], [/selang/, 'Selang PU 6 mm'],
  [/fitting/, 'Fitting push-in'], [/balon/, 'Balon air tightness'], [/(ring|karet).*(alat ukur|\bat\b)|teflon/, 'O-ring alat ukur AT'],
  [/seal|karet|ring/, 'Seal kit silinder'], [/mixer|selongsong/, 'Static mixer lem'], [/valve|katup/, 'Inlet valve lem'],
  [/selenoid|solenoid|coil/, 'Coil solenoid'], [/rfid/, 'RFID tag pallet'], [/\blan\b/, 'Kabel LAN'], [/kabel|cable/, 'Kabel sensor'],
  [/power su/, 'Power supply'], [/sikring|fuse/, 'Fuse'], [/relay/, 'Relay'], [/gripper|griper|\bjig\b|clamp/, 'Gripper / jig OCV'],
  [/stopper|stoper/, 'Stopper conveyor'], [/baut|baud|bolt|screw|\bnut\b/, 'Baut'], [/ganti lem|lem habis|pergantian lem/, 'Lem 2K'],
  [/baterai scanner|baterai/, 'Baterai scanner']];
const ZH = {
  vision: ['视觉拍照点NG，机器人停止', '拍照点参数偏移', '调整拍照点参数，复位后启动'], robot: ['机器人卡住无法回原点', '机器人位置丢失', '手动回原点，初始化后自动运行'],
  lem: ['胶水颜色不达标', '混合管堵塞', '更换混合管，冲洗胶阀'], rfid: ['RFID读不到托盘码', 'RFID螺丝断裂脱落', '更换螺丝重新安装RFID'],
  conveyor: ['输送线卡住', '托盘位置不正', '调整托盘位置，复位输送线'], sensor: ['传感器不检测', '传感器脏污', '清洁传感器并调整位置'],
  mes: ['MES数据上传失败', '网络连接中断', '重启电脑，重新连接MES'], printer: ['打印机无法打印条码', '打印机卡纸', '重启打印机并清理'],
  angin: ['气密测试一直NG', '密封圈漏气', '更换密封圈'], uji: ['EOL测试NG', '测试线松动', '紧固测试线后重新测试'],
  mekanik: ['挡块脱落', '螺丝松动', '重新安装并紧固螺丝'], listrik: ['伺服报警无法回零', '编码器读数错误', '复位伺服并手动回零'],
  laser: ['焊接不良', '保护镜片脏污', '更换保护镜片']
};
const firstMatch = (rules, text, def) => { for (const [re, v] of rules) if (re.test(text)) return v; return def; };
const DEF_PENYEBAB = { vision: 'Vision / kamera NG', robot: 'Posisi robot / servo hilang', lem: 'Komponen aus / rusak / habis', mes: 'Program / parameter / bug',
  printer: 'Program / parameter / bug', angin: 'Komponen aus / rusak / habis', uji: 'Kabel / konektor longgar' };
const NON_PART = /\b(meja|modul|produk|pack|tray|cell|baki|palet|posisi|shift|program|aplikasi|software)\b/;
function isian(kasus, zh) {
  const [jenis0, masalah] = KLASTER[kasus.k];
  const lc = (kasus.c + ' ' + kasus.a).toLowerCase(), la = kasus.a.toLowerCase();
  const jenis = kasus.k === 'uji' && /kabel|cable|konektor|connector/.test(kasus.c.toLowerCase()) ? 'Elektrikal' : jenis0;
  const v = { 'Jenis kerusakan': jenis, Masalah: masalah, Penyebab: firstMatch(PENYEBAB, kasus.c.toLowerCase(), DEF_PENYEBAB[kasus.k] || 'Komponen aus / rusak / habis'),
    Penanganan: firstMatch(PENANGANAN, la, 'Home / reset / restart') };
  const t = zh && chance(0.6) ? ZH[kasus.k] : [kasus.p, kasus.c, kasus.a];
  v['Detail masalah'] = t[0]; v['Detail penyebab'] = t[1]; v['Detail penanganan'] = t[2];
  const parts = [];
  if (/ganti|penggantian|pergantian|tuker|tukar|replace|\bbaru\b/.test(la)) {
    for (const [re, nama] of PART_RULE) {
      if (parts.length < 2 && re.test(lc) && !parts.some(p => p.nama === nama)) parts.push({ nama, id: PART[nama], qty: /Baut|Selang/.test(nama) ? between(2, 4) : 1 });
    }
    if (!parts.length) {   // "ganti <benda>" yang tidak ada di katalog → part manual (nama dari teks)
      const m = /(?:ganti|penggantian|pergantian)\s+([a-z0-9 \-]{3,30})/.exec(la);
      const nama = m ? m[1].split(/\s+/).slice(0, 3).join(' ').trim() : '';
      if (nama && !NON_PART.test(nama)) parts.push({ manual: true, jenis, nama: nama.charAt(0).toUpperCase() + nama.slice(1), model: '', qty: 1 });
    }
  }
  if (v.Penanganan === 'Ganti part' && !parts.length) v.Penanganan = firstMatch(PENANGANAN.slice(2), la, 'Home / reset / restart');
  return { values: v, parts };
}

// ---------- pemilihan line ----------
const RULES = {
  F1: [[/weld|las\b|pengelasan|indenter|nozzle|nozel/, /Integrated Cover Welding/], [/pole|addres|photo ?point|photopoint/, /Terminal Addressing/],
    [/cell on|online|ocv|scan/, /Cell Scanning|OCV Testing|Cell Terminal Cleaning/], [/plasma/, /Plasma Cleaning/],
    [/modul (to|in) box|modul to|module|crane modul/, /Module Loading into Housing|Module Tray Cart/],
    [/air ?tight|kedap|\bat\b|bocor|kebocoran/, /Air Tightness/], [/eol|finishing|profuse|equipot/, /EOL|Electrical Performance/],
    [/torsi|torque/, /Torque Tightening/], [/timbangan|crane/, /Overhead Crane/],
    [/pre.?load|preload|pre.?ass|lem kotak|glue kotak|gluing|\blem\b|glue|pengeleman/, /Housing Gluing|Center Partition|PACK Tray Cart|Housing Cleaning/],
    [/assembl|asembly|conveyor|stacking/, /PACK Conveyor|Cover Pressure|Module Tray Cart/]],
  F2: [[/weld|las\b|pengelasan|nozzle|nozel/, /Laser Welding Equipment|Post-Weld/], [/pole|addres|photo ?point|photopoint/, /Terminal Addressing Equipment|Terminal Cleaning/],
    [/cell on|online|ocv|robot/, /Cell OCV|Four-Axis|Six-Axis/], [/\blem\b|glue|adhesive|gluing|pengeleman|pre.?ass|pre.?load|preload/, /Adhesive|Gluing/],
    [/plasma/, /Plasma/], [/modul|stacking/, /Stacking|Module Loading|Automatic Module/], [/air ?tight|kedap|\bat\b|bocor/, /Air Tightness/],
    [/eol|finishing|profuse/, /EOL|Electrical Performance/], [/torsi|torque|baut/, /Torque Gun|Cover Torque/],
    [/conveyor|assembl|asembly/, /Top Compression|Extrusion|Cover Installation/]],
  F6: [[/weld|las\b|pengelasan/, /Laser Welding Machine|Ultrasonic Welding/], [/pole|addres/, /^Terminal Addressing$/],
    [/\blem\b|glue|gluing|pengeleman/, /Glue Dispensing/], [/eol|finishing|test|ocv/, /Battery Performance|Electrical Performance|Balancing/],
    [/torsi|torque|screw|baut/, /Screw/], [/conveyor|assembl|asembly|modul|stacking/, /Conveyor|STACKING/], [/crane|timbangan/, /Chain Hoist/],
    [/printer|print|scanner|label/, /Nameplate/]],
  F10: []
};
const FAC_W = { F1: 0.55, F2: 0.30, F6: 0.13, F10: 0.02 };
const activeLine = (l, t) => l.aktif === 'Ya' && !(l.fac === 'F10' && t >= at0(2026, 6, 1));
function lineCandidates(kasus, fac, t) {
  const pool = LN.filter(l => l.fac === fac && activeLine(l, t));
  const text = kasus.proc + ' ' + kasus.p.toLowerCase();
  let cand = pool;
  for (const [re, nameRe] of RULES[fac]) if (re.test(text)) { const c = pool.filter(l => nameRe.test(l.nama)); if (c.length) { cand = c; break; } }
  const ab = /line ?a\b|\ba$/.test(kasus.proc) ? / A\b|Line A/ : (/line ?b\b|\bb$/.test(kasus.proc) ? / B\b|Line B/ : null);
  if (ab) { const c = cand.filter(l => ab.test(l.nama)); if (c.length) cand = c; }
  return cand;
}
const batteryOf = (l, t) => {
  if (l.fac === 'F1') return chance(0.85) ? 'Limo7' : 'VF7';
  if (l.fac === 'F2') return chance(t < at0(2026, 4, 1) ? 0.6 : 0.4) ? 'E245' : 'E22H';   // E245 ramp-up: lebih sering di awal
  return '2W';
};

// ---------- teknisi & shift ----------
const shiftOf = (t) => { const h = W(t).getUTCHours(); return h >= 7 && h < 15 ? 0 : (h >= 15 && h < 23 ? 1 : 2); };
const weekOf = (t) => Math.floor((t - START + 4 * DAY) / (7 * DAY));
function onDuty(t) {
  const groups = ['A', 'B', 'C'], w = weekOf(t), s = shiftOf(t);
  // shift malam 23:00–07:00: jam 00–06 ikut grup malam hari sebelumnya (minggu yang sama cukup)
  const g = groups[(s + w) % 3];
  return Object.keys(TECH).filter(e => {
    const x = TECH[e];
    if (x.masuk > t || x.keluar <= t) return false;
    return x.grup === g || (x.grup === 'D' && s === 0);
  });
}
const busy = {};        // email / line → [[a, b], …]
let planNow = 0;        // waktu pekerjaan yang sedang direncanakan: jadwal yang sudah lewat boleh dibuang
const free = (k, a, b) => !(busy[k] || []).some(([x, y]) => a < y + MIN && x < b + MIN);   // jeda ≥ 1 menit: kejadian di menit sama tidak bentrok
const reserve = (k, a, b) => { (busy[k] = busy[k] || []).push([a, b]); if (busy[k].length > 60) busy[k] = busy[k].filter(([, y]) => y > planNow - DAY); };

// ---------- rencana pekerjaan → kejadian berurutan waktu ----------
const events = [];
let seq = 0;
const ev = (t, fn) => events.push({ t, s: seq++, fn });
const stats = { jobs: 0, flow: {}, fac: {}, hour: new Array(24).fill(0), dur: [], parts: 0, manualParts: 0, pics: 0, zh: 0, skipped: 0, manualInput: 0 };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const jobs = [];
const MEAL = [[12, 0], [18, 0], [0, 30]];

function confirmsBetween(job, a, b, email) {   // pekerjaan panjang: teknisi menekan "masih dikerjakan" tiap 150 menit
  for (let t = a + 150 * MIN; t < b - 5 * MIN; t += 150 * MIN) ev(t, () => job.id && as(email, () => ctx.apiConfirmStillWorking(job.id)));
}
function pickTech(t, span, not) {
  const list = onDuty(t).filter(e => e !== not && free(e, t, t + span));
  return list.length ? pick(list) : null;
}
function pickLine(kasus, t, span) {
  const fac = Object.keys(FAC_W)[weighted(Object.values(FAC_W))];
  const cand = lineCandidates(kasus, fac, t).filter(l => free(l.id, t, t + span));
  if (!cand.length) return null;
  return cand[weighted(cand.map(l => l.w))];
}

function planJob(t0) {
  planNow = t0;
  const kasus = pick(POLA.kasus);
  let dur = kasus.dur ? Math.round(kasus.dur * (0.75 + rnd() * 0.5)) : pick(POLA.durasi);
  dur = Math.max(3, Math.min(480, dur));
  const r = rnd(), night = W(t0).getUTCHours() >= 22 || W(t0).getUTCHours() < 1;
  let flow = r < 0.02 ? 'cancel' : (night && r < 0.035 ? 'abandon' : ((kasus.wait && chance(0.35)) || r > 0.98 ? 'pending' : (chance(0.15) ? 'pause' : 'normal')));
  const pauseLen = flow === 'pause' ? between(10, 40) : 0;
  const span = (flow === 'cancel' ? between(2, 8) : (flow === 'abandon' ? 255 : (flow === 'pending' ? Math.round(dur * (0.3 + rnd() * 0.3)) : dur + pauseLen))) * MIN;
  for (let tries = 0; tries < 5; tries++, t0 += 15 * MIN) {
    if (t0 + span >= CUTOFF) return false;
    const line = pickLine(kasus, t0, span), tech = line && pickTech(t0, span);
    if (!line || !tech) continue;
    const job = { id: '', line, tech, kasus, flow, t0 };
    jobs.push(job);
    reserve(tech, t0, t0 + span); reserve(line.id, t0, t0 + span);
    const zh = TECH[tech].zh, bat = batteryOf(line, t0), stopLine = kasus.stop ? 'Ya' : 'Tidak';
    ev(t0, () => { job.id = as(tech, () => ctx.apiStart(line.id, { baterai: bat, stopLine })).open.id; });
    stats.jobs++; bump(stats.flow, flow); bump(stats.fac, line.fac); stats.hour[W(t0).getUTCHours()]++;
    const selesai = (email, tEnd) => {
      const x = isian(kasus, TECH[email].zh);
      const mates = onDuty(tEnd).filter(e => e !== email);
      const pics = []; for (let i = 1; i < kasus.npic && mates.length; i++) { const m = pick(mates); if (pics.indexOf(m) === -1) pics.push(m); }
      if (chance(0.06)) x.values['Catatan'] = pick(['Perlu dicek ulang saat PM mingguan', 'Sudah info ke leader produksi', 'Stok part cadangan tinggal 1', 'Kejadian berulang, usul ganti part saat stop line']);
      if (x.parts.length) stats.parts++;
      if (x.parts.some(p => p.manual)) stats.manualParts++;
      if (pics.length) stats.pics++;
      if (TECH[email].zh && /[一-鿿]/.test(x.values['Detail masalah'])) stats.zh++;
      ev(tEnd, () => job.id && as(email, () => ctx.apiComplete(job.id, { values: x.values, parts: x.parts.map(p => (p.manual ? p : { id: p.id, qty: p.qty })),
        tanpaPart: !x.parts.length, pics })));
    };
    if (flow === 'cancel') {
      ev(t0 + span, () => job.id && as(tech, () => ctx.apiCancel(job.id, { values: { 'Alasan cancel': pick(['Salah line', 'Input ganda', 'Masalah hilang sendiri', 'Sudah ditangani operator']) } })));
    } else if (flow === 'abandon') {   // shift malam, lupa ditutup: peringatan 3 jam → Abandoned 4 jam → review admin pagi
      ev(t0 + 185 * MIN, () => ctx.checkTimeouts());
      ev(t0 + 250 * MIN, () => ctx.checkTimeouts());
      const tr = wib0(t0 + 6 * H) + between(8 * 60 + 30, 10 * 60 + 30) * MIN;
      if (tr < CUTOFF) {
        const hitung = chance(0.7);
        ev(tr, () => job.id && as(chance(0.5) ? ADMIN : SPV, () => ctx.apiReview(job.id, hitung
          ? { action: 'HITUNG', activeMin: dur, note: 'Dikonfirmasi ke teknisi: selesai ±' + dur + ' menit, lupa tekan Selesai' }
          : { action: 'KELUARKAN', note: 'Tidak jelas, tidak dihitung' })));
      }
    } else if (flow === 'pending') {
      const tp = t0 + span;
      confirmsBetween(job, t0, tp, tech);
      const vendor = /vendor|supplier|china|cina|nanshi|remote/.test(kasus.a.toLowerCase());
      const tunda = vendor ? 'Menunggu vendor / teknisi China' : (/ganti|part|spare/.test(kasus.a.toLowerCase()) ? 'Menunggu part' : pick(['Menunggu jadwal stop produksi', 'Butuh teknisi lain', 'Menunggu part']));
      const tenggat = tunda === 'Butuh teknisi lain' ? 'SHIFT' : (vendor ? 'TANGGAL' : 'BESOK');
      const gap = { 'Menunggu vendor / teknisi China': between(20, 72), 'Menunggu part': between(4, 30), 'Menunggu jadwal stop produksi': between(10, 26), 'Butuh teknisi lain': between(1, 8) }[tunda] * H;
      ev(tp, () => job.id && as(tech, () => ctx.apiPending(job.id, { values: { 'Pekerjaan dilakukan': ('Cek awal: ' + kasus.c).slice(0, 300), 'Yang tertunda': tunda,
        Catatan: vendor ? 'Vendor sudah dihubungi' : (tunda === 'Menunggu part' ? 'Part sudah diminta ke gudang' : '') }, tenggat, tanggal: ymd(tp + 3 * DAY) })));
      const rest = Math.max(5, dur - Math.round(span / MIN) + between(5, 20)) * MIN;
      let tc = tp + gap, tech2 = null;
      for (let k = 0; k < 96 && tc + rest < CUTOFF; k++, tc += 30 * MIN) {
        if (!free(line.id, tc, tc + rest)) continue;
        tech2 = pickTech(tc, rest);
        if (tech2) break;
      }
      if (tech2 && tc + rest < CUTOFF) {
        reserve(tech2, tc, tc + rest); reserve(line.id, tc, tc + rest);
        ev(tc, () => job.id && as(tech2, () => ctx.apiContinue(job.id, line.id)));
        confirmsBetween(job, tc, tc + rest, tech2);
        selesai(tech2, tc + rest);
      } else bump(stats.flow, 'pending-terbuka');
    } else {
      if (flow === 'pause') {
        const tp = t0 + Math.round(dur * (0.3 + rnd() * 0.4)) * MIN, h = W(tp).getUTCHours();
        const alasan = MEAL.some(([mh]) => Math.abs(h - mh) <= 1) ? 'Istirahat' : pick(['Ambil part/alat', 'Menunggu operator / produksi']);
        ev(tp, () => job.id && as(tech, () => ctx.apiPause(job.id, { values: { 'Alasan pause': alasan } })));
        ev(tp + pauseLen * MIN, () => job.id && as(tech, () => ctx.apiResume(job.id)));
      }
      confirmsBetween(job, t0, t0 + span, tech);
      selesai(tech, t0 + span);
    }
    stats.dur.push(dur);
    return true;
  }
  stats.skipped++;
  return false;
}

// Input Manual (admin, riwayat WeChat saat HP teknisi mati): ±4 per bulan, dimasukkan 1–2 hari kemudian
const manualRows = [];
function planManual(tJob, tInput, late) {
  const kasus = pick(POLA.kasus), dur = Math.max(5, Math.min(240, kasus.dur || pick(POLA.durasi)));
  const fac = chance(0.6) ? 'F1' : 'F2', line = pick(lineCandidates(kasus, fac, tJob));
  if (!line || !free(line.id, tJob, tJob + dur * MIN)) return;
  const tech = pickTech(tJob, dur * MIN);
  if (!tech) return;
  reserve(line.id, tJob, tJob + dur * MIN);
  const x = isian(kasus, false), part = x.parts.filter(p => !p.manual).map(p => {
    const c = CATALOG.find(c => c[1] === p.nama.replace(/ 6 mm$/, '')); return c[1] + (c[2] ? ' ' + c[2] : '') + ' x' + p.qty; }).join('; ');
  const mate = pick(onDuty(tJob).filter(e => e !== tech));
  const row = { Tanggal: dmy(tJob), 'Jam mulai': hm(tJob), 'Jam selesai': hm(tJob + dur * MIN), Line: line.id, Baterai: batteryOf(line, tJob),
    'Stop line': kasus.stop ? 'Ya' : 'Tidak', 'Jenis kerusakan': x.values['Jenis kerusakan'],
    Masalah: x.values.Masalah + ' – ' + kasus.p, Penyebab: x.values.Penyebab + ' – ' + kasus.c, Penanganan: x.values.Penanganan + ' – ' + kasus.a,
    Sparepart: part, PIC: TECH[tech].nama, 'PIC tambahan': kasus.npic > 1 && mate ? TECH[mate].nama : '',
    Catatan: late ? 'Dari laporan WeChat, baru dikirim setelah bulan ditutup' : 'Dari laporan WeChat (HP teknisi mati)' };
  stats.manualInput++;
  ev(tInput, () => {
    const M = ss.getSheetByName('Input Manual');
    M.appendRow(rowOf('Input Manual', row));
    const res = as(ADMIN, () => ctx.apiInputManual({}));
    manualRows.push({ row, res: res.summary || '', ids: res.ids || [] });
    if (late) as(ADMIN, () => ctx.apiTutupBulan(monthKey(tJob)));   // ⚠ bulan sudah ditutup → admin menutup ulang
  });
}

// ---------- kalender ----------
const FAKTOR_BULAN = { '01': 1.1, '02': 1.0, '03': 0.85, '04': 1.05, '05': 1.0, '06': 0.95, '07': 1.1, '08': 1.0, '09': 1.05, '10': 1.0, '11': 1.05, '12': 0.95 };
const LIBUR = ['2026-01-01', '2026-03-20', '2026-03-21'];
const hourW = POLA.jam.map(x => x + 1);
for (let d = 0; d < 365; d++) {
  const day0 = START + d * DAY, key = ymd(day0);
  const f = FAKTOR_BULAN[key.slice(5, 7)] * (LIBUR.indexOf(key) !== -1 ? 0.2 : 1);
  const n = Math.max(LIBUR.indexOf(key) !== -1 ? 1 : 6, Math.min(26, Math.round(15 * f + gauss() * 3.2)));
  const times = [];
  for (let i = 0; i < n; i++) times.push(day0 + weighted(hourW) * H + between(0, 59) * MIN);
  times.sort((a, b) => a - b).forEach(planJob);
  if (key.slice(8) === '05') ev(day0 + H, key.slice(5, 7) === '01' ? () => ctx.refreshRekap() : () => ctx.kpiTutupOtomatis_());   // trigger malam: tutup bulan otomatis
  if (d > 2 && chance(4 / 30)) planManual(day0 - between(1, 2) * DAY + between(7, 21) * H, day0 + between(9 * 60, 10 * 60) * MIN, false);
}
// satu laporan WeChat Februari yang baru masuk setelah tutup bulan (⚠) → admin menutup ulang Februari
planManual(at0(2026, 2, 26) + 14 * H, at0(2026, 3, 8) + 10 * H, true);
// perubahan master selama setahun
// tepat saat mulai bertugas (dulu 07:00): sebelumnya ia bisa dipilih sebagai PIC tambahan sebelum ada di Users
ev(JOIN.galih.masuk, () => { ss.getSheetByName('Users').appendRow(rowOf('Users', userRow('galih@example.com'))); ctx.invalidateMaster_(); });
ev(LEAVE.rizal + 7 * H, () => { const U = ss.getSheetByName('Users'), h = U.data[0]; U.data.find(r => r[0] === 'rizal@example.com')[h.indexOf('Aktif')] = 'Tidak'; ctx.invalidateMaster_(); });
ev(at0(2026, 6, 1) + 7 * H, () => { const L = ss.getSheetByName('Lines'), h = L.data[0];
  L.data.forEach((r, i) => { if (i && r[h.indexOf('Factory ID')] === 'F10') r[h.indexOf('Aktif')] = 'Tidak'; }); ctx.invalidateMaster_(); });

// ---------- jalankan ----------
events.sort((a, b) => a.t - b.t || a.s - b.s);
const errors = {};
const T0 = RealNow();
events.forEach((e, i) => {
  setTime(e.t);
  try { e.fn(); } catch (err) { const m = String(err && err.message || err).slice(0, 120); errors[m] = (errors[m] || 0) + 1; }
  if (process.env.SEED_PROGRESS && i % 5000 === 0) console.error('… ' + i + '/' + events.length + ' kejadian · ' + ymd(e.t) + ' · ' + Math.round((RealNow() - T0) / 1000) + ' dtk');
});
// produksi memakai Laporan langsung; setup terakhir seperti di Apps Script (tahap 2)
setConfig('LAPORAN_LANGSUNG', 'Ya');
CONFIG.LAPORAN_LANGSUNG = 'Ya';
ctx.invalidateMaster_();
setTime(nowMs);
ctx.setup();

const year = W(nowMs).getUTCFullYear();
const todayKey = ymd(nowMs);
module.exports = { ADMIN, SPV, CONFIG, year, todayKey, generatedMs: nowMs, start: ymd(START), end: ymd(CUTOFF - DAY), stats, errors, events: events.length,
  manualRows, seedMs: RealNow() - T0 };

if (require.main === module) {
  const d = stats.dur.slice().sort((a, b) => a - b), q = (p) => d[Math.floor(p * (d.length - 1))];
  console.log('periode ' + module.exports.start + ' – ' + module.exports.end + ' · ' + stats.jobs + ' pekerjaan (' + (stats.jobs / 365).toFixed(1) + '/hari) · ' +
    events.length + ' kejadian · ' + Math.round(module.exports.seedMs / 1000) + ' dtk');
  console.log('alur', JSON.stringify(stats.flow), '· factory', JSON.stringify(stats.fac), '· dilewati', stats.skipped);
  console.log('durasi median ' + q(0.5) + ' (p25 ' + q(0.25) + ', p75 ' + q(0.75) + ', p90 ' + q(0.9) + ', p95 ' + q(0.95) + ') · part ' + stats.parts +
    ' (manual ' + stats.manualParts + ') · PIC tambahan ' + stats.pics + ' · detail 中文 ' + stats.zh + ' · input manual ' + stats.manualInput);
  console.log('jam', stats.hour.join(' '));
  console.log('error', JSON.stringify(errors));
  const M = ctx.readTable_('Maintenance'), st = {};
  M.forEach(r => bump(st, r['Status'] + (r['Status review'] ? '/' + r['Status review'] : '')));
  console.log('Maintenance ' + M.length + ' ' + JSON.stringify(st) + ' · Log ' + ctx.readTable_('Log').length + ' · Pemakaian ' + ctx.readTable_('Pemakaian Sparepart').length +
    ' · KPI data ' + ctx.readTable_('KPI data').length);
  const hasil = {}; ctx.readTable_('Input Manual').forEach(r => bump(hasil, String(r['Hasil']).charAt(0)));
  console.log('Input Manual ' + manualRows.length + ' baris, kolom Hasil ' + JSON.stringify(hasil) + ' · contoh ' + JSON.stringify(ctx.readTable_('Input Manual').slice(-1).map(r => r['Hasil'])));
}
