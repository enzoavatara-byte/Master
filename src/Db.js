/**
 * Helper akses Google Sheets. Baris dipetakan ke object berdasarkan header baris pertama,
 * jadi urutan kolom di sheet boleh berubah selama nama header-nya sama.
 */

function sheet_(name) {
  var sh = findSheet_(name);
  if (!sh) throw new Error('Sheet "' + name + '" tidak ditemukan. Admin perlu menjalankan setup().');
  return sh;
}

/*
 * 2.6: tab pengaturan (APP.MASTER_SHEETS) boleh diganti nama langsung di Google Sheet. Kode selalu memakai nama bawaan
 * (nama logis, mis. 'Lines'); sheetId tiap tab dicatat di DocumentProperties (setup, atau saat pertama ditemukan).
 * Urutan cari: nama terakhir yang dicatat (sheetId dicek) → sheetId di semua tab (nama baru dicatat) → nama bawaan.
 * Tab buatan aplikasi (Maintenance, Log, Laporan, Rekap, TPM, KPI, …) tetap bernama tetap.
 */
var SHEET_IDS_KEY_ = 'MTTR_SHEET_IDS';
var SHEET_IDS_ = null;   // {nama logis: [sheetId, nama terakhir]} — dibaca sekali per eksekusi
function sheetIds_() {
  if (!SHEET_IDS_) {
    try { SHEET_IDS_ = JSON.parse(PropertiesService.getDocumentProperties().getProperty(SHEET_IDS_KEY_) || '{}') || {}; } catch (e) { SHEET_IDS_ = {}; }
  }
  return SHEET_IDS_;
}
function saveSheetIds_() {
  try { PropertiesService.getDocumentProperties().setProperty(SHEET_IDS_KEY_, JSON.stringify(SHEET_IDS_ || {})); } catch (e) { /* dicatat lagi lain kali */ }
}
function isMasterSheet_(name) { return APP.MASTER_SHEETS.indexOf(name) !== -1; }

/** Sheet berdasarkan nama logis; null jika tidak ada. Sheet non-pengaturan: getSheetByName biasa (1 panggilan). */
function findSheet_(name, ss) {
  ss = ss || SpreadsheetApp.getActive();
  if (!isMasterSheet_(name)) return ss.getSheetByName(name);
  var ids = sheetIds_(), rec = ids[name], sh = null;
  if (rec) {
    sh = ss.getSheetByName(rec[1]);
    if (sh && sh.getSheetId() !== rec[0]) sh = null;
    if (!sh) {
      sh = ss.getSheets().filter(function (x) { return x.getSheetId() === rec[0]; })[0] || null;
      if (sh) { rec[1] = sh.getName(); saveSheetIds_(); }
    }
  }
  if (!sh) {
    sh = ss.getSheetByName(name);
    if (sh) {
      var id = sh.getSheetId();
      // tab bernama bawaan ini ternyata tab pengaturan lain yang sudah diganti nama (mis. Lines → "Mesin")
      if (Object.keys(ids).some(function (k) { return k !== name && ids[k][0] === id; })) return null;
      ids[name] = [id, name];
      saveSheetIds_();
    }
  }
  return sh;
}

/** Nama logis tab pengaturan untuk sebuah sheet (onEdit, Tampilan); '' jika bukan tab pengaturan. */
function masterNameOf_(sh) {
  var name = sh.getName();
  if (isMasterSheet_(name)) return name;
  var ids = sheetIds_(), id = sh.getSheetId();
  return Object.keys(ids).filter(function (k) { return ids[k][0] === id; })[0] || '';
}

/** Setup: catat sheetId semua tab pengaturan yang ada (dipanggil setelah tab dibuat). */
function registerMasterSheets_(ss) {
  APP.MASTER_SHEETS.forEach(function (n) { findSheet_(n, ss); });
}

/** Nama tab sebenarnya (bisa sudah diganti admin), untuk teks petunjuk. */
function sheetLabel_(name) {
  var sh = findSheet_(name);
  return sh ? sh.getName() : name;
}

/** Header per sheet diingat selama satu request (hemat 2 panggilan Sheets per tulis). Kunci = nama logis. */
var HEAD_MEMO_ = {};
function resetHeaders_() { HEAD_MEMO_ = {}; SHEET_IDS_ = null; }
function forgetHeaders_(name) { delete HEAD_MEMO_[name]; }

/** @param {string=} key nama logis (bawaan: nama tab) */
function headers_(sh, key) {
  var name = key || sh.getName();
  if (HEAD_MEMO_[name]) return HEAD_MEMO_[name];
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  var h = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  HEAD_MEMO_[name] = h;
  return h;
}

function rowsToObjs_(headers, values, firstRow, anyCol) {
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (anyCol ? row.every(isBlank_) : isBlank_(row[0])) continue;
    var obj = { _row: firstRow + i };
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    out.push(obj);
  }
  return out;
}

function isBlank_(v) { return v === '' || v === null || v === undefined; }

/**
 * Semua baris data sebagai object. `_row` = nomor baris di sheet (1-based).
 * Default: baris dengan kolom pertama kosong dilewati (sheet data, kolom pertama = ID).
 * anyCol = true: hanya baris yang seluruhnya kosong yang dilewati (sheet master yang diisi admin).
 */
function readTable_(name, anyCol) {
  var values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  HEAD_MEMO_[name] = headers;
  return rowsToObjs_(headers, values.slice(1), 2, anyCol);
}

/** Baris terakhir Maintenance yang selalu dibaca tombol (readHot_): ±27 hari pada 15 pekerjaan/hari. */
var HOT_TAIL_ = 400;
var HOT_BLOCKS_MAX_ = 8;

/**
 * Baris Maintenance untuk tombol & layar teknisi tanpa membaca seluruh tab (2.6.3). Profil di Apps Script asli dengan
 * 4.500 pekerjaan: baca penuh 1,7 dtk dan biayanya mengikuti jumlah BARIS (kolom ID saja 1,3 dtk); 1 baris ±0,1 dtk,
 * cari di server dengan TextFinder ±0,13 dtk.
 * Isi: `tail` (bawaan HOT_TAIL_) baris terakhir + baris lebih lama yang masih Aktif / Pause / Pending atau menunggu review.
 * Syarat: baris baru selalu ditambah di bawah (Mulai, Input Manual) dan arsip / hapus data testing mempertahankan urutan,
 * jadi ID hari ini & pekerjaan beberapa minggu terakhir ada di ekor. Bentuk hasil = readTable_ (object + _row), urut baris.
 * Riwayat, Dashboard, Statistik, Download, KPI & Laporan tetap membaca penuh.
 */
function readHot_(tail) {
  var sh = sheet_(APP.SHEETS.MAINT), last = sh.getLastRow();
  tail = tail || HOT_TAIL_;
  if (last - 1 <= tail) return readTable_(APP.SHEETS.MAINT);   // tab masih kecil (awal pemakaian): satu baca biasa
  var h = headers_(sh, APP.SHEETS.MAINT), first = last - tail + 1, out = [], want = {};
  hotFind_(sh, h, 'Status', [APP.STATUS.ACTIVE, APP.STATUS.PAUSE, APP.STATUS.PENDING], first - 1)
    .concat(hotFind_(sh, h, 'Status review', [APP.REVIEW.NEEDED], first - 1)).forEach(function (n) { want[n] = true; });
  var blocks = rowBlocks_(Object.keys(want).map(Number));
  // tiap blok = satu panggilan (±0,1 dtk): banyak pending lama yang tersebar → baca penuh (tidak lebih lambat dari 2.6.2)
  if (blocks.length > HOT_BLOCKS_MAX_) return readTable_(APP.SHEETS.MAINT);
  blocks.forEach(function (b) {
    out = out.concat(rowsToObjs_(h, sh.getRange(b[0], 1, b[1] - b[0] + 1, h.length).getValues(), b[0]));
  });
  return out.concat(rowsToObjs_(h, sh.getRange(first, 1, last - first + 1, h.length).getValues(), first));
}

/** Nomor baris 2..lastRow yang selnya di kolom `col` persis salah satu `values` (dicari di server, tanpa membaca kolomnya). */
function hotFind_(sh, h, col, values, lastRow) {
  var c = h.indexOf(col);
  if (c < 0 || lastRow < 2) return [];
  var re = '^(' + values.map(function (v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')$';
  return sh.getRange(2, c + 1, lastRow - 1, 1).createTextFinder(re).useRegularExpression(true).matchEntireCell(true)
    .findAll().map(function (rg) { return rg.getRow(); });
}

/** [9, 3, 4, 5] → [[3, 5], [9, 9]]: baris berurutan dibaca dalam satu panggilan. */
function rowBlocks_(nums) {
  var out = [];
  nums.slice().sort(function (a, b) { return a - b; }).forEach(function (n) {
    var b = out[out.length - 1];
    if (b && n === b[1] + 1) b[1] = n; else out.push([n, n]);
  });
  return out;
}

/**
 * Pekerjaan berdasarkan ID dari baris panas; bila tidak ada (mis. Selesai diketuk dua kali → sudah Completed), satu baris
 * dicari di server (TextFinder kolom ID) dan ditambahkan ke `rows`, supaya pesan error tetap menyebut statusnya.
 */
function findHot_(rows, id) {
  var r = findById_(rows, id);
  if (r || !id) return r;
  r = readWhere_(APP.SHEETS.MAINT, 'Maintenance ID', id)[0] || null;
  if (r) rows.push(r);
  return r;
}

/** Semua baris tab `name` yang kolom `col`-nya persis `value`, dicari di server (TextFinder) tanpa membaca seluruh tab. */
function readWhere_(name, col, value) {
  var sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  var h = headers_(sh, name), c = h.indexOf(col), out = [];
  if (c < 0) return [];
  var hits = sh.getRange(2, c + 1, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findAll()
    .map(function (rg) { return rg.getRow(); });
  rowBlocks_(hits).forEach(function (b) {
    out = out.concat(rowsToObjs_(h, sh.getRange(b[0], 1, b[1] - b[0] + 1, h.length).getValues(), b[0]));
  });
  return out;
}

/** N baris terakhir saja (untuk Log yang terus bertambah). */
function readTail_(name, n) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = headers_(sh, name);
  var first = Math.max(2, last - n + 1);
  return rowsToObjs_(headers, sh.getRange(first, 1, last - first + 1, headers.length).getValues(), first);
}

/**
 * Teks yang akan diubah Sheets saat ditulis diberi awalan ' (Sheets tidak menyimpan tanda itu, teks tetap apa adanya):
 * angka / jam / tanggal ("16:53", "3/4", "1-2", "10.30"), TRUE/FALSE, atau tanda di depan ("- ganti sensor", "+62…", "=…"
 * dibaca sebagai rumus → #ERROR!). 2.6.2: "16:53" sempat tersimpan sebagai jam 1899 → Laporan "Sat Dec 30 1899 …".
 */
function cellText_(v) {
  return typeof v === 'string' && (/^[=+\-@']/.test(v) || /^(true|false)$/i.test(v) || /^[\d\s.,:\/\-%]*\d[\d\s.,:\/\-%]*$/.test(v)) ? "'" + v : v;
}

/** Sheet berisi teks bebas user: nilai teks ditulis lewat cellText_. KPI data & Laporan tidak (kolom berformat teks / angka). */
var TEXT_SHEETS_ = ['Maintenance', 'Log', 'Pemakaian Sparepart', 'Saran'];

function objToRow_(headers, obj, asText) {
  return headers.map(function (h) { var v = obj.hasOwnProperty(h) ? obj[h] : ''; return asText ? cellText_(v) : v; });
}

/** Nilai sel kolom teks → teks. Data lama yang sudah diubah Sheets menjadi jam / tanggal tampil seperti diketik ("16:53"). */
function textOf_(v) {
  if (v instanceof Date) {
    if (v.getTime() < 0) return fmtTz_(v, 'HH:mm');   // jam tanpa tanggal = 30/12/1899
    var t = fmtTz_(v, 'HH:mm');
    return fmtTz_(v, 'dd/MM/yyyy') + (t === '00:00' ? '' : ' ' + t);
  }
  return v == null ? '' : String(v);
}

function appendObj_(name, obj) {
  var sh = sheet_(name), row = objToRow_(headers_(sh, name), obj, TEXT_SHEETS_.indexOf(name) !== -1);
  if (!LOCK_DEPTH_ || [APP.SHEETS.MAINT, APP.SHEETS.LOG, APP.SHEETS.PEMAKAIAN].indexOf(name) === -1) { sh.appendRow(row); return; }
  // 2.6.3: tab ini hanya ditulis di dalam withLock_ → tidak ada penulis lain; setValues masuk antrean & terkirim saat flush,
  // appendRow dijalankan langsung (profil Apps Script asli: 0,6–1,6 dtk per baris Log)
  var at = rowsAt_(sh, name, 1);
  sh.getRange(at, 1, 1, row.length).setValues([row]);
}

/*
 * 2.6.8 K8 "baca dulu, tulis sekali". Apps Script menahan tulisan dalam antrean dan mengirimnya saat ada BACA berikutnya
 * atau saat flush. Tombol dulu: tulis Maintenance → baca judul / baris terakhir Log (kirim terpaksa) → tulis Log → baca tab
 * Laporan (kirim terpaksa) → tulis Laporan → flush = 3× kirim (profil: masing-masing ±0,3–0,8 dtk).
 * planWrites_ membaca semua itu SEBELUM tulisan pertama; appendObj_ / appendUsage_ / syncLaporan_ memakai hasilnya tanpa baca.
 * Urutan & isi tulisan tidak berubah. Rencana hanya berlaku selama satu tombol (dibuang di endWrites_), jadi arsip, Input
 * Manual, trigger, dsb. tetap membaca sendiri.
 */
var WRITE_PLAN_ = null;   // { rows: {nama tab: {at, max}}, lap: hasil lapLocate_ } selama satu tombol

/** @param {Object} r pekerjaan (Laporan dicari untuknya) · @param {string[]} tabs tab yang akan ditambah baris · @param {boolean=} baru r belum ada di Laporan */
function planWrites_(r, tabs, baru) {
  var plan = { rows: {}, lap: undefined };
  tabs.forEach(function (name) {
    var sh = sheet_(name);
    headers_(sh, name);
    plan.rows[name] = { at: sh.getLastRow() + 1, max: sh.getMaxRows() };
  });
  if (isYes_(getConfig_('LAPORAN_LANGSUNG'))) plan.lap = lapLocate_(r, baru);   // Tidak: syncReports_ tidak menyentuh Laporan
  WRITE_PLAN_ = plan;
  return plan;
}
function endWrites_() { WRITE_PLAN_ = null; }

/** Nomor baris kosong untuk n baris baru (dari rencana bila ada, lain kali membaca tab); baris ditambah bila kurang. */
function rowsAt_(sh, name, n) {
  var p = WRITE_PLAN_ && WRITE_PLAN_.rows[name];
  if (!p) { var at0 = sh.getLastRow() + 1; ensureRows_(sh, at0 + n - 1, 500); return at0; }
  var at = p.at, last = at + n - 1;
  if (last > p.max) { sh.insertRowsAfter(p.max, last - p.max + 500); p.max = last + 500; }   // = ensureRows_ tanpa baca
  p.at += n;
  return at;
}

/** Menulis ulang satu baris penuh (satu panggilan API, bukan per sel). */
function writeObj_(name, obj) {
  var sh = sheet_(name);
  var headers = headers_(sh, name);
  sh.getRange(obj._row, 1, 1, headers.length).setValues([objToRow_(headers, obj, TEXT_SHEETS_.indexOf(name) !== -1)]);
}

/** Selalu cari berdasarkan Maintenance ID, tidak pernah berdasarkan nomor baris dari client. */
function findById_(rows, id) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Maintenance ID']) === String(id)) return rows[i];
  }
  return null;
}

/** > 0 selama kode berjalan di dalam withLock_ (appendObj_ memakai jalur cepat). */
var LOCK_DEPTH_ = 0;

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_TIMEOUT_MS)) {
    throw new Error('Server sedang sibuk, coba lagi beberapa detik.');
  }
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function fmtDate_(d) {
  return (d instanceof Date) ? fmtTz_(d, APP.DATE_FMT) : '';
}

/**
 * Utilities.formatDate(d, APP.TZ, fmt) tanpa panggilan layanan (2.6.2). Dipanggil per baris di KPI / Laporan / Dashboard /
 * Statistik: dengan data setahun Utilities.formatDate di sana ±130.000 panggilan lambat (Dashboard 11 dtk, setup 283 dtk).
 * WIB = UTC+7 tetap sejak 1964 → cukup aritmetika. Tanggal sebelum 1970 (mis. jam tanpa tanggal dari Sheets = 30/12/1899,
 * saat itu Jakarta +07:07) dan pola selain yyyy yy MM dd HH mm ss u '…' tetap lewat Utilities.
 */
var FMT_TZ_RE_ = /'([^']*)'|yyyy|yy|MM|dd|HH|mm|ss|u|[A-Za-z]/g;
function fmtTz_(d, fmt) {
  var t = d.getTime();
  if (!(t >= 0) || APP.TZ !== 'Asia/Jakarta') return Utilities.formatDate(d, APP.TZ, fmt);
  var j = new Date(t + 7 * 3600000), other = false;
  var p2 = function (n) { return n < 10 ? '0' + n : String(n); };
  var out = String(fmt).replace(FMT_TZ_RE_, function (m, lit) {
    if (lit !== undefined) return lit;
    switch (m) {
      case 'yyyy': return String(j.getUTCFullYear());
      case 'yy': return p2(j.getUTCFullYear() % 100);
      case 'MM': return p2(j.getUTCMonth() + 1);
      case 'dd': return p2(j.getUTCDate());
      case 'HH': return p2(j.getUTCHours());
      case 'mm': return p2(j.getUTCMinutes());
      case 'ss': return p2(j.getUTCSeconds());
      case 'u': return String(j.getUTCDay() || 7);
    }
    other = true;
    return m;
  });
  return other ? Utilities.formatDate(d, APP.TZ, fmt) : out;
}

function iso_(d) {
  return (d instanceof Date) ? d.toISOString() : '';
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Pastikan sheet punya baris sampai `last`. Di Apps Script getRange di luar jumlah baris sheet = error (appendRow saja
 * yang menambah baris sendiri); tab baru hanya 1000 baris → setelah ±1 tahun pemakaian, tulisan sekaligus gagal.
 * Ditambah sekalian `spare` baris supaya tidak tiap kali.
 */
function ensureRows_(sh, last, spare) {
  var max = sh.getMaxRows();
  if (last > max) sh.insertRowsAfter(max, last - max + (spare || 0));
}

/**
 * 2.6.5: batas Google Sheets 10 juta sel per file menghitung sel KOSONG juga (uji 2 tahun: 47% terpakai, separuhnya kosong).
 * Kolom kosong di kanan judul dihapus (tab baru selalu 26 kolom; Log hanya 5). Dengan spareRows: baris kosong di bawah data
 * juga dihapus, tersisa spareRows (arsip mengosongkan baris tetapi tidak menghapusnya). Gagal = dibiarkan: hanya hemat ruang.
 */
function trimSheet_(sh, spareRows) {
  try {
    var w = Math.max(1, sh.getLastColumn()), mc = sh.getMaxColumns();
    if (mc > w) sh.deleteColumns(w + 1, mc - w);
    if (spareRows == null) return;
    var keep = Math.max(2, sh.getLastRow() + spareRows), mr = sh.getMaxRows();
    if (mr > keep) sh.deleteRows(keep + 1, mr - keep);
  } catch (e) { console.warn('Rapikan ukuran tab ' + sh.getName() + ': ' + e); }
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cleanText_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 1000);
}

function normLine_(v) {
  return String(v || '').trim().toUpperCase();
}
