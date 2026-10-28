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
/** Judul kolom tab Rekap (tampilan saja, dua bahasa; tidak dibaca kode). */
var REKAP_HEADERS_ = ['Bulan\n月份', 'Pekerjaan selesai\n完成数', 'Corrective\n故障维修', 'MTTR Corrective (menit)\n平均修复时间（分钟）',
  'Total waktu aktif (jam)\n有效时间（小时）', 'Total waktu pause (jam)\n暂停时间（小时）', 'Total waktu pending (jam)\n挂起时间（小时）',
  'Cancelled\n已取消', 'Abandoned\n已放弃', 'Abandoned dihitung ke MTTR\n计入 MTTR 的已放弃'];

function yearOf_(d) { return Number(fmtTz_(d, 'yyyy')); }
function monthOf_(d) { return Number(fmtTz_(d, 'MM')); }

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
  return [o.label, o.done, o.corrective, o.mttrN ? round2_(o.mttrSum / o.mttrN) : '',   // 2.6: kolom Preventive dihapus
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
  styleRekap_(sh, rows.length, w);
  return { year: year, total: data.total, sheet: rekapName_(year) };
}

/** Isi tab Rekap (judul, keterangan, header, 12 bulan, total). Ukurannya selalu sama → bisa ditulis ulang di tempat. */
function rekapLayout_(year, data) {
  var w = REKAP_HEADERS_.length;
  var pad = function (row) { while (row.length < w) row.push(''); return row; };
  return [
    pad(['Rekap ' + appName_() + ' ' + year]),
    pad(['Diperbarui ' + fmtDate_(new Date()) + ' WIB (tiap malam & lewat Dashboard → Perbarui). MTTR = rata-rata waktu aktif pekerjaan "Masuk MTTR = Ya" (' +
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
  // 2.6.9: tiap langkah dicoba walau langkah lain gagal, dan hasilnya dicatat (Dashboard admin memperingatkan bila gagal /
  // tidak selesai / tidak jalan). Gagal = error di akhir, supaya Google juga mengirim email kegagalan trigger ke pemilik.
  var t0 = new Date(), gagal = [];
  sehatCatat_('malam', { mulai: t0.toISOString(), selesai: '', gagal: [] });
  var langkah = function (nama, fn) {
    try { fn(); } catch (e) { gagal.push(nama + ': ' + (e && e.message || e)); console.warn(nama + ' gagal (dicoba lagi besok / lewat Dashboard): ' + e); }
  };
  resetMaster_();
  langkah('Laporan & Rekap', function () {
    withLock_(function () {
      var now = new Date();
      var y = yearOf_(now);
      try { urutkanMaintenance_(now); } catch (e) { gagal.push('Urut ulang Maintenance: ' + (e && e.message || e)); }
      buildRekap_(y);
      buildLaporan_(y);
      if (monthOf_(now) === 1) { buildRekap_(y - 1); buildLaporan_(y - 1); }
    }, MALAM_LOCK_MS_);
  });
  // Di luar lock: tab TPM (menerjemahkan teks baru; hasilnya disimpan dengan lock sendiri), lalu format & Ringkasan.
  langkah('TPM', function () { buildTpm_(); });
  langkah('KPI', function () {
    var y = yearOf_(new Date());
    buildKpi_(y);
    if (monthOf_(new Date()) === 1) buildKpi_(y - 1);   // Januari: KPI Desember tahun lalu masih bisa ditutup
    kpiTutupOtomatis_();
  });
  langkah('Tampilan', function () { rapikanTampilan_({}); });
  sehatCatat_('malam', { mulai: t0.toISOString(), selesai: new Date().toISOString(), gagal: gagal, dtk: Math.round((Date.now() - t0.getTime()) / 1000) });
  if (gagal.length) throw new Error('Pembaruan malam gagal sebagian: ' + gagal.join(' · '));
}

var MALAM_LOCK_MS_ = 120000;   // trigger malam menunggu teknisi shift malam selesai menekan tombol (bukan gagal)

/**
 * 2.6.9: tab Maintenance diurutkan admin (mis. per Line) → ekor tab bukan lagi pekerjaan terbaru (readHot_, ID baru, layar
 * line). Malam hari, di dalam lock: bila kolom Mulai tidak urut naik, seluruh tab diurutkan ulang menurut Mulai lalu ID, dan
 * dicatat di Log. Baris Input Manual yang ditambah di bawah (tanggal mundur) ikut masuk ke tempatnya.
 * @return {boolean} diurutkan
 */
function urutkanMaintenance_(now) {
  var sh = sheet_(APP.SHEETS.MAINT), last = sh.getLastRow();
  if (last < 3) return false;
  var h = headers_(sh, APP.SHEETS.MAINT), cm = h.indexOf('Mulai'), ci = h.indexOf('Maintenance ID');
  if (cm < 0 || ci < 0) return false;
  var prev = -Infinity, turun = 0;
  sh.getRange(2, cm + 1, last - 1, 1).getValues().forEach(function (r) {
    if (!(r[0] instanceof Date)) return;
    var t = r[0].getTime();
    if (t < prev) turun++;
    else prev = t;
  });
  if (!turun) return false;
  sh.getRange(2, 1, last - 1, sh.getLastColumn()).sort([{ column: cm + 1, ascending: true }, { column: ci + 1, ascending: true }]);
  log_(now, 'Tab Maintenance', APP.EVENTS.URUT, APP.SYSTEM_USER, 'Tab Maintenance tidak urut (' + turun + ' baris; mis. diurutkan manual atau Input Manual tanggal mundur) → diurutkan ulang menurut Mulai.');
  return true;
}

// ---------- 2.6.9 Kesehatan sistem: tugas terjadwal yang gagal / tidak jalan terlihat di Dashboard admin ----------
var SEHAT_KEY_ = 'MTTR_SEHAT_';   // + malam / timeout / backup (satu kunci per tugas: tidak saling menimpa)

function sehatCatat_(tugas, o) {
  try { PropertiesService.getDocumentProperties().setProperty(SEHAT_KEY_ + tugas, JSON.stringify(o)); } catch (e) { /* tidak menggagalkan tugasnya */ }
}

/** Peringatan untuk Dashboard admin. @param {Object<string,string>} props DocumentProperties (sekali baca) */
function sehatPeringatan_(props, now) {
  var get = function (k) { try { return JSON.parse(props[SEHAT_KEY_ + k] || 'null'); } catch (e) { return null; } };
  var tgl = function (iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '?' : fmtTz_(d, 'dd/MM HH:mm'); };
  var umur = function (iso) { var d = new Date(iso); return isNaN(d.getTime()) ? Infinity : now.getTime() - d.getTime(); };
  var H = 3600000, out = [], m = get('malam'), t = get('timeout'), b = get('backup');
  var obat = ' Coba Dashboard → Perbarui Laporan & Rekap; bila berulang: Extensions → Apps Script → Run setup.';
  if (m) {
    if (!m.selesai && umur(m.mulai) > 15 * 60000) out.push('Sistem: pembaruan malam ' + tgl(m.mulai) + ' tidak selesai (kemungkinan lewat batas waktu Apps Script 6 menit).' + obat);
    else if (m.gagal && m.gagal.length) out.push('Sistem: pembaruan malam ' + tgl(m.mulai) + ' gagal sebagian — ' + m.gagal.join(' · ').slice(0, 300) + '.' + obat);
    if (umur(m.mulai) > 36 * H) out.push('Sistem: pembaruan malam terakhir ' + tgl(m.mulai) + ' (lebih dari sehari lalu) — trigger malam mungkin hilang. Jalankan setup sekali.');
  }
  if (t) {
    if (umur(t.at) > 2 * H) out.push('Sistem: cek pekerjaan lewat waktu terakhir jalan ' + tgl(t.at) + ' — trigger mungkin hilang (pekerjaan lupa ditutup tidak jadi Abandoned). Jalankan setup sekali.');
    else if (t.gagal) out.push('Sistem: cek pekerjaan lewat waktu gagal ' + tgl(t.at) + ' — ' + String(t.gagal).slice(0, 200));
  }
  if (b && b.gagal) out.push('Sistem: tab backup gagal dibuat ' + tgl(b.at) + ' — ' + String(b.gagal).slice(0, 200) + '. Coba menu MTTR → Buat tab backup sekarang.');
  return out;
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
function syncReports_(r, rows, parts, loc) {
  if (!isYes_(getConfig_('LAPORAN_LANGSUNG'))) return;
  try {
    syncLaporan_(r, parts, loc);   // 2.6.1: Rekap (tersembunyi) tidak lagi per tombol; dibangun malam / Perbarui / setup
  } catch (e) {
    console.warn('Sinkron Laporan gagal (diperbaiki saat pembaruan penuh berikutnya): ' + e);
  }
}

/**
 * Letak baris pekerjaan r di tab Laporan tahun mulainya — hanya BACA (2.6.8: dipanggil sebelum tulisan pertama tombol).
 * @param {boolean=} baru r belum pernah ditulis ke Laporan (Mulai) → tanpa pencarian
 * @return {?{year, build?:boolean, sh?, n?, at?, max?}} null = tidak disinkron; build = bangun ulang tab
 */
function lapLocate_(r, baru) {
  if (!(r['Mulai'] instanceof Date)) return null;
  var year = yearOf_(r['Mulai']), sh = SpreadsheetApp.getActive().getSheetByName(laporanName_(year));
  var cols = masterData_().report, w = Math.max(1, cols.length);
  if (!sh) return { year: year, build: true };
  var last = sh.getLastRow();
  if (last < 2 || sh.getRange(2, w + 1).getValue() !== lapKeyHeader_(cols)) return { year: year, build: true };   // tab lama / format diubah
  // 2.6.3: baris pekerjaan dicari di server (TextFinder ±0,13 dtk), bukan membaca seluruh kolom kunci (±0,4–1,4 dtk setahun)
  var n = last - 2, hit = !baru && n > 0 ? sh.getRange(3, w + 1, n, 1).createTextFinder(String(r['Maintenance ID'])).matchEntireCell(true).findNext() : null;
  return { year: year, sh: sh, n: n, at: hit ? hit.getRow() - 3 : -1, max: sh.getMaxRows() };
}

/** @param {Object=} loc hasil lapLocate_ yang sudah dibaca sebelumnya (K8); tanpa itu dibaca di sini. */
function syncLaporan_(r, parts, loc) {
  if (loc === undefined) loc = lapLocate_(r);
  if (!loc) return;
  if (loc.build) { buildLaporan_(loc.year); return; }
  var year = loc.year, sh = loc.sh, n = loc.n, at = loc.at;
  var md = masterData_(), cols = md.report, w = Math.max(1, cols.length), id = String(r['Maintenance ID']);

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
  if (3 + idx > loc.max) { buildLaporan_(year); return; }   // baris cadangan habis → bangun ulang (baris + format)
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
  var a = stripOther_(choice), b = textOf_(detail).trim();
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

/** ①..⑳, lalu "21." dst. */
function partNo_(i) { return i < 20 ? String.fromCharCode(0x2460 + i) : (i + 1) + '.'; }

function laporanValue_(src, r, i, used, md, names) {
  var line = lineOf_(md, r['Line']);
  // >1 part: nomor yang sama di tiap kolom sparepart (① Timing Belt | ① HTD 5M-450 | ① 1) supaya baris mudah dicocokkan
  var col = function (k) {
    return used.map(function (u, i) { return (used.length > 1 ? partNo_(i) + ' ' : '') + (u[k] === '' || u[k] == null ? '-' : u[k]); }).join('\n');
  };
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
    case 'Jam mulai': return fmtTz_(r['Mulai'], 'HH.mm');
    case 'Jam selesai': return r['Selesai'] instanceof Date ? fmtTz_(r['Selesai'], 'HH.mm') : '';
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
    case 'Catatan': return tpmNote_(r['Catatan']);   // teks saja; cap waktu & nama tetap di Maintenance / Riwayat
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
/** @param {{forceBaterai?: boolean}=} opts forceBaterai = tab Maintenance <baterai> selalu dibangun ulang (setup) */
function buildLaporan_(year, opts) {
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
  ensureRows_(sh, out.length + LAP_SPARE_);
  // "07.30" ditulis sebagai teks: tanpa format @ Sheets mengubahnya jadi angka 7.3 (ditemukan di Sheets asli, 2.6.1)
  cols.forEach(function (c, j) {
    if (c.sumber === 'Jam mulai' || c.sumber === 'Jam selesai') sh.getRange(3, j + 1, out.length - 2 + LAP_SPARE_, 1).setNumberFormat('@');
  });
  sh.getRange(1, 1, out.length, w + 1).setValues(out);
  sh.hideColumns(w + 1);
  sh.getRange(1, 1, 1, w).merge().setFontWeight('bold');
  sh.getRange(2, 1, 1, w).setFontWeight('bold');
  // Baris cadangan di bawah tabel ikut diformat, supaya baris yang ditambah sinkron langsung tampil sama.
  var fmtRows = out.length - 1 + LAP_SPARE_;
  sh.getRange(2, 1, fmtRows, w).setWrap(true);
  sh.setFrozenRows(2);
  cols.forEach(function (c, j) {
    if (c.sumber === 'Tanggal' && fmtRows > 1) sh.getRange(3, j + 1, fmtRows - 1, 1).setNumberFormat('dd/mm/yyyy');
  });
  styleLaporan_(sh, cols, fmtRows);
  if (year === yearOf_(new Date())) {
    var counts = {};
    data.rows.forEach(function (r) { var b = String(r['Baterai']).trim(); counts[b] = (counts[b] || 0) + 1; });
    buildLaporanBaterai_(year, cols, counts, !!(opts && opts.forceBaterai));
  }
  return { year: year, sheet: laporanName_(year), rows: data.rows.length };
}

var LAP_BAT_KEY_ = 'MTTR_LAP_BAT';   // DocumentProperties: {baterai: {sig, upto}} tab Maintenance <baterai> terakhir dibangun

/**
 * Tab "Maintenance <baterai>" (2.6.1) = Laporan per project: judul, kolom, warna & belang sama dengan Laporan <tahun>,
 * hanya baris project itu, No. 1..n. Isinya rumus FILTER ke tab Laporan, jadi baris yang ditulis tiap aksi langsung ikut
 * tanpa tulisan tambahan. Dibangun ulang hanya jika format / tahun / judul / locale berubah, tab hilang, atau baris hampir
 * melewati area berformat (force: selalu). Lebar kolom tidak disentuh (atur sekali, bertahan).
 * @param {Object<string,number>} counts baris Laporan per baterai
 */
function buildLaporanBaterai_(year, cols, counts, force) {
  var md = masterData_(), ss = SpreadsheetApp.getActive();
  var nameOf = function (b) { return APP.SHEETS.MAINT + ' ' + b; };
  var bats = md.allBatteries;   // 2.6.9: tanpa project (spreadsheet baru) = tanpa tab per project
  var tabs = projectTabs_('TAB_BATERAI_DIMATIKAN', nameOf, bats);
  var props = PropertiesService.getDocumentProperties(), memo = {};
  try { memo = JSON.parse(props.getProperty(LAP_BAT_KEY_) || '{}') || {}; } catch (e) { memo = {}; }
  var w = Math.max(1, cols.length), lap = "'" + laporanName_(year) + "'!", judul = String(getConfig_('LAPORAN_JUDUL') || '');
  var pj = cols.map(function (c) { return c.sumber; }).indexOf('Project');
  var sig = [laporanName_(year), lapKeyHeader_(cols), judul, fxMode_()].join('|');
  tabs.on.forEach(function (bat) {
    var n = counts[bat] || 0, m = memo[bat];
    if (!force && m && m.sig === sig && n + 50 <= m.upto && ss.getSheetByName(nameOf(bat))) return;
    var fmtRows = 1 + n + LAP_SPARE_;   // header + baris project + cadangan (sama dengan Laporan)
    var sh = prepDerived_(ss, nameOf(bat));
    if (sh.getMaxRows() < fmtRows + 1) sh.insertRowsAfter(sh.getMaxRows(), fmtRows + 1 - sh.getMaxRows());
    if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
    var title = [judul + ' · ' + bat + ' · ' + year], q = String(bat).replace(/"/g, '');
    while (title.length < w) title.push('');
    var row = cols.map(function () { return ''; });
    if (pj < 0) row[0] = 'Aktifkan kolom Project di sheet Format Laporan supaya tab ini terisi.';
    else {
      var P = colLetter_(pj + 1), proj = lap + P + '3:' + P;
      for (var j = 0; j < w;) {
        if (cols[j].sumber === 'NO') { row[j] = fx_('=IFERROR(SEQUENCE(COUNTIF(' + proj + ', "' + q + '")), "")'); j++; continue; }
        var k = j;
        while (k + 1 < w && cols[k + 1].sumber !== 'NO') k++;
        row[j] = fx_('=IFERROR(FILTER(' + lap + colLetter_(j + 1) + '3:' + colLetter_(k + 1) + ', ' + proj + '="' + q + '"), "")');
        j = k + 1;
      }
    }
    sh.getRange(1, 1, 1, sh.getMaxColumns()).breakApart();   // jumlah kolom bisa berubah (Format Laporan)
    sh.getRange(1, 1, 2, w).setValues([title, cols.map(function (c) { return c.kolom; })]);
    sh.getRange(3, 1, 1, w).setFormulas([row]);
    sh.getRange(1, 1, 1, w).merge().setFontWeight('bold');
    sh.getRange(2, 1, 1, w).setFontWeight('bold');
    sh.getRange(2, 1, fmtRows, w).setWrap(true);
    sh.setFrozenRows(2);
    cols.forEach(function (c, j) { if (c.sumber === 'Tanggal') sh.getRange(3, j + 1, fmtRows - 1, 1).setNumberFormat('dd/mm/yyyy'); });
    styleLaporan_(sh, cols, fmtRows);
    memo[bat] = { sig: sig, upto: fmtRows };
  });
  props.setProperty(LAP_BAT_KEY_, JSON.stringify(memo));
  tabs.done();
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
    out.push(objToRow_(h, o, true));   // teks seperti "16:53" tetap teks di tab arsip
  });
  if (out.length) {
    var at = sh.getLastRow() + 1;
    ensureRows_(sh, at + out.length - 1, 500);
    sh.getRange(at, 1, out.length, h.length).setValues(out);
  }
  (APP.DATE_COLUMNS.Maintenance.concat(APP.DATE_COLUMNS.Log, APP.DATE_COLUMNS['Pemakaian Sparepart'])).forEach(function (col) {
    var c = h.indexOf(col) + 1;
    if (c > 0 && sh.getLastRow() > 1) sh.getRange(2, c, sh.getLastRow() - 1, 1).setNumberFormat(DATE_FMT_);
  });
  return out.length;
}

/** Tulis ulang isi sheet hanya dengan baris yang dipertahankan (satu kali tulis, format kolom tetap). */
function rewriteKeeping_(sh, values, keep) {
  var head = values[0], text = TEXT_SHEETS_.indexOf(sh.getName()) !== -1;
  var k = keyIdx_(head.map(function (x) { return String(x).trim(); }), sh.getName());   // 2.6.9: kolom kunci menurut nama (kolom disisip admin di A)
  var body = values.slice(1).filter(function (row) { return row[k] !== '' && row[k] !== null && keep(row); });
  if (text) body = body.map(function (row) { return row.map(cellText_); });   // ditulis ulang: teks "16:53" tidak berubah jadi jam
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
    // 2.6.5: baris yang dikosongkan dihapus (sisa 500 untuk baris baru) → arsip benar-benar mengurangi sel, bukan menambah
    [msh, lsh, ush].forEach(function (sh) { if (sh) trimSheet_(sh, 500); });
    [archiveName_(year), archiveLogName_(year), archiveUsageName_(year)].forEach(function (n) { var a = SpreadsheetApp.getActive().getSheetByName(n); if (a) trimSheet_(a, 0); });
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

// ---------- Hapus data testing (Admin, sebelum go-live) ----------

/** "dd/mm/yyyy" → Date jam 00:00 WIB. Kosong → null (= semua data). */
function parseTanggalWib_(s) {
  s = String(s || '').trim();
  if (!s) return null;
  var m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (!m) throw new Error('Format tanggal harus dd/mm/yyyy, mis. 20/10/2026.');
  var d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  var t = new Date(Date.UTC(y, mo - 1, d) - 7 * 3600000);   // WIB = UTC+7, tanpa DST
  var two = function (n) { return (n < 10 ? '0' : '') + n; };
  if (fmtTz_(t, 'dd/MM/yyyy') !== two(d) + '/' + two(mo) + '/' + y) throw new Error('Tanggal tidak valid: ' + s);
  return t;
}

/** Sheet data (yang ditulis aplikasi, termasuk yang diproteksi & tab arsip). Sheet master tidak termasuk. */
function testDataSheets_() {
  var names = SpreadsheetApp.getActive().getSheets().map(function (s) { return s.getName(); });
  var pick = function (re) { return names.filter(function (n) { return re.test(n); }); };
  return {
    maint: [APP.SHEETS.MAINT].concat(pick(/^Arsip \d{4}$/)),
    log: [APP.SHEETS.LOG].concat(pick(/^Arsip Log \d{4}$/)),
    usage: [APP.SHEETS.PEMAKAIAN].concat(pick(/^Arsip Sparepart \d{4}$/))
  };
}

/** Pekerjaan yang akan dihapus: dimulai sebelum `cutoff` (null = semua), beserta jumlah baris Log & sparepart-nya. */
function testDataPlan_(cutoff) {
  var ss = SpreadsheetApp.getActive(), sets = testDataSheets_(), ids = {};
  var counts = { maintenance: 0, log: 0, sparepart: 0 };
  sets.maint.forEach(function (name) {
    if (!ss.getSheetByName(name)) return;
    readTable_(name).forEach(function (r) {
      if (cutoff && !(r['Mulai'] instanceof Date && r['Mulai'] < cutoff)) return;
      var id = String(r['Maintenance ID']);
      if (!ids[id]) { ids[id] = true; counts.maintenance++; }
    });
  });
  var countIn = function (list) {
    var c = 0;
    list.forEach(function (name) {
      if (ss.getSheetByName(name)) readTable_(name).forEach(function (r) { if (ids[String(r['Maintenance ID'])]) c++; });
    });
    return c;
  };
  counts.log = countIn(sets.log);
  counts.sparepart = countIn(sets.usage);
  return { ids: ids, counts: counts, sets: sets };
}

/**
 * Hapus permanen pekerjaan yang dimulai sebelum `cutoff` (null = semua) dari Maintenance, Log, Pemakaian Sparepart
 * dan tab arsip; tab arsip yang jadi kosong dihapus; Laporan & Rekap dibangun ulang (tahun tanpa data tersisa: tabnya dihapus).
 * Tab rumus (Maintenance <baterai>, Pending Work) ikut bersih sendiri. Sheet master tidak disentuh.
 */
function hapusDataTesting_(cutoff) {
  return withLock_(function () {
    var ss = SpreadsheetApp.getActive();
    var plan = testDataPlan_(cutoff), ids = plan.ids;
    if (!plan.counts.maintenance) return plan.counts;
    var all = plan.sets.maint.concat(plan.sets.log, plan.sets.usage);
    all.forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return;
      var vals = sh.getDataRange().getValues();
      var iId = vals[0].map(function (h) { return String(h).trim(); }).indexOf('Maintenance ID');
      if (iId >= 0) { rewriteKeeping_(sh, vals, function (row) { return !ids[String(row[iId])]; }); trimSheet_(sh, 500); }   // 2.6.5: baris kosong dihapus
    });
    all.forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (sh && /^Arsip /.test(name) && sh.getLastRow() < 2) ss.deleteSheet(sh);
    });
    plan.counts.kpi = kpiReopen_(cutoff);   // KPI bulan tertutup yang berisi data testing dihitung ulang dari data tersisa
    resetHeaders_();
    var nowY = yearOf_(new Date()), years = {};
    years[nowY] = true;
    ss.getSheets().forEach(function (s) { var m = /^(?:Laporan|Rekap) (\d{4})$/.exec(s.getName()); if (m) years[m[1]] = true; });
    Object.keys(years).forEach(function (k) {
      var y = Number(k);
      if (y !== nowY && !rekapRows_(y).length && !laporanRows_(y).rows.length) {
        [laporanName_(y), rekapName_(y)].forEach(function (n) { var sh = ss.getSheetByName(n); if (sh) ss.deleteSheet(sh); });
      } else {
        buildRekap_(y);
        buildLaporan_(y);
      }
    });
    return plan.counts;
  });
}

function menuHapusDataTesting() {
  requireUser_([APP.ROLES.ADMIN]);
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Hapus data testing',
    'Hapus PERMANEN pekerjaan maintenance yang DIMULAI SEBELUM tanggal (dd/mm/yyyy), mis. tanggal mulai pakai sungguhan.\n' +
    'Kosongkan = hapus SEMUA data maintenance.\n\n' +
    'Ikut terhapus: Log, Pemakaian Sparepart, tab Arsip; Laporan, Rekap, TPM & KPI dibuat ulang (bulan KPI yang sudah ditutup s/d tanggal itu dibuka lagi).\n' +
    'TIDAK dihapus: Users, Factory, Projects, Lines, Sparepart, Pilihan, Form, Format Laporan, Catatan Panduan, Config.',
    ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var cutoff = parseTanggalWib_(r1.getResponseText());
  var n = testDataPlan_(cutoff).counts;
  if (!n.maintenance) { ui.alert('Tidak ada data yang cocok. Tidak ada yang dihapus.'); return; }
  var r2 = ui.prompt('Konfirmasi hapus permanen',
    'Akan DIHAPUS: ' + n.maintenance + ' pekerjaan, ' + n.log + ' baris Log, ' + n.sparepart + ' baris pemakaian sparepart' +
    (cutoff ? ' (dimulai sebelum ' + fmtTz_(cutoff, 'dd/MM/yyyy') + ').' : ' (SEMUA DATA).') + '\n\n' +
    'Sebaiknya backup dulu: File → Make a copy. Bisa juga dikembalikan lewat File → Version history.\n\n' +
    'Ketik HAPUS untuk melanjutkan:', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK || String(r2.getResponseText() || '').trim().toUpperCase() !== 'HAPUS') {
    ui.alert('Dibatalkan. Tidak ada yang dihapus.');
    return;
  }
  var out = hapusDataTesting_(cutoff);
  var tpm = '';
  try { buildTpm_(); } catch (e) { tpm = ' Tab TPM gagal diperbarui (' + e.message + '): tekan Dashboard → Perbarui Laporan, Rekap & TPM.'; }
  try { buildKpi_(); } catch (e) { tpm += ' Tab KPI gagal diperbarui (' + e.message + ').'; }
  ui.alert('Selesai: ' + out.maintenance + ' pekerjaan, ' + out.log + ' baris Log, ' + out.sparepart +
    ' baris sparepart dihapus. Laporan, Rekap, TPM & KPI sudah dibuat ulang dari data yang tersisa.' +
    (out.kpi && out.kpi.length ? ' KPI yang dibuka lagi (tutup ulang setelah dicek): ' + out.kpi.map(ymLabel_).join(', ') + '.' : '') + tpm);
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
