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

/** Semua baris data sebagai object. `_row` = nomor baris di sheet (1-based). */
function readTable_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row[0] === '' || row[0] === null) continue;
    var obj = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    out.push(obj);
  }
  return out;
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

function findMaintenance_(id) {
  var rows = readTable_(APP.SHEETS.MAINT);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Maintenance ID']) === String(id)) return rows[i];
  }
  return null;
}

function findLine_(lineId) {
  var key = String(lineId || '').trim().toUpperCase();
  if (!key) return null;
  var rows = readTable_(APP.SHEETS.LINES);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Line ID']).trim().toUpperCase() === key) return rows[i];
  }
  return null;
}

function isActiveStatus_(v) {
  return String(v || '').trim().toLowerCase() === 'active';
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

function newMaintenanceId_(now) {
  var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'MT-' + Utilities.formatDate(now, APP.TZ, 'yyyyMMdd-HHmmss') + '-' + rand;
}

function durationMinutes_(start, finish) {
  return Math.round(((finish.getTime() - start.getTime()) / 60000) * 100) / 100;
}
