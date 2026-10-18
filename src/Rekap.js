/**
 * Rekap tahunan (tahun kalender, WIB) + arsip data per tahun.
 *
 * - Tab "Rekap <tahun>": 12 bulan + total, nilai statis (bukan rumus) supaya tetap benar setelah
 *   data diarsipkan. Diperbarui langsung setiap aksi (syncReports_); dibangun ulang penuh tiap malam (trigger refreshRekap), lewat Dashboard, dan lewat menu.
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
function archiveUsageName_(year) { return 'Arsip Sparepart ' + year; }
function rekapName_(year) { return 'Rekap ' + year; }
function laporanName_(year) { return 'Laporan ' + year; }

function checkYear_(year) {
  var y = Number(year);
  if (!(y >= 2000 && y <= 2100 && Math.floor(y) === y)) throw new Error('Tahun tidak valid: ' + year);
  return y;
}

/**
 * Data satu tahun = tab Maintenance + tab Arsip <tahun> (jika sudah diarsipkan), tanpa duplikat.
 * @param {Object[]=} rows baris Maintenance yang sudah di memori (sinkron langsung: tanpa baca ulang, tanpa arsip)
 */
function rekapRows_(year, rows) {
  var seen = {}, out = [];
  var add = function (r) {
    var id = String(r['Maintenance ID']);
    if (seen[id]) return;
    var d = finalDate_(r);
    if (!d || yearOf_(d) !== year) return;
    seen[id] = true;
    out.push(r);
  };
  if (rows) { rows.forEach(add); return out; }
  readTable_(APP.SHEETS.MAINT).forEach(add);
  if (SpreadsheetApp.getActive().getSheetByName(archiveName_(year))) readTable_(archiveName_(year)).forEach(add);
  return out;
}

/** Hitung rekap per bulan. @return {{months:Object[], total:Object}} */
function computeRekap_(year, rows) {
  var types = mttrTypes_();
  var blank = function (label) {
    return { label: label, done: 0, corrective: 0, preventive: 0, mttrSum: 0, mttrN: 0, active: 0, pause: 0, pending: 0, cancelled: 0, abandoned: 0, abandonedCounted: 0 };
  };
  var months = BULAN_.map(blank);
  var total = blank('Total ' + year);
  rekapRows_(year, rows).forEach(function (r) {
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
  var rows = rekapLayout_(year, data);
  sh.getRange(1, 1, rows.length, w).setValues(rows);
  sh.getRange(1, 1, 1, 1).setFontWeight('bold');
  sh.getRange(4, 1, 1, w).setFontWeight('bold');
  sh.getRange(rows.length, 1, 1, w).setFontWeight('bold');
  sh.setFrozenRows(4);
  return { year: year, total: data.total, sheet: rekapName_(year) };
}

/** Isi tab Rekap (judul, keterangan, header, 12 bulan, total). Ukurannya selalu sama → bisa ditulis ulang di tempat. */
function rekapLayout_(year, data) {
  var w = REKAP_HEADERS_.length;
  var pad = function (row) { while (row.length < w) row.push(''); return row; };
  return [
    pad(['Rekap ' + appName_() + ' ' + year]),
    pad(['Diperbarui ' + fmtDate_(new Date()) + ' WIB (otomatis setiap ada perubahan). MTTR = rata-rata waktu aktif pekerjaan "Masuk MTTR = Ya" (' +
      getConfig_('MTTR_TIPE') + '). Bulan = bulan selesai / cancel / abandoned.']),
    pad([]),
    REKAP_HEADERS_.slice()
  ].concat(data.months.map(rekapRow_)).concat([rekapRow_(data.total)]);
}

/**
 * Trigger malam: bangun ulang penuh Laporan & Rekap tahun ini (memperbaiki edit manual di sheet Maintenance,
 * mengurutkan ulang); di bulan Januari juga tahun lalu. Memakai lock supaya tidak bentrok dengan sinkron langsung.
 */
function refreshRekap() {
  resetMaster_();
  withLock_(function () {
    var now = new Date();
    var y = yearOf_(now);
    buildRekap_(y);
    buildLaporan_(y);
    if (monthOf_(now) === 1) { buildRekap_(y - 1); buildLaporan_(y - 1); }
  });
}

// ---------- Sinkron langsung: setiap aksi memperbarui Laporan & Rekap ----------

var LAP_KEY_ = 'ID sistem';   // kolom tersembunyi di kanan tabel Laporan: Maintenance ID per baris
var LAP_SPARE_ = 300;         // baris kosong di bawah tabel yang sudah diformat (wrap, tanggal) untuk baris baru

/** Header kolom kunci = penanda + sidik format. Format Laporan diubah admin → sidik beda → tab dibangun ulang. */
function lapKeyHeader_(cols) {
  var s = JSON.stringify(cols.map(function (c) { return [c.kolom, c.sumber]; })), h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return LAP_KEY_ + ' ' + (h >>> 0).toString(36);
}

/**
 * Dipanggil di dalam lock setelah satu pekerjaan ditulis: barisnya di tab Laporan ditulis / dihapus, dan Rekap
 * tahun selesainya dihitung ulang dari data di memori. Gagal di sini tidak membatalkan aksi teknisi (data utama
 * sudah tersimpan); trigger malam & tombol "Perbarui Laporan & Rekap" membangun ulang penuh.
 * @param {Object} r          pekerjaan yang baru ditulis
 * @param {Object[]=} rows    semua baris Maintenance di memori (sudah berisi r terbaru); tanpa ini Rekap tidak disentuh
 * @param {Object[]=} parts   sparepart dari apiComplete (supaya tidak membaca sheet Pemakaian lagi)
 */
function syncReports_(r, rows, parts) {
  if (!isYes_(getConfig_('LAPORAN_LANGSUNG'))) return;
  try {
    syncLaporan_(r, parts);
    var fin = finalDate_(r);
    if (fin && rows) syncRekap_(yearOf_(fin), rows);
  } catch (e) {
    console.warn('Sinkron Laporan/Rekap gagal (diperbaiki saat pembaruan penuh berikutnya): ' + e);
  }
}

function syncLaporan_(r, parts) {
  if (!(r['Mulai'] instanceof Date)) return;
  var year = yearOf_(r['Mulai']);
  var sh = SpreadsheetApp.getActive().getSheetByName(laporanName_(year));
  var md = masterData_(), cols = md.report, w = Math.max(1, cols.length);
  if (!sh) { buildLaporan_(year); return; }
  var last = sh.getLastRow();
  var keyCol = last >= 2 ? sh.getRange(2, w + 1, last - 1, 1).getValues() : [];
  if (!keyCol.length || keyCol[0][0] !== lapKeyHeader_(cols)) { buildLaporan_(year); return; }   // tab lama / format diubah
  var id = String(r['Maintenance ID']), n = keyCol.length - 1, at = -1;
  for (var i = 1; i <= n; i++) if (String(keyCol[i][0]) === id) { at = i - 1; break; }

  if (r['Status'] === APP.STATUS.CANCELLED) {       // Cancelled tidak masuk laporan → barisnya dihapus, NO diurutkan ulang
    if (at < 0) return;
    sh.deleteRow(3 + at);
    var noCol = cols.map(function (c) { return c.sumber; }).indexOf('NO');
    if (noCol >= 0 && at < n - 1) {
      var nums = [];
      for (var k = at; k < n - 1; k++) nums.push([k + 1]);
      sh.getRange(3 + at, noCol + 1, nums.length, 1).setValues(nums);
    }
    return;
  }
  var idx = at >= 0 ? at : n;                        // pekerjaan baru → baris paling bawah (mulai paling akhir)
  var used = parts ? parts.map(function (p) {
    return { 'Jenis Sparepart': p.jenis, 'Nama Sparepart': p.nama, 'Model': p.model, 'Jumlah': p.qty };
  }) : (r['Status'] === APP.STATUS.COMPLETED ? usageOf_(id, year) : []);
  var names = userNameMap_();
  var row = cols.map(function (c) { var v = laporanValue_(c.sumber, r, idx, used, md, names); return v == null ? '' : v; });
  row.push(id);
  sh.getRange(3 + idx, 1, 1, w + 1).setValues([row]);
}

/** Pemakaian sparepart satu pekerjaan (jalur jarang: sinkron pekerjaan Completed tanpa data part di memori). */
function usageOf_(id, year) {
  var ss = SpreadsheetApp.getActive(), out = [];
  [APP.SHEETS.PEMAKAIAN, archiveUsageName_(year)].forEach(function (name) {
    if (ss.getSheetByName(name)) readTable_(name).forEach(function (u) { if (String(u['Maintenance ID']) === id) out.push(u); });
  });
  return out;
}

function syncRekap_(year, rows) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(rekapName_(year));
  // Tahun lalu (review Abandoned di Januari): sebagian datanya mungkin sudah di tab Arsip → hitung penuh.
  if (!sh || year !== yearOf_(new Date())) { buildRekap_(year); return; }
  var body = rekapLayout_(year, computeRekap_(year, rows));
  sh.getRange(1, 1, body.length, REKAP_HEADERS_.length).setValues(body);
}

// ---------- Laporan (format Excel "Form Stop Line Peralatan") ----------

function stripOther_(v) {
  var s = String(v || '');
  return s.indexOf(APP.OTHER_PREFIX) === 0 ? s.slice(APP.OTHER_PREFIX.length).trim() : s;
}

function withDetail_(choice, detail) {
  var a = stripOther_(choice), b = String(detail || '').trim();
  return a && b ? a + ' – ' + b : (a || b);
}

/** Satu baris per pekerjaan (bukan Cancelled) yang MULAI di tahun tsb. Pemakaian sparepart ditulis ke bawah dalam satu sel. */
function laporanRows_(year) {
  var ss = SpreadsheetApp.getActive();
  var seen = {}, rows = [];
  var add = function (r) {
    var id = String(r['Maintenance ID']);
    if (seen[id] || r['Status'] === APP.STATUS.CANCELLED || !(r['Mulai'] instanceof Date) || yearOf_(r['Mulai']) !== year) return;
    seen[id] = true;
    rows.push(r);
  };
  readTable_(APP.SHEETS.MAINT).forEach(add);
  if (ss.getSheetByName(archiveName_(year))) readTable_(archiveName_(year)).forEach(add);
  rows.sort(function (a, b) { return (a['Mulai'] - b['Mulai']) || String(a['Maintenance ID']).localeCompare(String(b['Maintenance ID'])); });
  var usage = {};
  var addUsage = function (u) {
    var id = String(u['Maintenance ID']);
    if (!seen[id]) return;
    (usage[id] = usage[id] || []).push(u);
  };
  if (ss.getSheetByName(APP.SHEETS.PEMAKAIAN)) readTable_(APP.SHEETS.PEMAKAIAN).forEach(addUsage);
  if (ss.getSheetByName(archiveUsageName_(year))) readTable_(archiveUsageName_(year)).forEach(addUsage);
  return { rows: rows, usage: usage };
}

function laporanValue_(src, r, i, used, md, names) {
  var line = lineOf_(md, r['Line']);
  var col = function (k) { return used.map(function (u) { return u[k] === '' || u[k] == null ? '-' : u[k]; }).join('\n'); };
  var noPart = !used.length && r['Status'] === APP.STATUS.COMPLETED;
  var legacy = noPart && r['Part'] && r['Part'] !== APP.NO_PART && r['Part'] !== 'Tidak ada';   // data 2.1 (teks bebas)
  switch (src) {
    case 'NO': return i + 1;
    case 'Factory': return factoryOfRecord_(md, r);
    case 'Nama factory': var f = md.factoryMap[factoryOfRecord_(md, r)]; return f ? f.name : factoryOfRecord_(md, r);
    case 'Project': return r['Baterai'];
    case 'Proses': return prosesOfRecord_(md, r);
    case 'Line': return r['Line'];
    case 'Station': return stripOther_(r['Nama Mesin']) || (line ? line.name || line.id : r['Line']);
    case 'Tanggal': return r['Mulai'];
    case 'Jam mulai': return Utilities.formatDate(r['Mulai'], APP.TZ, 'HH.mm');
    case 'Jam selesai': return r['Selesai'] instanceof Date ? Utilities.formatDate(r['Selesai'], APP.TZ, 'HH.mm') : '';
    case 'Stop line (1/0)': return r['Stop line'] === APP.YES ? 1 : (r['Stop line'] === APP.NO ? 0 : '');
    case 'Durasi stop line':
      if (r['Stop line'] === APP.NO) return 0;
      if (r['Stop line'] !== APP.YES || !(r['Selesai'] instanceof Date)) return '';
      return Math.round((r['Selesai'].getTime() - r['Mulai'].getTime()) / 60000);
    case 'Waktu aktif (menit)': return Number(r['Total aktif (menit)'] || 0);
    case 'Jenis kerusakan': return stripOther_(r['Jenis kerusakan']);
    case 'Masalah + detail': return withDetail_(r['Masalah'], r['Detail masalah']);
    case 'Penyebab + detail': return withDetail_(r['Penyebab'], r['Detail penyebab']);
    case 'Penanganan + detail': return withDetail_(r['Penanganan'], r['Detail penanganan']);
    case 'Jenis sparepart': return used.length ? col('Jenis Sparepart') : (noPart && !legacy ? APP.NO_PART : '');
    case 'Nama sparepart': return used.length ? col('Nama Sparepart') : (legacy ? String(r['Part']).replace(/; /g, '\n') : '');
    case 'Model sparepart': return used.length ? col('Model') : '';
    case 'Jumlah sparepart': return used.length ? (used.length === 1 ? Number(used[0]['Jumlah']) : col('Jumlah')) : '';
    case 'Catatan': return r['Catatan'];
    case 'Kondisi perbaikan': return APP.STATUS_LABEL[r['Status']] || r['Status'];
    case 'PIC':
      return r['Nama teknisi terlibat'] || String(r['Teknisi terlibat'] || r['Teknisi terakhir'] || '').split(',').map(function (e) {
        e = e.trim().toLowerCase(); return names[e] || e;
      }).filter(String).join(', ');
    case 'Tipe maintenance': return r['Tipe'];
    case 'Maintenance ID': return r['Maintenance ID'];
    default:
      var v = r[src];
      return v === undefined ? '' : (v instanceof Date ? fmtDate_(v) : v);
  }
}

/** Buat/perbarui tab "Laporan <tahun>" sesuai sheet Format Laporan (default = Excel bang Risky). */
function buildLaporan_(year) {
  year = checkYear_(year);
  var md = masterData_(), names = userNameMap_();
  var cols = md.report;
  var data = laporanRows_(year);
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(laporanName_(year)) || ss.insertSheet(laporanName_(year));
  sh.clear();
  var w = Math.max(1, cols.length);
  var title = [String(getConfig_('LAPORAN_JUDUL') || '')];
  while (title.length < w) title.push('');
  title.push('');
  // Kolom terakhir (tersembunyi) = Maintenance ID per baris: kunci untuk sinkron langsung setiap aksi.
  var out = [title, cols.map(function (c) { return c.kolom; }).concat([lapKeyHeader_(cols)])];
  data.rows.forEach(function (r, i) {
    var used = data.usage[String(r['Maintenance ID'])] || [];
    out.push(cols.map(function (c) { var v = laporanValue_(c.sumber, r, i, used, md, names); return v == null ? '' : v; })
      .concat([String(r['Maintenance ID'])]));
  });
  sh.showColumns(1, sh.getMaxColumns());      // kolom kunci format lama mungkin tersembunyi di posisi lain
  sh.getRange(1, 1, out.length, w + 1).setValues(out);
  sh.hideColumns(w + 1);
  sh.getRange(1, 1, 1, w).merge().setFontWeight('bold');
  sh.getRange(2, 1, 1, w).setFontWeight('bold');
  // Baris cadangan di bawah tabel ikut diformat, supaya baris yang ditambah sinkron langsung tampil sama.
  var fmtRows = Math.max(1, Math.min(out.length - 1 + LAP_SPARE_, sh.getMaxRows() - 1));
  sh.getRange(2, 1, fmtRows, w).setWrap(true);
  sh.setFrozenRows(2);
  cols.forEach(function (c, j) {
    if (c.sumber === 'Tanggal' && fmtRows > 1) sh.getRange(3, j + 1, fmtRows - 1, 1).setNumberFormat('dd/mm/yyyy');
  });
  return { year: year, sheet: laporanName_(year), rows: data.rows.length };
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
  forgetHeaders_(name);
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
  (APP.DATE_COLUMNS.Maintenance.concat(APP.DATE_COLUMNS.Log, APP.DATE_COLUMNS['Pemakaian Sparepart'])).forEach(function (col) {
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

var usageKey_ = function (o) {
  var t = o['Tanggal'] instanceof Date ? o['Tanggal'].getTime() : String(o['Tanggal']);
  return [t, o['Maintenance ID'], o['Jenis Sparepart'], o['Nama Sparepart'], o['Model'], o['Jumlah']].join('|');
};

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
    buildLaporan_(year);
    var msh = sheet_(APP.SHEETS.MAINT), lsh = sheet_(APP.SHEETS.LOG);
    var ush = SpreadsheetApp.getActive().getSheetByName(APP.SHEETS.PEMAKAIAN);
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
    var uvals = ush ? ush.getDataRange().getValues() : [[]];
    var uh = uvals[0].map(function (x) { return String(x).trim(); }), uId = uh.indexOf('Maintenance ID');
    var uRows = uId < 0 ? [] : uvals.slice(1).filter(function (row) { return ids[String(row[uId])]; });
    if (uRows.length) appendArchive_(archiveUsageName_(year), uh, uRows, usageKey_);
    SpreadsheetApp.flush();

    var have = {};
    readTable_(archiveName_(year)).forEach(function (r) { have[String(r['Maintenance ID'])] = true; });
    var lost = Object.keys(ids).filter(function (id) { return !have[id]; });
    if (lost.length) throw new Error('Arsip gagal diverifikasi (' + lost.length + ' baris tidak tersalin). Tidak ada data yang dihapus.');

    rewriteKeeping_(msh, mvals, function (row) { return !ids[String(row[mId])]; });
    rewriteKeeping_(lsh, lvals, function (row) { return !ids[String(row[lId])]; });
    if (uRows.length) rewriteKeeping_(ush, uvals, function (row) { return !ids[String(row[uId])]; });
    return { year: year, maintenance: n, log: lRows.length, sparepart: uRows.length, rekap: rekap };
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
  var out = withLock_(function () { buildLaporan_(year); return buildRekap_(year); });
  SpreadsheetApp.getActive().getSheetByName(out.sheet).activate();
  ui.alert('Tab "' + out.sheet + '" dan "' + laporanName_(out.year) + '" diperbarui: ' + out.total.done + ' pekerjaan selesai, MTTR ' +
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
    n + ' pekerjaan final tahun ' + year + ' (beserta Log & pemakaian sparepart-nya) akan dipindah ke tab "' + archiveName_(year) + '", "' +
    archiveLogName_(year) + '" dan "' + archiveUsageName_(year) + '". Rekap & Laporan ' + year + ' dibuat ulang lebih dulu. Pekerjaan yang masih berjalan, pending, atau menunggu review tidak dipindah.\n\n' +
    'Setelah diarsipkan, pekerjaan itu tidak tampil lagi di Riwayat aplikasi (tetap ada di sheet arsip). Lanjutkan?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var out = arsipkanTahun_(year);
  ui.alert('Selesai: ' + out.maintenance + ' pekerjaan, ' + out.log + ' baris Log dan ' + out.sparepart + ' baris sparepart dipindah ke arsip ' + year + '.');
}
