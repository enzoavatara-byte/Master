/**
 * Helper akses Google Sheets. Baris dipetakan ke object berdasarkan header baris pertama,
 * jadi urutan kolom di sheet boleh berubah selama nama header-nya sama.
 */

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" tidak ditemukan. Admin perlu menjalankan setup().');
  return sh;
}

function headers_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

function rowsToObjs_(headers, values, firstRow) {
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (row[0] === '' || row[0] === null) continue;
    var obj = { _row: firstRow + i };
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    out.push(obj);
  }
  return out;
}

/** Semua baris data sebagai object. `_row` = nomor baris di sheet (1-based). */
function readTable_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  return rowsToObjs_(headers, values.slice(1), 2);
}

/** N baris terakhir saja (untuk Log yang terus bertambah). */
function readTail_(name, n) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = headers_(sh);
  var first = Math.max(2, last - n + 1);
  return rowsToObjs_(headers, sh.getRange(first, 1, last - first + 1, headers.length).getValues(), first);
}

function objToRow_(headers, obj) {
  return headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
}

function appendObj_(name, obj) {
  var sh = sheet_(name);
  sh.appendRow(objToRow_(headers_(sh), obj));
}

/** Menulis ulang satu baris penuh (satu panggilan API, bukan per sel). */
function writeObj_(name, obj) {
  var sh = sheet_(name);
  var headers = headers_(sh);
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
