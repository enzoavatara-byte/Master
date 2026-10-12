/**
 * Rekap tahunan (tahun kalender, WIB) + arsip data per tahun.
 *
 * - Tab "Rekap <tahun>": 12 bulan + total, nilai statis (bukan rumus) supaya tetap benar setelah
 *   data diarsipkan. Diperbarui otomatis tiap malam (trigger refreshRekap) dan lewat menu.
 * - Arsip: pekerjaan tahun lalu yang sudah final dipindah ke tab "Arsip <tahun>" & "Arsip Log <tahun>"
 *   di spreadsheet yang sama. Aplikasi hanya membaca tab Maintenance & Log, jadi tetap cepat.
 *   Arsip di file terpisah sengaja tidak dipakai: butuh izin akses ke SEMUA spreadsheet setiap teknisi.
 *
 * Bulan sebuah pekerjaan = bulan selesai (Completed) atau bulan cancel/abandoned.
 */

var BULAN_ = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var REKAP_HEADERS_ = ['Bulan', 'Pekerjaan selesai', 'Corrective', 'Preventive', 'MTTR Corrective (menit)',
  'Total waktu aktif (jam)', 'Total waktu pause (jam)', 'Total waktu pending (jam)', 'Cancelled', 'Abandoned', 'Abandoned dihitung ke MTTR'];

function yearOf_(d) { return Number(Utilities.formatDate(d, APP.TZ, 'yyyy')); }
function monthOf_(d) { return Number(Utilities.formatDate(d, APP.TZ, 'MM')); }

/** Tanggal yang menentukan tahun/bulan rekap; null jika pekerjaan belum final. */
function finalDate_(r) {
  var st = r['Status'];
  if (st === APP.STATUS.COMPLETED) return r['Selesai'] instanceof Date ? r['Selesai'] : (r['Status sejak'] instanceof Date ? r['Status sejak'] : null);
  if (st === APP.STATUS.CANCELLED || st === APP.STATUS.ABANDONED) return r['Status sejak'] instanceof Date ? r['Status sejak'] : null;
  return null;
}

/** Boleh diarsipkan: final, tidak menunggu review, dan final di tahun tsb. */
function isArchivable_(r, year) {
  var d = finalDate_(r);
  return !!d && yearOf_(d) === year && r['Status review'] !== APP.REVIEW.NEEDED;
}

function archiveName_(year) { return 'Arsip ' + year; }
function archiveLogName_(year) { return 'Arsip Log ' + year; }
function rekapName_(year) { return 'Rekap ' + year; }

function checkYear_(year) {
  var y = Number(year);
  if (!(y >= 2000 && y <= 2100 && Math.floor(y) === y)) throw new Error('Tahun tidak valid: ' + year);
  return y;
}

/** Data satu tahun = tab Maintenance + tab Arsip <tahun> (jika sudah diarsipkan), tanpa duplikat. */
function rekapRows_(year) {
  var seen = {}, out = [];
  var add = function (r) {
    var id = String(r['Maintenance ID']);
    if (seen[id]) return;
    var d = finalDate_(r);
    if (!d || yearOf_(d) !== year) return;
    seen[id] = true;
    out.push(r);
  };
  readTable_(APP.SHEETS.MAINT).forEach(add);
  if (SpreadsheetApp.getActive().getSheetByName(archiveName_(year))) readTable_(archiveName_(year)).forEach(add);
  return out;
}

/** Hitung rekap per bulan. @return {{months:Object[], total:Object}} */
function computeRekap_(year) {
  var types = mttrTypes_();
  var blank = function (label) {
    return { label: label, done: 0, corrective: 0, preventive: 0, mttrSum: 0, mttrN: 0, active: 0, pause: 0, pending: 0, cancelled: 0, abandoned: 0, abandonedCounted: 0 };
  };
  var months = BULAN_.map(blank);
  var total = blank('Total ' + year);
  rekapRows_(year).forEach(function (r) {
    var m = months[monthOf_(finalDate_(r)) - 1];
    var st = r['Status'];
    var act = Number(r['Total aktif (menit)'] || 0), pau = Number(r['Total pause (menit)'] || 0), pen = Number(r['Total pending (menit)'] || 0);
    var counted = r['Masuk MTTR'] === APP.MTTR.YES;
    [m, total].forEach(function (o) {
      if (st === APP.STATUS.CANCELLED) { o.cancelled++; return; }
      if (st === APP.STATUS.COMPLETED) {
        o.done++;
        var t = String(r['Tipe'] || '').trim().toLowerCase();
        if (!t || types.indexOf(t) !== -1) o.corrective++; else o.preventive++;
      }
      if (st === APP.STATUS.ABANDONED) {
        o.abandoned++;
        if (!counted) return; // waktunya tidak bisa dipercaya → tidak ikut total waktu
        o.abandonedCounted++;
      }
      o.active += act; o.pause += pau; o.pending += pen;
      if (counted) { o.mttrSum += act; o.mttrN++; }
    });
  });
  return { months: months, total: total };
}

function rekapRow_(o) {
  var h = function (min) { return Math.round(min / 60 * 100) / 100; };
  return [o.label, o.done, o.corrective, o.preventive, o.mttrN ? round2_(o.mttrSum / o.mttrN) : '',
    h(o.active), h(o.pause), h(o.pending), o.cancelled, o.abandoned, o.abandonedCounted];
}

/** Buat/perbarui tab "Rekap <tahun>". Tidak memakai lock: hanya membaca data & menulis tab rekap. */
function buildRekap_(year) {
  year = checkYear_(year);
  var data = computeRekap_(year);
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(rekapName_(year)) || ss.insertSheet(rekapName_(year));
  sh.clear();
  var w = REKAP_HEADERS_.length;
  var pad = function (row) { while (row.length < w) row.push(''); return row; };
  var rows = [
    pad(['Rekap MTTR ' + year]),
    pad(['Dibuat ' + fmtDate_(new Date()) + ' WIB. MTTR = rata-rata waktu aktif pekerjaan "Masuk MTTR = Ya" (' + getConfig_('MTTR_TIPE') +
      '). Bulan = bulan selesai / cancel / abandoned. Nilai statis: jalankan rekap lagi untuk memperbarui.']),
    pad([]),
    REKAP_HEADERS_.slice()
  ].concat(data.months.map(rekapRow_)).concat([rekapRow_(data.total)]);
  sh.getRange(1, 1, rows.length, w).setValues(rows);
  sh.getRange(1, 1, 1, 1).setFontWeight('bold');
  sh.getRange(4, 1, 1, w).setFontWeight('bold');
  sh.getRange(rows.length, 1, 1, w).setFontWeight('bold');
  sh.setFrozenRows(4);
  return { year: year, total: data.total, sheet: rekapName_(year) };
}

/** Trigger harian: perbarui rekap tahun ini; di bulan Januari juga tahun lalu (review akhir tahun bisa menyusul). */
function refreshRekap() {
  var now = new Date();
  var y = yearOf_(now);
  buildRekap_(y);
  if (monthOf_(now) === 1) buildRekap_(y - 1);
}

// ---------- Arsip ----------

function appendArchive_(name, srcHeaders, srcRows, keyOf) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var h = headers_(sh);
  if (!h.length) {
    sh.getRange(1, 1, 1, srcHeaders.length).setValues([srcHeaders.slice()]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.protect().setDescription('Arsip MTTR. Jangan diedit manual.').setWarningOnly(true);
    h = srcHeaders.slice();
  }
  var missing = srcHeaders.filter(function (x) { return h.indexOf(x) === -1; });
  if (missing.length) { sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]); h = h.concat(missing); }
  var existing = {};
  readTable_(name).forEach(function (o) { existing[keyOf(o)] = true; });
  var out = [];
  srcRows.forEach(function (row) {
    var o = {};
    srcHeaders.forEach(function (k, i) { o[k] = row[i]; });
    if (existing[keyOf(o)]) return; // jalankan ulang setelah gagal di tengah → tidak dobel
    existing[keyOf(o)] = true;
    out.push(objToRow_(h, o));
  });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, h.length).setValues(out);
  (APP.DATE_COLUMNS.Maintenance.concat(APP.DATE_COLUMNS.Log)).forEach(function (col) {
    var c = h.indexOf(col) + 1;
    if (c > 0 && sh.getLastRow() > 1) sh.getRange(2, c, sh.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  });
  return out.length;
}

/** Tulis ulang isi sheet hanya dengan baris yang dipertahankan (satu kali tulis, format kolom tetap). */
function rewriteKeeping_(sh, values, keep) {
  var head = values[0];
  var body = values.slice(1).filter(function (row) { return row[0] !== '' && row[0] !== null && keep(row); });
  var oldN = values.length - 1;
  if (oldN > 0) sh.getRange(2, 1, oldN, head.length).clearContent();
  if (body.length) sh.getRange(2, 1, body.length, head.length).setValues(body);
  return body.length;
}

var logKey_ = function (o) {
  var t = o['Timestamp'] instanceof Date ? o['Timestamp'].getTime() : String(o['Timestamp']);
  return [t, o['Maintenance ID'], o['Kejadian'], o['User'], o['Detail']].join('|');
};

/**
 * Pindahkan pekerjaan final tahun `year` (beserta Log-nya) ke tab arsip.
 * Urutan aman: rekap final → salin ke arsip → verifikasi → baru hapus dari tab aktif.
 * Pekerjaan yang masih Aktif/Pause/Pending atau menunggu review TIDAK dipindah.
 */
function arsipkanTahun_(year) {
  year = checkYear_(year);
  var nowYear = yearOf_(new Date());
  if (year >= nowYear) throw new Error('Hanya tahun yang sudah lewat yang bisa diarsipkan (sekarang ' + nowYear + ').');

  return withLock_(function () {
    var rekap = buildRekap_(year);
    var msh = sheet_(APP.SHEETS.MAINT), lsh = sheet_(APP.SHEETS.LOG);
    var mvals = msh.getDataRange().getValues(), lvals = lsh.getDataRange().getValues();
    var mh = mvals[0].map(function (x) { return String(x).trim(); }), lh = lvals[0].map(function (x) { return String(x).trim(); });
    var mId = mh.indexOf('Maintenance ID'), lId = lh.indexOf('Maintenance ID');

    var ids = {};
    readTable_(APP.SHEETS.MAINT).forEach(function (r) { if (isArchivable_(r, year)) ids[String(r['Maintenance ID'])] = true; });
    var n = Object.keys(ids).length;
    if (!n) return { year: year, maintenance: 0, log: 0, rekap: rekap };

    var mRows = mvals.slice(1).filter(function (row) { return ids[String(row[mId])]; });
    var lRows = lvals.slice(1).filter(function (row) { return ids[String(row[lId])]; });
    appendArchive_(archiveName_(year), mh, mRows, function (o) { return String(o['Maintenance ID']); });
    appendArchive_(archiveLogName_(year), lh, lRows, logKey_);
    SpreadsheetApp.flush();

    var have = {};
    readTable_(archiveName_(year)).forEach(function (r) { have[String(r['Maintenance ID'])] = true; });
    var lost = Object.keys(ids).filter(function (id) { return !have[id]; });
    if (lost.length) throw new Error('Arsip gagal diverifikasi (' + lost.length + ' baris tidak tersalin). Tidak ada data yang dihapus.');

    rewriteKeeping_(msh, mvals, function (row) { return !ids[String(row[mId])]; });
    rewriteKeeping_(lsh, lvals, function (row) { return !ids[String(row[lId])]; });
    return { year: year, maintenance: n, log: lRows.length, rekap: rekap };
  });
}

/** Jumlah pekerjaan final dari tahun-tahun lalu yang masih ada di tab Maintenance (untuk peringatan Dashboard). */
function unarchivedByYear_(rows, now) {
  var y = yearOf_(now), out = {};
  rows.forEach(function (r) {
    var d = finalDate_(r);
    if (!d || r['Status review'] === APP.REVIEW.NEEDED) return;
    var ry = yearOf_(d);
    if (ry < y) out[ry] = (out[ry] || 0) + 1;
  });
  return out;
}

// ---------- Menu spreadsheet (Admin) ----------

function menuRekapTahunan() {
  requireUser_([APP.ROLES.ADMIN]);
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Rekap tahunan', 'Tahun (kosongkan = tahun ini):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var year = String(res.getResponseText() || '').trim() || yearOf_(new Date());
  var out = buildRekap_(year);
  SpreadsheetApp.getActive().getSheetByName(out.sheet).activate();
  ui.alert('Tab "' + out.sheet + '" diperbarui: ' + out.total.done + ' pekerjaan selesai, MTTR ' +
    (out.total.mttrN ? round2_(out.total.mttrSum / out.total.mttrN) + ' menit' : '-') + '.');
}

function menuArsipkanTahun() {
  requireUser_([APP.ROLES.ADMIN]);
  var ui = SpreadsheetApp.getUi();
  var def = yearOf_(new Date()) - 1;
  var res = ui.prompt('Arsipkan data tahun lalu', 'Tahun yang diarsipkan (kosongkan = ' + def + '):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var year = checkYear_(String(res.getResponseText() || '').trim() || def);
  var n = readTable_(APP.SHEETS.MAINT).filter(function (r) { return isArchivable_(r, year); }).length;
  if (!n) { ui.alert('Tidak ada pekerjaan final tahun ' + year + ' yang perlu diarsipkan.'); return; }
  var ok = ui.alert('Konfirmasi arsip ' + year,
    n + ' pekerjaan final tahun ' + year + ' (beserta Log-nya) akan dipindah ke tab "' + archiveName_(year) + '" dan "' + archiveLogName_(year) +
    '". Rekap ' + year + ' dibuat ulang lebih dulu. Pekerjaan yang masih berjalan, pending, atau menunggu review tidak dipindah.\n\n' +
    'Setelah diarsipkan, pekerjaan itu tidak tampil lagi di Riwayat aplikasi (tetap ada di sheet arsip). Lanjutkan?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var out = arsipkanTahun_(year);
  ui.alert('Selesai: ' + out.maintenance + ' pekerjaan dan ' + out.log + ' baris Log dipindah ke arsip ' + year + '.');
}
