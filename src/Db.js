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

/** N baris terakhir saja (untuk Log yang terus bertambah). */
function readTail_(name, n) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = headers_(sh, name);
  var first = Math.max(2, last - n + 1);
  return rowsToObjs_(headers, sh.getRange(first, 1, last - first + 1, headers.length).getValues(), first);
}

function objToRow_(headers, obj) {
  return headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
}

function appendObj_(name, obj) {
  var sh = sheet_(name);
  sh.appendRow(objToRow_(headers_(sh, name), obj));
}

/** Menulis ulang satu baris penuh (satu panggilan API, bukan per sel). */
function writeObj_(name, obj) {
  var sh = sheet_(name);
  var headers = headers_(sh, name);
  sh.getRange(obj._row, 1, 1, headers.length).setValues([objToRow_(headers, obj)]);
}

/** Selalu cari berdasarkan Maintenance ID, tidak pernah berdasarkan nomor baris dari client. */
function findById_(rows, id) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Maintenance ID']) === String(id)) return rows[i];
  }
  return null;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_TIMEOUT_MS)) {
    throw new Error('Server sedang sibuk, coba lagi beberapa detik.');
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function fmtDate_(d) {
  return (d instanceof Date) ? Utilities.formatDate(d, APP.TZ, APP.DATE_FMT) : '';
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
