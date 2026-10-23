/**
 * KPI bulanan (2.6): MTTR & MTBF per Plant / Project / Line, tab "KPI <tahun>" dan tutup bulan.
 *
 * - Kerusakan = pekerjaan yang masuk MTTR (Masuk MTTR = Ya: Corrective selesai + Abandoned yang dihitung admin).
 *   Bulan = bulan final, sama dengan Rekap (finalDate_), jadi jumlah & MTTR Plant satu bulan = angka Rekap bulan itu.
 * - MTTR (menit) = rata-rata waktu aktif. Downtime (jam) = Mulai → Selesai pekerjaan stop line (= "Durasi stop line" Laporan).
 * - Jam operasi = hari operasi (Config HARI_OPERASI, tanpa TANGGAL_LIBUR, sejak KPI_MULAI; bulan berjalan s/d hari ini)
 *   × JAM_OPERASI_PER_HARI × jumlah line (line aktif + line yang rusak di bulan itu). Line yang melayani beberapa project
 *   dihitung penuh di setiap project itu.
 * - MTBF (jam) = (jam operasi − downtime) ÷ kerusakan. Tanpa kerusakan → kosong (target MTBF dianggap tercapai).
 * - Tutup bulan (admin): angka bulan itu disalin ke sheet tersembunyi "KPI data"; sejak itu bulan tersebut selalu diambil
 *   dari salinan, jadi edit data lama tidak mengubah KPI yang sudah dilaporkan. Tutup ulang = salinan diganti + dicatat di Log.
 */

var KPI_PREFIX_ = 'KPI ';
var KPI_LEVEL_ = { PLANT: 'Plant', PROJECT: 'Project', LINE: 'Line' };
/** Kolom tab KPI <tahun> (judul dua bahasa). Urutan dipakai rumus Ringkasan: A = Bulan, B = Level, G = Downtime, I = MTBF. */
var KPI_HEADERS_ = [['Bulan', '月份'], ['Level', '层级'], ['Nama', '名称'], ['Kerusakan', '故障次数'], ['MTTR (menit)', '平均修复时间（分钟）'],
  ['Target MTTR (menit)', '目标（分钟）'], ['Downtime (jam)', '停机时间（小时）'], ['Jam operasi', '运行时间（小时）'],
  ['MTBF (jam)', '平均故障间隔（小时）'], ['Target MTBF (jam)', '目标（小时）'], ['Tercapai', '达标'], ['Status', '状态']];
var HARI_ = { min: 0, sen: 1, sel: 2, rab: 3, kam: 4, jum: 5, sab: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function kpiName_(year) { return KPI_PREFIX_ + year; }
function ymOf_(d) { return Utilities.formatDate(d, APP.TZ, 'yyyy-MM'); }
function ymKey_(year, month) { return year + '-' + (month < 10 ? '0' : '') + month; }
function ymLabel_(key) { var m = /^(\d{4})-(\d{2})$/.exec(key); return m ? BULAN_[Number(m[2]) - 1] + ' ' + m[1] : key; }

// ---------- pengaturan jam operasi (Config) ----------

/** "Sen-Min", "Sen-Sab", "Sen,Sel,Rab", "1-5" (1 = Senin, 7 = Minggu). Kosong = setiap hari. @return {boolean[]} 0 = Minggu */
function parseHariOperasi_(v, warn) {
  var all = [true, true, true, true, true, true, true];
  var s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s*[-–]\s*/g, '-');
  if (!s) return all;
  var day = function (t) {
    if (/^[1-7]$/.test(t)) return Number(t) % 7;
    var k = HARI_[t.slice(0, 3)];
    return k == null ? -1 : k;
  };
  var on = [false, false, false, false, false, false, false], bad = false;
  s.split(/[,;\s]+/).filter(String).forEach(function (part) {
    var ab = part.split('-'), a = day(ab[0]), b = ab.length > 1 ? day(ab[1]) : a;
    if (a < 0 || b < 0 || ab.length > 2) { bad = true; return; }
    for (var d = a, i = 0; i < 7; i++, d = (d + 1) % 7) { on[d] = true; if (d === b) break; }
  });
  if (bad || on.indexOf(true) === -1) {
    warn.push('Config HARI_OPERASI "' + v + '" tidak dikenal (contoh: Sen-Min, Sen-Sab, Sen,Sel,Rab); dipakai setiap hari.');
    return all;
  }
  return on;
}

/** Tanggal Config: Date (sel tanggal), teks dd/mm/yyyy, atau ISO (dari cache master). */
function kpiDate_(v, label, warn) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d\d-\d\dT/.test(s) && !isNaN(new Date(s).getTime())) return new Date(s);
  try { return parseTanggalWib_(s); } catch (e) { warn.push('Config ' + label + ' "' + s + '": ' + e.message); return null; }
}

function kpiSettings_() {
  var warn = [], ymd = function (d) { return Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd'); };
  var h = Number(String(getConfig_('JAM_OPERASI_PER_HARI')).replace(',', '.'));
  if (!(h > 0 && h <= 24)) {
    warn.push('Config JAM_OPERASI_PER_HARI "' + getConfig_('JAM_OPERASI_PER_HARI') + '" harus 1–24; dipakai 24.');
    h = 24;
  }
  var libur = {}, lv = getConfig_('TANGGAL_LIBUR');
  (lv instanceof Date ? [lv] : String(lv == null ? '' : lv).split(/[,;\n]+/)).forEach(function (t) {
    var d = kpiDate_(t, 'TANGGAL_LIBUR', warn);
    if (d) libur[ymd(d)] = true;
  });
  var mulai = kpiDate_(getConfig_('KPI_MULAI'), 'KPI_MULAI', warn);
  return { hours: h, days: parseHariOperasi_(getConfig_('HARI_OPERASI'), warn), libur: libur, mulai: mulai ? ymd(mulai) : '', warn: warn };
}

/** Jumlah hari operasi satu bulan: hari operasi, bukan libur, sejak KPI_MULAI; bulan berjalan s/d hari ini. */
function kpiDays_(year, month, s, now) {
  var today = Utilities.formatDate(now, APP.TZ, 'yyyy-MM-dd'), last = new Date(Date.UTC(year, month, 0)).getUTCDate(), n = 0;
  for (var d = 1; d <= last; d++) {
    var key = ymKey_(year, month) + '-' + (d < 10 ? '0' : '') + d;
    if (key > today) break;
    if ((s.mulai && key < s.mulai) || s.libur[key] || !s.days[new Date(Date.UTC(year, month - 1, d)).getUTCDay()]) continue;
    n++;
  }
  return n;
}

// ---------- hitung ----------

function kpiTercapai_(x) {
  if (x.targetMttr == null && x.targetMtbf == null) return '';
  var bad = [];
  if (x.targetMttr != null && x.mttr != null && x.mttr > x.targetMttr) bad.push('MTTR');
  if (x.targetMtbf != null && x.mtbf != null && x.mtbf < x.targetMtbf) bad.push('MTBF');
  return bad.length ? '✗ ' + bad.join(' & ') : '✓';
}

/**
 * Angka KPI satu bulan.
 * @param {Object[]} rows pekerjaan (Maintenance [+ Arsip]); yang final di bulan itu saja yang dipakai
 * @param {{levels?:string[]}=} opts levels bawaan: Plant, Project, Line
 * @return {Object[]} {bulan, level, kunci, nama, kerusakan, mttr, targetMttr, downtime, jamOperasi, mtbf, targetMtbf, tercapai}
 */
function computeKpi_(year, month, rows, md, s, now, opts) {
  var key = ymKey_(year, month), L = KPI_LEVEL_, levels = (opts && opts.levels) || [L.PLANT, L.PROJECT, L.LINE];
  var perLine = kpiDays_(year, month, s, now) * s.hours;
  var blank = function () { return { n: 0, act: 0, down: 0, lines: {} }; };
  var plant = blank(), byBat = {}, byLine = {};
  rows.forEach(function (r) {
    var st = r['Status'];
    if (r['Masuk MTTR'] !== APP.MTTR.YES || (st !== APP.STATUS.COMPLETED && st !== APP.STATUS.ABANDONED)) return;
    var d = finalDate_(r);
    if (!d || ymOf_(d) !== key || (s.mulai && Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd') < s.mulai)) return;
    var act = Number(r['Total aktif (menit)'] || 0);
    var down = r['Stop line'] === APP.YES && r['Selesai'] instanceof Date && r['Mulai'] instanceof Date
      ? Math.max(0, r['Selesai'].getTime() - r['Mulai'].getTime()) / 3600000 : 0;
    var line = String(r['Line'] || '').trim(), bat = String(r['Baterai'] || '').trim();
    [plant, bat ? (byBat[bat] = byBat[bat] || blank()) : null, line ? (byLine[line] = byLine[line] || blank()) : null].forEach(function (o) {
      if (!o) return;
      o.n++; o.act += act; o.down += down;
      if (line) o.lines[line] = true;
    });
  });
  var active = Object.keys(md.lines).filter(function (k) { return md.lines[k].active; });
  var lineCount = function (o, pool) {   // line aktif + line yang rusak bulan ini (walau sudah nonaktif)
    var set = {};
    pool.concat(Object.keys(o.lines)).forEach(function (k) { set[k] = true; });
    return Object.keys(set).length;
  };
  var out = [];
  var add = function (level, kunci, nama, o, nLines, tm, tb) {
    var jam = round2_(perLine * nLines);
    var x = { bulan: key, level: level, kunci: kunci, nama: nama, kerusakan: o.n, mttr: o.n ? round2_(o.act / o.n) : null,
      targetMttr: tm == null ? null : tm, downtime: round2_(o.down), jamOperasi: jam,
      mtbf: o.n && jam > 0 ? round2_(Math.max(0, jam - o.down) / o.n) : null, targetMtbf: tb == null ? null : tb };
    x.tercapai = kpiTercapai_(x);
    out.push(x);
  };
  if (levels.indexOf(L.PLANT) !== -1) add(L.PLANT, 'PLANT', appName_(), plant, lineCount(plant, active), null, null);
  if (levels.indexOf(L.PROJECT) !== -1) {
    var bats = [], tgt = {};
    md.projects.forEach(function (p) {   // baterai sama di dua factory = satu project (seperti Ringkasan)
      if (!tgt[p.battery]) { tgt[p.battery] = { mttr: null, mtbf: null }; bats.push(p.battery); }
      if (tgt[p.battery].mttr == null) tgt[p.battery].mttr = p.target;
      if (tgt[p.battery].mtbf == null) tgt[p.battery].mtbf = p.targetMtbf;
    });
    Object.keys(byBat).sort().forEach(function (b) { if (!tgt[b]) { tgt[b] = { mttr: null, mtbf: null }; bats.push(b); } });   // project lama / nonaktif
    bats.forEach(function (b) {
      var o = byBat[b] || blank();
      var pool = active.filter(function (k) { return md.lines[k].batteries.indexOf(b) !== -1; });
      add(L.PROJECT, b, b, o, lineCount(o, pool), tgt[b].mttr, tgt[b].mtbf);
    });
  }
  if (levels.indexOf(L.LINE) !== -1) {
    var keys = {};
    active.concat(Object.keys(byLine)).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).sort().forEach(function (k) {
      var l = md.lines[k];
      add(L.LINE, k, k + (l && l.name ? ' · ' + l.name : ''), byLine[k] || blank(), 1, null, null);
    });
  }
  return out;
}

function kpiBrief_(x) {
  if (!x) return '–';
  return x.kerusakan + ' kerusakan, MTTR ' + (x.mttr == null ? '–' : Math.round(x.mttr) + ' mnt') +
    ', MTBF ' + (x.mtbf == null ? '–' : x.mtbf + ' jam') + ', downtime ' + x.downtime + ' jam';
}

// ---------- bulan yang sudah ditutup (sheet KPI data) ----------

function kpiMonthOfCell_(v) { return v instanceof Date ? ymOf_(v) : String(v == null ? '' : v).trim(); }

/** @return {Object<string, {rows:Object[], at:*, by:string}>} per 'yyyy-mm' */
function kpiClosed_() {
  var out = {};
  if (!findSheet_(APP.SHEETS.KPI_DATA)) return out;
  var num = function (v) { return v === '' || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v); };
  readTable_(APP.SHEETS.KPI_DATA).forEach(function (r) {
    var b = kpiMonthOfCell_(r['Bulan']);
    if (!/^\d{4}-\d{2}$/.test(b)) return;
    var m = out[b] = out[b] || { rows: [], at: r['Ditutup pada'], by: String(r['Ditutup oleh'] || '').toLowerCase() };
    m.rows.push({ bulan: b, level: String(r['Level']), kunci: String(r['Kunci']), nama: String(r['Nama']), kerusakan: num(r['Kerusakan']) || 0,
      mttr: num(r['MTTR (menit)']), targetMttr: num(r['Target MTTR (menit)']), downtime: num(r['Downtime (jam)']) || 0,
      jamOperasi: num(r['Jam operasi']) || 0, mtbf: num(r['MTBF (jam)']), targetMtbf: num(r['Target MTBF (jam)']), tercapai: String(r['Tercapai'] || '') });
  });
  return out;
}

/*
 * Daftar bulan tertutup juga disimpan ringkas di DocumentProperties ({'2026-09': [ISO, email]}), supaya Dashboard admin tidak
 * membaca sheet KPI data setiap kali dibuka. Sumber kebenaran tetap sheet; daftar ini disegarkan saat tutup bulan,
 * hapus data testing, dan setiap pembangunan tab KPI (tiap malam).
 */
var KPI_CLOSED_KEY_ = 'MTTR_KPI_CLOSED';
function kpiClosedIndex_() {
  try { return JSON.parse(PropertiesService.getDocumentProperties().getProperty(KPI_CLOSED_KEY_) || 'null'); } catch (e) { return null; }
}
function saveKpiClosedIndex_(closed) {
  var idx = {};
  Object.keys(closed).forEach(function (k) { var c = closed[k]; idx[k] = [c.at instanceof Date ? c.at.toISOString() : String(c.at || ''), c.by]; });
  try { PropertiesService.getDocumentProperties().setProperty(KPI_CLOSED_KEY_, JSON.stringify(idx)); } catch (e) { /* disegarkan lagi malam ini */ }
}

/** Ganti salinan satu bulan di sheet KPI data (dipanggil di dalam lock). */
function writeKpiSnapshot_(key, list, now, email) {
  var name = APP.SHEETS.KPI_DATA, sh = sheet_(name), h = headers_(sh, name), w = h.length;
  var vals = sh.getDataRange().getValues();
  var keep = vals.slice(1).filter(function (r) { var b = kpiMonthOfCell_(r[0]); return b && b !== key; })
    .map(function (r) { var x = r.slice(0, w); while (x.length < w) x.push(''); x[0] = kpiMonthOfCell_(x[0]); return x; });
  var nz = function (v) { return v == null ? '' : v; };
  var fresh = list.map(function (x) {
    return objToRow_(h, { 'Bulan': x.bulan, 'Level': x.level, 'Kunci': x.kunci, 'Nama': x.nama, 'Kerusakan': x.kerusakan, 'MTTR (menit)': nz(x.mttr),
      'Target MTTR (menit)': nz(x.targetMttr), 'Downtime (jam)': x.downtime, 'Jam operasi': x.jamOperasi, 'MTBF (jam)': nz(x.mtbf),
      'Target MTBF (jam)': nz(x.targetMtbf), 'Tercapai': x.tercapai, 'Ditutup pada': now, 'Ditutup oleh': email });
  });
  var all = keep.concat(fresh);
  if (vals.length > 1) sh.getRange(2, 1, vals.length - 1, Math.max(w, vals[0].length)).clearContent();
  if (all.length) {
    ensureRows_(sh, all.length + 1, 200);
    sh.getRange(2, 1, all.length, 1).setNumberFormat('@');   // "2026-09" tetap teks, tidak diubah Sheets jadi tanggal
    sh.getRange(2, 1, all.length, w).setValues(all);
  }
}

/** Hapus data testing (di dalam lock): bulan tertutup yang bisa berisi data terhapus (≤ bulan cutoff; tanpa cutoff = semua) dibuka lagi. */
function kpiReopen_(cutoff) {
  var sh = findSheet_(APP.SHEETS.KPI_DATA);
  if (!sh || sh.getLastRow() < 2) return [];
  var lim = cutoff ? ymOf_(cutoff) : '', gone = {};
  rewriteKeeping_(sh, sh.getDataRange().getValues(), function (row) {
    var b = kpiMonthOfCell_(row[0]), drop = !lim || b <= lim;
    if (drop) gone[b] = true;
    return !drop;
  });
  resetHeaders_();
  saveKpiClosedIndex_(kpiClosed_());
  return Object.keys(gone).sort();
}

/** Pekerjaan bulan itu yang masih menunggu review admin (bisa mengubah Masuk MTTR). */
function kpiReviewsOpen_(rows, key) {
  return rows.filter(function (r) {
    if (r['Status review'] !== APP.REVIEW.NEEDED || r['Status'] !== APP.STATUS.ABANDONED) return false;   // 2.6.1: Cancel tanpa review
    var d = finalDate_(r);
    return !!d && ymOf_(d) === key;
  }).length;
}

// ---------- tab KPI <tahun> ----------

/** Bulan yang tampil: sejak KPI_MULAI / bulan data pertama s/d bulan ini (tahun berjalan) atau Desember. */
function kpiMonths_(year, rows, s, now, closed) {
  var curY = yearOf_(now), curM = monthOf_(now);
  if (year > curY) return [];
  var end = year === curY ? curM : 12, start = 0;
  if (s.mulai) {
    var my = Number(s.mulai.slice(0, 4));
    if (my > year) return [];
    start = my < year ? 1 : Number(s.mulai.slice(5, 7));
  } else {
    rows.forEach(function (r) {
      var d = finalDate_(r);
      if (d && yearOf_(d) === year && (!start || monthOf_(d) < start)) start = monthOf_(d);
    });
    Object.keys(closed).forEach(function (k) { if (Number(k.slice(0, 4)) === year && (!start || Number(k.slice(5)) < start)) start = Number(k.slice(5)); });
    if (!start && year === curY) start = curM;
  }
  var out = [];
  for (var m = start; m && m <= end; m++) out.push(m);
  return out;
}

/** Bangun ulang tab "KPI <tahun>" (nilai statis). Bulan tertutup dari KPI data, bulan lain dihitung dari data. */
function buildKpi_(year) {
  var now = new Date();
  year = checkYear_(year || yearOf_(now));
  var md = masterData_(), s = kpiSettings_(), rows = rekapRows_(year), closed = kpiClosed_(), names = userNameMap_();
  saveKpiClosedIndex_(closed);
  var cur = ymOf_(now), months = kpiMonths_(year, rows, s, now, closed), data = [];
  var nz = function (v) { return v == null ? '' : v; };
  months.forEach(function (m) {
    var key = ymKey_(year, m), c = closed[key];
    var status = c ? 'Ditutup ' + (c.at instanceof Date ? Utilities.formatDate(c.at, APP.TZ, 'dd/MM/yyyy') : String(c.at || '')) + ' oleh ' + closerName_(names, c.by)
      : (key === cur ? 'Berjalan' : 'Belum ditutup');
    (c ? c.rows : computeKpi_(year, m, rows, md, s, now)).forEach(function (x) {
      data.push([x.bulan, x.level, x.nama, x.kerusakan, nz(x.mttr), nz(x.targetMttr), x.downtime, x.jamOperasi, nz(x.mtbf), nz(x.targetMtbf), x.tercapai, status]);
    });
  });
  var name = kpiName_(year), ss = SpreadsheetApp.getActive();
  writeKpiSheet_(ss.getSheetByName(name) || ss.insertSheet(name), data);
  return { sheet: name, rows: data.length, months: months.length, warn: s.warn.join(' ') };
}

function writeKpiSheet_(sh, data) {
  var head = KPI_HEADERS_.map(function (h) { return h[0] + '\n' + h[1]; }), w = head.length;
  sh.clear();
  sh.setConditionalFormatRules([]);
  sh.getRange(1, 1, 1, w).setValues([head]);
  if (data.length) {
    ensureRows_(sh, data.length + 1, 50);
    sh.getRange(2, 1, data.length, 1).setNumberFormat('@');   // Bulan "2026-09" = teks (dicari rumus Ringkasan)
    sh.getRange(2, 1, data.length, w).setValues(data);
  }
  forgetHeaders_(sh.getName());
  var wide = {};
  wide[head[0]] = 80; wide[head[1]] = 80; wide[head[2]] = 230; wide[head[11]] = 210;
  styleTable_(sh, { filter: true, wide: wide }, true);
  sh.setFrozenColumns(3);
  var n = Math.max(sh.getMaxRows(), 2) - 1;
  [[4, '0'], [5, '0'], [6, '0'], [7, '0.0'], [8, '0'], [9, '0.0'], [10, '0.0']].forEach(function (f) { sh.getRange(2, f[0], n, 1).setNumberFormat(f[1]); });
  var rule = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  var ok = TEMA_.status.Completed, bad = TEMA_.status.Abandoned;
  sh.setConditionalFormatRules(sh.getConditionalFormatRules().concat([
    rule().whenTextStartsWith('✓').setBackground(ok[0]).setFontColor(ok[1]).setBold(true).setRanges([sh.getRange(2, 11, n, 1)]).build(),
    rule().whenTextStartsWith('✗').setBackground(bad[0]).setFontColor(bad[1]).setBold(true).setRanges([sh.getRange(2, 11, n, 1)]).build(),
    rule().whenFormulaSatisfied(fx_('=$B2="' + KPI_LEVEL_.PLANT + '"')).setBackground(TEMA_.section).setBold(true).setRanges([sh.getRange(2, 1, n, w)]).build(),
    rule().whenFormulaSatisfied(fx_('=$B2="' + KPI_LEVEL_.PROJECT + '"')).setBold(true).setRanges([sh.getRange(2, 1, n, w)]).build()
  ]));
}

// ---------- tutup bulan ----------

/** Admin: kunci angka KPI satu bulan yang sudah lewat. Tutup ulang = salinan diganti, nilai lama → baru dicatat di Log. */
function apiTutupBulan(ym) {
  var user = requireUser_([APP.ROLES.ADMIN]);
  return kpiTutup_(ym, user.email, '');
}

/** Tutup bulan (admin lewat apiTutupBulan, atau trigger malam = SYSTEM lewat kpiTutupOtomatis_). */
function kpiTutup_(ym, email, note) {
  var key = String(ym || '').trim(), m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error('Bulan tidak valid: "' + key + '" (format yyyy-mm, mis. 2026-09).');
  var year = checkYear_(Number(m[1])), month = Number(m[2]), now = new Date();
  if (key >= ymOf_(now)) throw new Error(ymLabel_(key) + ' belum berakhir. Yang bisa ditutup hanya bulan yang sudah lewat.');
  var md = masterData_(), s = kpiSettings_();
  var res = withLock_(function () {
    var closed = kpiClosed_(), before = closed[key], rows = rekapRows_(year);
    var list = computeKpi_(year, month, rows, md, s, now);
    writeKpiSnapshot_(key, list, now, email);
    closed[key] = { rows: list, at: now, by: String(email).toLowerCase() };
    saveKpiClosedIndex_(closed);
    var plantOf = function (l) { return l.filter(function (x) { return x.level === KPI_LEVEL_.PLANT; })[0]; };
    var plant = plantOf(list);
    log_(now, 'KPI ' + key, APP.EVENTS.TUTUP_BULAN, email, ymLabel_(key) + ': ' + kpiBrief_(plant) + (note ? ' · ' + note : '') +
      (before ? ' · ditutup ulang; sebelumnya' + (before.at instanceof Date ? ' (' + Utilities.formatDate(before.at, APP.TZ, 'dd/MM/yyyy HH:mm') + ')' : '') +
        ': ' + kpiBrief_(plantOf(before.rows)) : ''));
    return { plant: plant, reclosed: !!before, reviews: kpiReviewsOpen_(rows, key) };
  });
  var built = buildKpi_(year);
  return { bulan: key, label: ymLabel_(key), plant: res.plant, reclosed: res.reclosed, reviews: res.reviews, sheet: built.sheet, warn: built.warn };
}

/**
 * Trigger malam (2.6.1): bulan lalu ditutup otomatis mulai tanggal Config KPI_TUTUP_OTOMATIS (0 = mati), hanya jika belum
 * ditutup, ada datanya, dan tidak ada Abandoned bulan itu yang menunggu review (angkanya masih bisa berubah).
 * @return {string} bulan yang ditutup, '' jika tidak
 */
function kpiTutupOtomatis_(now) {
  now = now || new Date();
  var day = Math.floor(Number(getConfig_('KPI_TUTUP_OTOMATIS')));
  if (!(day >= 1 && day <= 28) || Number(Utilities.formatDate(now, APP.TZ, 'dd')) < day) return '';
  var y = yearOf_(now), mo = monthOf_(now), pk = mo === 1 ? ymKey_(y - 1, 12) : ymKey_(y, mo - 1);
  if (kpiClosed_()[pk]) return '';
  var rows = rekapRows_(Number(pk.slice(0, 4))), s = kpiSettings_();
  if (s.mulai && s.mulai.slice(0, 7) > pk) return '';
  if (!rows.some(function (r) { var d = finalDate_(r); return !!d && ymOf_(d) === pk; }) || kpiReviewsOpen_(rows, pk)) return '';
  kpiTutup_(pk, APP.SYSTEM_USER, 'otomatis (Config KPI_TUTUP_OTOMATIS = ' + day + ')');
  return pk;
}

/** Nama penutup bulan untuk tampilan: SYSTEM = "otomatis". */
function closerName_(names, by) {
  by = String(by || '').toLowerCase();
  return by === APP.SYSTEM_USER.toLowerCase() ? 'otomatis' : (names[by] || by);
}

/** Kartu KPI Dashboard: bulan berjalan (Plant + project) dari baris Maintenance yang sudah dibaca. Admin: status bulan lalu. */
function kpiDashboard_(user, rows, md, now, names) {
  var s = kpiSettings_(), y = yearOf_(now), m = monthOf_(now), key = ymKey_(y, m);
  var out = { bulan: key, label: ymLabel_(key), rows: computeKpi_(y, m, rows, md, s, now, { levels: [KPI_LEVEL_.PLANT, KPI_LEVEL_.PROJECT] }),
    hours: s.hours, warn: s.warn };
  if (isAdmin_(user)) {
    var pk = m === 1 ? ymKey_(y - 1, 12) : ymKey_(y, m - 1);
    var idx = kpiClosedIndex_();
    if (!idx) { idx = {}; var all = kpiClosed_(); saveKpiClosedIndex_(all); Object.keys(all).forEach(function (k) { idx[k] = [all[k].at instanceof Date ? all[k].at.toISOString() : '', all[k].by]; }); }
    var c = idx[pk];
    var hasData = rows.some(function (r) { var d = finalDate_(r); return !!d && ymOf_(d) === pk; });
    if (c || (hasData && !(s.mulai && s.mulai.slice(0, 7) > pk))) {
      out.prev = { bulan: pk, label: ymLabel_(pk), closedIso: c ? c[0] : '', closedBy: c ? closerName_(names, c[1]) : '', reviews: kpiReviewsOpen_(rows, pk) };
    }
    out.autoDay = Math.max(0, Math.floor(Number(getConfig_('KPI_TUTUP_OTOMATIS')) || 0));
    // 2.6.1: yang patut dicek admin (pengganti review Cancel): cancel setelah lama bekerja, dan porsi input manual
    var cur = function (r) { var d = finalDate_(r); return !!d && ymOf_(d) === key; };
    var done = rows.filter(function (r) { return r['Status'] === APP.STATUS.COMPLETED && cur(r); });
    out.audit = {
      cancelLong: rows.filter(function (r) { return r['Status'] === APP.STATUS.CANCELLED && cur(r) && Number(r['Total aktif (menit)'] || 0) >= 30; }).length,
      manual: done.filter(function (r) { return String(r['Input manual oleh'] || '').trim() !== ''; }).length, done: done.length
    };
  }
  return out;
}

function menuKpi() {
  requireUser_([APP.ROLES.ADMIN]);
  var r = buildKpi_();
  SpreadsheetApp.getUi().alert('Tab ' + r.sheet + ' diperbarui (' + r.months + ' bulan, ' + r.rows + ' baris).' + (r.warn ? '\n\n' + r.warn : ''));
}

function menuTutupBulan() {
  requireUser_([APP.ROLES.ADMIN]);
  var ui = SpreadsheetApp.getUi(), now = new Date(), y = yearOf_(now), m = monthOf_(now);
  var def = m === 1 ? ymKey_(y - 1, 12) : ymKey_(y, m - 1);
  var r = ui.prompt('Tutup bulan KPI', 'Bulan yang ditutup (yyyy-mm). Kosongkan = ' + def + ' (' + ymLabel_(def) + ').\n\n' +
    'Angka KPI bulan itu dikunci: edit data lama tidak mengubahnya lagi. Tutup ulang = angka diganti & dicatat di Log.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var res = apiTutupBulan(String(r.getResponseText() || '').trim() || def);
  ui.alert(res.label + ' ditutup' + (res.reclosed ? ' ulang' : '') + '.\n\nPlant: ' + kpiBrief_(res.plant) + '\nTab: ' + res.sheet +
    (res.reviews ? '\n\nCatatan: ' + res.reviews + ' pekerjaan bulan itu masih menunggu review. Setelah direview, tutup ulang bulan ini.' : ''));
}

// ---------- Statistik (Dashboard → Statistik) ----------
/*
 * Dasar sama dengan KPI: kerusakan yang masuk MTTR dan final di rentang tanggal (WIB), plus filter Dashboard.
 * Jadi MTTR / downtime / MTBF satu project untuk satu bulan penuh = angka tab KPI. Pekerjaan yang masih berjalan tidak ikut.
 */
var STATS_BY_ = ['line', 'proses', 'project', 'teknisi', 'jenis', 'discipline', 'masalah', 'sparepart', 'hari', 'bulan'];
var STATS_MEASURES_ = ['frek', 'mttr', 'downtime', 'mtbf'];
var STATS_MTBF_BY_ = ['line', 'proses', 'project'];   // MTBF butuh jam operasi = jumlah line
var STATS_TOP_ = 30, STATS_DAYS_MAX_ = 93, STATS_ITEMS_MAX_ = 100;

function ymdOf_(d) { return Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd'); }

/** Rentang dari klien: 'yyyy-mm-dd' s/d 'yyyy-mm-dd' (inklusif, WIB). */
function statsRange_(f) {
  var re = /^(\d{4})-(\d{2})-(\d{2})$/, a = re.exec(String(f.from || '')), b = re.exec(String(f.to || ''));
  if (!a || !b) throw new Error('Pilih periode (tanggal dari & sampai).');
  var day = function (m, s) {
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 7 * 3600000);
    if (ymdOf_(d) !== s) throw new Error('Tanggal tidak valid: ' + s);
    return d;
  };
  var from = day(a, f.from), to = new Date(day(b, f.to).getTime() + 86400000);
  if (to <= from) throw new Error('Tanggal "sampai" harus sama dengan atau sesudah tanggal "dari".');
  if (to - from > 731 * 86400000) throw new Error('Rentang maksimal 2 tahun.');
  return { from: from, to: to, fromKey: f.from, toKey: f.to };
}

/** Jumlah hari operasi dalam rentang (s/d hari ini). */
function kpiDaysRange_(rg, s, now) {
  var today = ymdOf_(now), n = 0;
  for (var t = rg.from.getTime(); t < rg.to.getTime(); t += 86400000) {
    var key = ymdOf_(new Date(t));
    if (key > today) break;
    var p = key.split('-');
    if ((s.mulai && key < s.mulai) || s.libur[key] || !s.days[new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay()]) continue;
    n++;
  }
  return n;
}

/** Kerusakan (definisi KPI) final di rentang yang lolos filter. Maintenance + Arsip tahun yang tercakup. */
function statsRows_(md, rg, f, names, s) {
  var seen = {}, out = [];
  var add = function (r) {
    var id = String(r['Maintenance ID']), st = r['Status'];
    if (seen[id] || r['Masuk MTTR'] !== APP.MTTR.YES || (st !== APP.STATUS.COMPLETED && st !== APP.STATUS.ABANDONED)) return;
    var d = finalDate_(r);
    if (!d || d < rg.from || d >= rg.to || (s.mulai && ymdOf_(d) < s.mulai) || !matchFilter_(md, r, f, names)) return;
    seen[id] = true;
    out.push(r);
  };
  readTable_(APP.SHEETS.MAINT).forEach(add);
  for (var y = yearOf_(rg.from); y <= yearOf_(new Date(rg.to.getTime() - 1)); y++) {
    if (findSheet_(archiveName_(y))) readTable_(archiveName_(y)).forEach(add);
  }
  return out;
}

/** Pemakaian sparepart per Maintenance ID (hanya untuk "Lihat per sparepart"). */
function statsUsage_(rows, rg) {
  var ids = {}, out = {};
  rows.forEach(function (r) { ids[String(r['Maintenance ID'])] = true; });
  var add = function (u) { var id = String(u['Maintenance ID']); if (ids[id]) (out[id] = out[id] || []).push(u); };
  if (findSheet_(APP.SHEETS.PEMAKAIAN)) readTable_(APP.SHEETS.PEMAKAIAN).forEach(add);
  for (var y = yearOf_(rg.from); y <= yearOf_(new Date(rg.to.getTime() - 1)); y++) {
    if (findSheet_(archiveUsageName_(y))) readTable_(archiveUsageName_(y)).forEach(add);
  }
  return out;
}

/** Kelompok sebuah pekerjaan untuk "Lihat per" (teknisi & sparepart bisa lebih dari satu). @return {Array<{key, label, qty?}>} */
function statsKeys_(by, r, md, names, usage) {
  var base = function (v) { v = String(v || '').trim(); return v.indexOf(APP.OTHER_PREFIX) === 0 ? APP.OTHER : (v || '(kosong)'); };
  var one = function (k, label) { return [{ key: k, label: label || k }]; };
  var d = finalDate_(r);
  switch (by) {
    case 'line': var l = lineOf_(md, r['Line']), id = String(r['Line'] || ''); return one(id, id + (l && l.name ? ' · ' + l.name : ''));
    case 'proses': return one(prosesOfRecord_(md, r) || '(tanpa proses)');
    case 'project': return one(String(r['Baterai'] || '') || '(tanpa project)');
    case 'teknisi':
      return uniq_(String(r['Teknisi terlibat'] || r['Teknisi terakhir'] || '').split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(String))
        .map(function (e) { return { key: e, label: names[e] || e }; });
    case 'jenis': return one(base(r['Jenis kerusakan']));
    case 'discipline': return one(disciplineOf_(md, r['Jenis kerusakan']));
    case 'masalah': return one(base(r['Masalah']));
    case 'sparepart':
      return (usage[String(r['Maintenance ID'])] || []).map(function (u) {
        var k = String(u['Nama Sparepart'] || '') + (u['Model'] ? ' ' + u['Model'] : '');
        return { key: k, label: k, qty: Number(u['Jumlah'] || 0) };
      });
    case 'hari': return one(ymdOf_(d));
    case 'bulan': return one(ymOf_(d), ymLabel_(ymOf_(d)));
  }
  return [];
}

/** Line aktif yang lolos filter Dashboard (pool jam operasi MTBF). */
function statsLinePool_(md, f) {
  return Object.keys(md.lines).filter(function (k) {
    var l = md.lines[k];
    return l.active && (!f.factory || l.factory === normLine_(f.factory)) && (!f.line || k === normLine_(f.line)) &&
      (!f.proses || l.proses === String(f.proses)) && (!f.baterai || l.batteries.indexOf(String(f.baterai)) !== -1);
  });
}

/**
 * @param {{from:string, to:string, by:string, measure:string, factory?, baterai?, proses?, line?, q?}} f
 * @return {{groups:Object[], total:Object, more:number, pareto:boolean, ...}}
 */
function apiStats(f) {
  requireUser_();
  f = f || {};
  var by = STATS_BY_.indexOf(f.by) !== -1 ? f.by : 'line', measure = STATS_MEASURES_.indexOf(f.measure) !== -1 ? f.measure : 'frek';
  if (by === 'sparepart') measure = 'frek';
  if (measure === 'mtbf' && STATS_MTBF_BY_.indexOf(by) === -1) throw new Error('MTBF hanya bisa dilihat per line, proses, atau project.');
  var c = ctx_(), md = c.md, rg = statsRange_(f), s = kpiSettings_();
  var time = by === 'hari' || by === 'bulan';
  if (by === 'hari' && rg.to - rg.from > STATS_DAYS_MAX_ * 86400000) throw new Error('Lihat per hari maksimal 3 bulan. Pilih "Lihat per bulan" untuk rentang yang lebih panjang.');
  var rows = statsRows_(md, rg, f, c.names, s), usage = by === 'sparepart' ? statsUsage_(rows, rg) : {};
  var perLine = kpiDaysRange_(rg, s, c.now) * s.hours, pool = statsLinePool_(md, f);
  var down = function (r) {
    return r['Stop line'] === APP.YES && r['Selesai'] instanceof Date && r['Mulai'] instanceof Date
      ? Math.max(0, r['Selesai'].getTime() - r['Mulai'].getTime()) / 3600000 : 0;
  };
  var groups = {}, total = { n: 0, act: 0, down: 0, lines: {} };
  rows.forEach(function (r) {
    var act = Number(r['Total aktif (menit)'] || 0), dt = down(r), line = normLine_(r['Line']);
    total.n++; total.act += act; total.down += dt; if (line) total.lines[line] = true;
    statsKeys_(by, r, md, c.names, usage).forEach(function (k) {
      var g = groups[k.key] = groups[k.key] || { key: k.key, label: k.label, n: 0, act: 0, down: 0, qty: 0, lines: {} };
      g.n++; g.act += act; g.down += dt; g.qty += k.qty || 0;
      if (line) g.lines[line] = true;
    });
  });
  var count = function (list, g) { var set = {}; list.concat(Object.keys(g.lines)).forEach(function (k) { set[k] = true; }); return Object.keys(set).length; };
  var poolOf = function (g) {
    if (by === 'line') return [g.key];
    if (by === 'proses') return pool.filter(function (k) { return md.lines[k].proses === g.key; });
    return pool.filter(function (k) { return md.lines[k].batteries.indexOf(g.key) !== -1; });
  };
  var shape = function (g, lineN) {
    var jamOp = round2_(perLine * lineN);
    var o = { key: g.key, label: g.label, n: g.n, mttr: g.n ? round2_(g.act / g.n) : null, downtime: round2_(g.down), qty: g.qty };
    if (lineN != null) { o.jamOperasi = jamOp; o.mtbf = g.n && jamOp > 0 ? round2_(Math.max(0, jamOp - g.down) / g.n) : null; }
    o.value = measure === 'frek' ? (by === 'sparepart' ? g.qty : g.n) : (measure === 'mttr' ? o.mttr : (measure === 'downtime' ? o.downtime : o.mtbf));
    return o;
  };
  var mtbfBy = STATS_MTBF_BY_.indexOf(by) !== -1;
  var list = Object.keys(groups).map(function (k) { return shape(groups[k], mtbfBy ? count(poolOf(groups[k]), groups[k]) : null); });
  if (time) {   // kronologis, bulan / hari tanpa kerusakan tetap tampil (0)
    var keys = [];
    if (by === 'hari') for (var t = rg.from.getTime(); t < rg.to.getTime(); t += 86400000) keys.push(ymdOf_(new Date(t)));
    else for (var m = ymOf_(rg.from); m <= ymOf_(new Date(rg.to.getTime() - 1)); m = ymOf_(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 15)))) keys.push(m);
    var byKey = {};
    list.forEach(function (g) { byKey[g.key] = g; });
    list = keys.map(function (k) { return byKey[k] || shape({ key: k, label: by === 'bulan' ? ymLabel_(k) : k, n: 0, act: 0, down: 0, qty: 0, lines: {} }, null); });
  } else {
    list = list.filter(function (g) { return g.value != null; });
    list.sort(measure === 'mtbf' ? function (a, b) { return (a.value - b.value) || (b.n - a.n); }   // MTBF: terburuk dulu
      : function (a, b) { return (b.value - a.value) || (b.n - a.n) || String(a.label).localeCompare(String(b.label)); });
  }
  var pareto = !time && (measure === 'frek' || measure === 'downtime');
  if (pareto) {
    var sum = list.reduce(function (a, g) { return a + g.value; }, 0), run = 0;
    list.forEach(function (g) { run += g.value; g.cum = sum ? Math.round(run / sum * 1000) / 10 : 0; });
  }
  var more = time ? 0 : Math.max(0, list.length - STATS_TOP_);
  return {
    serverNowIso: c.now.toISOString(), from: rg.fromKey, to: rg.toKey, by: by, measure: measure, pareto: pareto,
    groups: time ? list : list.slice(0, STATS_TOP_), more: more,
    total: shape(total, count(pool, total)), hours: s.hours, warn: s.warn
  };
}

/** Daftar pekerjaan satu batang statistik (tap batang → daftar → Detail). */
function apiStatsItems(f, key) {
  requireUser_();
  f = f || {};
  var by = STATS_BY_.indexOf(f.by) !== -1 ? f.by : 'line';
  var c = ctx_(), rg = statsRange_(f), s = kpiSettings_();
  var rows = statsRows_(c.md, rg, f, c.names, s), usage = by === 'sparepart' ? statsUsage_(rows, rg) : {};
  var hit = rows.filter(function (r) { return statsKeys_(by, r, c.md, c.names, usage).some(function (k) { return k.key === String(key); }); });
  hit.sort(function (a, b) { return finalDate_(b) - finalDate_(a); });
  return { serverNowIso: c.now.toISOString(), total: hit.length, items: hit.slice(0, STATS_ITEMS_MAX_).map(function (r) { return serialize_(r, c); }) };
}
