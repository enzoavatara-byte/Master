/**
 * Tab "TPM <project>" = format Excel TPM manager ("Statistical Analysis of Issues Reported from Production"):
 * kotak Status Overview per Discipline di atas, judul kolom di baris 8, data mulai B9, sel teks "中文\n(English)".
 * Isinya pekerjaan TPM_TIPE (Corrective) yang sudah Completed, satu tab per project. Dipakai untuk di-copy ke Excel
 * manager: blok B9 sampai baris terakhir kolom K.
 *
 * Nilai statis, dibangun ulang penuh tiap malam, lewat Dashboard (Perbarui Laporan, Rekap & TPM), lewat menu
 * spreadsheet, dan saat setup. Sengaja tidak di jalur tombol teknisi: teks bebas diterjemahkan dulu.
 * Label 中文 / English pilihan, mesin & line diambil dari sheet (Pilihan, Mesin, Lines); teks bebas lewat translate_
 * (cache + sheet Terjemahan, koreksi admin dipakai). Discipline dari Pilihan → kolom Discipline (Jenis Kerusakan).
 */

var TPM_PREFIX_ = 'TPM ';
var TPM_ROW0_ = 9;        // baris data pertama, sama dengan Excel manager
var TPM_TR_MAX_ = 300;    // teks baru per bahasa per pembangunan; sisanya tetap teks asli, diterjemahkan di pembangunan berikutnya
/** Judul kolom B8:K8, persis Excel manager. */
var TPM_HEAD_ = ['No.序号', 'Machine', 'Issue Description \n问题描述', 'Root Cause\n原因分析', 'Solution\n解决方案\n', 'End Time\n解决时间',
  'Discipline\n范围', 'Responsibility处理人', 'Date', 'Notes'];
var TPM_COLOR_ = { Machine: '#FF0000', Operation: '#FFFF00', 'Product Item': '#92D050', MES: '#00B0F0', head: '#00B050' };
/** Lebar kolom A–K (piksel) = lebar kolom Excel manager. */
var TPM_WIDTH_ = [24, 64, 118, 184, 170, 170, 121, 104, 86, 102, 177];

function tpmName_(bat) { return TPM_PREFIX_ + String(bat).replace(/[\[\]*?\/\\:]/g, '-').slice(0, 90); }

/** Jenis kerusakan → Discipline: sheet Pilihan, lalu bawaan, lalu Machine. */
function disciplineOf_(md, jenis) {
  var j = stripOther_(jenis).trim();
  return (md.discipline || {})[j] || APP.DISCIPLINE_DEFAULTS[j] || APP.TPM_DISCIPLINES[0];
}

/**
 * setup: Jenis Kerusakan baru (Operasional, Produk, MES) ditambahkan jika belum ada (baris Aktif = Tidak dihitung ada),
 * dan sel Discipline yang kosong diisi bawaan. Isi yang sudah ada tidak diubah.
 */
function migrateDiscipline_() {
  var J = 'Jenis Kerusakan';
  var mine = readTable_(APP.SHEETS.OPTIONS).filter(function (r) { return String(r['Jenis']).trim() === J; });
  var have = mine.map(function (r) { return String(r['Nilai']).trim(); });
  var top = mine.reduce(function (m, r) { var u = Number(r['Urutan']); return r['Urutan'] !== '' && isFinite(u) ? Math.max(m, u) : m; }, 0);
  (APP.OPTION_MIGRATE[J] || []).forEach(function (v) {
    if (have.indexOf(v) === -1) appendObj_(APP.SHEETS.OPTIONS, { 'Jenis': J, 'Nilai': v, 'Urutan': ++top, 'Aktif': 'Ya' });
  });
  var sh = sheet_(APP.SHEETS.OPTIONS);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var cj = h.indexOf('Jenis'), cn = h.indexOf('Nilai'), cd = h.indexOf('Discipline');
  if (cd < 0 || vals.length < 2) return;
  var changed = false;
  var col = vals.slice(1).map(function (row) {
    var d = APP.DISCIPLINE_DEFAULTS[String(row[cn]).trim()];
    if (String(row[cd] == null ? '' : row[cd]).trim() || String(row[cj]).trim() !== J || !d) return [row[cd]];
    changed = true;
    return [d];
  });
  if (changed) sh.getRange(2, cd + 1, col.length, 1).setValues(col);
}

/** Config TPM_MULAI → Date 00:00 WIB. Kosong → 1 Januari tahun ini; salah → 1 Januari + peringatan. */
function tpmFrom_() {
  var v = getConfig_('TPM_MULAI'), y = yearOf_(new Date()), jan = parseTanggalWib_('01/01/' + y);
  if (v instanceof Date && !isNaN(v.getTime())) return { date: v };
  var s = String(v == null ? '' : v).trim();
  if (!s) return { date: jan };
  if (/^\d{4}-\d\d-\d\dT/.test(s) && !isNaN(new Date(s).getTime())) return { date: new Date(s) };   // tanggal dari cache master (JSON)
  try { return { date: parseTanggalWib_(s) }; } catch (e) {
    return { date: jan, warn: 'Config TPM_MULAI "' + s + '": ' + e.message + ' Dipakai 1 Januari ' + y + '.' };
  }
}

/** Pekerjaan TPM (TPM_TIPE, Completed, mulai sejak `from`, ada project) dari Maintenance + Arsip, urut waktu mulai; + sparepart. */
function tpmRows_(from) {
  var ss = SpreadsheetApp.getActive(), seen = {}, rows = [], usage = {}, years = [];
  var types = splitList_(getConfig_('TPM_TIPE')).map(function (t) { return t.toLowerCase(); });
  for (var y = yearOf_(from); y < yearOf_(new Date()); y++) years.push(y);
  var add = function (r) {
    var id = String(r['Maintenance ID']);
    if (seen[id] || r['Status'] !== APP.STATUS.COMPLETED || !(r['Mulai'] instanceof Date) || r['Mulai'].getTime() < from.getTime()) return;
    if (types.indexOf(String(r['Tipe'] || '').trim().toLowerCase()) === -1 || !String(r['Baterai'] || '').trim()) return;
    seen[id] = true;
    rows.push(r);
  };
  readTable_(APP.SHEETS.MAINT).forEach(add);
  years.forEach(function (y) { if (ss.getSheetByName(archiveName_(y))) readTable_(archiveName_(y)).forEach(add); });
  rows.sort(function (a, b) { return (a['Mulai'] - b['Mulai']) || String(a['Maintenance ID']).localeCompare(String(b['Maintenance ID'])); });
  var addUsage = function (u) { var id = String(u['Maintenance ID']); if (seen[id]) (usage[id] = usage[id] || []).push(u); };
  if (ss.getSheetByName(APP.SHEETS.PEMAKAIAN)) readTable_(APP.SHEETS.PEMAKAIAN).forEach(addUsage);
  years.forEach(function (y) { if (ss.getSheetByName(archiveUsageName_(y))) readTable_(archiveUsageName_(y)).forEach(addUsage); });
  return { rows: rows, usage: usage };
}

/** Satu potong teks → {s, zh, en}. Label sheet dipakai dulu; yang belum punya label dicatat di `ask` untuk diterjemahkan. */
function tpmPiece_(md, v, ask, label) {
  var raw = String(v == null ? '' : v).trim(), s = stripOther_(raw).trim();
  if (!s) return null;
  var own = label && raw.indexOf(APP.OTHER_PREFIX) !== 0;      // isian "Lainnya: …" = teks bebas
  var p = { s: s, zh: (own && md.tr.zh[s]) || (hasHan_(s) ? s : ''), en: (own && md.tr.en[s]) || '' };
  if (!p.zh) ask.zh[s] = true;
  if (!p.en) ask.en[s] = true;
  return p;
}

/** Catatan tersimpan "[dd/MM HH:mm Nama] teks" per baris (appendStamped_) → teks saja untuk kolom Notes. */
function tpmNote_(v) {
  return String(v == null ? '' : v).split('\n').map(function (l) { return l.replace(/^\[\d\d\/\d\d \d\d:\d\d [^\]]*\]\s*/, '').trim(); })
    .filter(String).join('\n');
}

/** Bahan satu baris TPM (teks masih berupa potongan; diterjemahkan sekaligus untuk semua baris). */
function tpmSpec_(md, r, used, names, ask) {
  var line = lineOf_(md, r['Line']);
  var mesin = stripOther_(r['Nama Mesin']).trim() ? r['Nama Mesin'] : (line ? line.name || line.id : r['Line']);
  var P = function (v, label) { return tpmPiece_(md, v, ask, label); };
  var parts = used.map(function (u) {
    var nama = String(u['Nama Sparepart'] || '').trim(), model = String(u['Model'] || '').trim();
    return nama ? nama + (model ? ' ' + model : '') + ' ×' + (u['Jumlah'] === '' || u['Jumlah'] == null ? 1 : u['Jumlah']) : '';
  }).filter(String).join(', ');
  var legacy = String(r['Part'] || '').trim();   // data 2.1: part berupa teks bebas
  if (!parts && legacy && legacy !== APP.NO_PART && legacy !== 'Tidak ada') parts = legacy.replace(/\n/g, ', ');
  return {
    bat: String(r['Baterai']).trim(),
    machine: [P(mesin, true)],
    issue: [P(r['Masalah'], true), P(r['Detail masalah'])],
    cause: [P(r['Penyebab'], true), P(r['Detail penyebab'])],
    sol: [P(r['Penanganan'], true), P(r['Detail penanganan'])],
    notes: [P(tpmNote_(r['Catatan']))],
    parts: parts,
    end: r['Selesai'] instanceof Date ? r['Selesai'] : '',
    disc: disciplineOf_(md, r['Jenis kerusakan']),
    pic: laporanValue_('PIC', r, 0, [], md, names),
    date: r['Mulai']
  };
}

/** Potongan → "中文\n(English)"; pilihan + detail digabung "：" / ": ". Kedua bahasa sama (mis. MES, kode mesin) → sekali saja. */
function tpmCell_(pieces, zhMap, enMap) {
  var zh = [], en = [];
  pieces.forEach(function (p) {
    if (!p) return;
    zh.push(p.zh || zhMap[p.s] || p.s);
    en.push(p.en || enMap[p.s] || p.s);
  });
  var a = zh.join('：'), b = en.join(': ');
  if (!a && !b) return '';
  return a === b ? a : a + '\n(' + b + ')';
}

/**
 * Baris B–K: No · Machine · Issue · Root Cause · Solution · End Time · Discipline · Responsibility · Date · Notes.
 * Sparepart = satu baris dua bahasa di bawah Solution (nama part tidak diterjemahkan, jadi tidak ditulis dua kali).
 */
function tpmRow_(sp, i, zhMap, enMap) {
  var sol = tpmCell_(sp.sol, zhMap, enMap);
  if (sp.parts) sol += (sol ? '\n' : '') + '备件 Spare parts: ' + sp.parts;
  return [i + 1, tpmCell_(sp.machine, zhMap, enMap), tpmCell_(sp.issue, zhMap, enMap), tpmCell_(sp.cause, zhMap, enMap),
    sol, sp.end, sp.disc, sp.pic, sp.date, tpmCell_(sp.notes, zhMap, enMap)];
}

function tpmTranslate_(texts, lang, stats) {
  var map = {};
  if (!texts.length) return map;
  var res = translate_(texts, lang, { max: TPM_TR_MAX_, stats: stats });
  texts.forEach(function (s, i) { map[s] = res[i]; });
  return map;
}

/**
 * Bangun ulang semua tab TPM: satu per project aktif + project lain yang punya data.
 * Jangan dipanggil di dalam withLock_ (terjemahan baru disimpan ke sheet Terjemahan dengan lock sendiri).
 * @return {{sheets: Array<{sheet:string, rows:number}>, from: Date, untranslated: number, warn: string}}
 */
function buildTpm_() {
  var md = masterData_(), names = userNameMap_(), ss = SpreadsheetApp.getActive();
  var f = tpmFrom_(), data = tpmRows_(f.date), ask = { zh: {}, en: {} };
  var specs = data.rows.map(function (r) { return tpmSpec_(md, r, data.usage[String(r['Maintenance ID'])] || [], names, ask); });
  // Kuota habis / batas per pembangunan → teks tetap asli; diterjemahkan di pembangunan berikutnya (stats.left = jumlahnya).
  var stats = { left: 0 };
  var zhMap = tpmTranslate_(Object.keys(ask.zh), 'zh', stats), enMap = tpmTranslate_(Object.keys(ask.en), 'en', stats);
  var bats = uniq_(md.projects.map(function (p) { return p.battery; }).concat(specs.map(function (sp) { return sp.bat; })));
  var sheets = bats.map(function (bat) {
    var mine = specs.filter(function (sp) { return sp.bat === bat; });
    writeTpmSheet_(ss, bat, mine.map(function (sp, i) { return tpmRow_(sp, i, zhMap, enMap); }), f.date);
    return { sheet: tpmName_(bat), rows: mine.length };
  });
  return { sheets: sheets, from: f.date, untranslated: stats.left, warn: f.warn || '' };
}

/** Satu tab TPM, ditulis ulang penuh: header baris 1–8 seperti Excel manager, data dari B9. */
function writeTpmSheet_(ss, bat, rows, from) {
  var sh = ss.getSheetByName(tpmName_(bat)) || ss.insertSheet(tpmName_(bat));
  var W = 11, n = rows.length, last = TPM_ROW0_ + Math.max(n, 1) - 1;
  if (sh.getMaxRows() < last + 5) sh.insertRowsAfter(sh.getMaxRows(), last + 5 - sh.getMaxRows());
  var all = sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getMaxColumns(), W));
  all.breakApart();
  sh.clear();
  all.clearDataValidations();
  sh.setConditionalFormatRules([]);
  sh.setHiddenGridlines(true);

  var tipe = String(getConfig_('TPM_TIPE')), day = function (d, f) { return Utilities.formatDate(d, APP.TZ, f); };
  var g = [];
  for (var i = 0; i < 8; i++) { g.push([]); for (var j = 0; j < W; j++) g[i].push(''); }
  var put = function (r, c, v) { g[r - 1][c - 1] = v; };   // c: 1 = kolom A
  put(1, 7, 'Status Overview');
  put(2, 2, ' NAME:');
  put(3, 2, String(getConfig_('TPM_PROJECT') || ''));
  put(4, 2, bat);
  put(5, 4, 'Total tasks:');
  APP.TPM_DISCIPLINES.forEach(function (d, k) { put(2 + k, 7, d); put(2 + k, 9, d); });   // I2:I5 = daftar pilihan kolom Discipline
  put(6, 2, String(getConfig_('TPM_JUDUL') || ''));
  put(7, 2, 'Otomatis dari ' + appName_() + ': ' + tipe + ' selesai sejak ' + day(from, 'dd/MM/yyyy') + ', diperbarui ' +
    day(new Date(), 'dd/MM/yyyy HH:mm') + ' WIB. Copy baris ' + TPM_ROW0_ + ' ke bawah. Edit di tab ini tertimpa. · 自动生成，请勿在此修改');
  TPM_HEAD_.forEach(function (h, k) { put(8, 2 + k, h); });
  sh.getRange(1, 1, 8, W).setValues(g);
  sh.getRange(2, 8, 4, 1).setFormulas(APP.TPM_DISCIPLINES.map(function (d) { return [fx_('=COUNTIF(H' + TPM_ROW0_ + ':H,"' + d + '")')]; }));
  sh.getRange(5, 6).setFormula(fx_('=COUNT(B' + TPM_ROW0_ + ':B)'));
  if (n) sh.getRange(TPM_ROW0_, 2, n, 10).setValues(rows);
  else sh.getRange(TPM_ROW0_, 4).setValue('Belum ada pekerjaan ' + tipe + ' selesai sejak ' + day(from, 'dd/MM/yyyy') + '. 暂无记录。');
  styleTpm_(sh, last);
  sh.setTabColor(TEMA_.tab.laporan);
}

function styleTpm_(sh, last) {
  var R0 = TPM_ROW0_, nb = last - R0 + 1, black = '#000000', SOLID = SpreadsheetApp.BorderStyle.SOLID;
  var box = function (rg) { return rg.setBorder(true, true, true, true, true, true, black, SOLID); };
  TPM_WIDTH_.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(8);
  sh.getRange(1, 1, last, 11).setVerticalAlignment('middle').setFontSize(10);
  sh.getRange(1, 7).setFontWeight('bold');
  sh.getRange(2, 2).setFontWeight('bold').setFontSize(8);
  sh.getRange(3, 2, 2, 1).setFontWeight('bold').setFontSize(16);
  sh.getRange(5, 4).setFontWeight('bold').setFontSize(9).setHorizontalAlignment('right');
  sh.getRange(5, 6).setFontSize(12).setHorizontalAlignment('center').setNumberFormat('0');
  APP.TPM_DISCIPLINES.forEach(function (d, k) { sh.getRange(2 + k, 7, 1, 2).setBackground(TPM_COLOR_[d]); });
  sh.getRange(2, 7, 4, 1).setFontWeight('bold');
  box(sh.getRange(2, 7, 4, 2).setHorizontalAlignment('center').setWrap(true));
  sh.getRange(2, 9, 4, 1).setFontSize(11);
  sh.getRange(6, 2, 1, 6).merge().setFontWeight('bold').setFontSize(11);
  sh.getRange(7, 2, 1, 10).merge().setFontSize(9).setFontColor(TEMA_.off);
  sh.getRange(8, 2, 1, 10).setBackground(TPM_COLOR_.head).setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center').setWrap(true);
  sh.setRowHeight(8, 38);
  box(sh.getRange(8, 2, nb + 1, 10));
  sh.getRange(R0, 2, nb, 10).setHorizontalAlignment('center').setWrap(true);
  [4, 5, 11].forEach(function (c) { sh.getRange(R0, c, nb, 1).setHorizontalAlignment('left'); });   // Issue, Root Cause, Notes
  sh.getRange(R0, 7, nb, 1).setNumberFormat('h:mm');
  sh.getRange(R0, 10, nb, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(R0, 8, nb, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange(2, 9, 4, 1), true).setAllowInvalid(true).build());
}

/** Ringkasan hasil untuk pesan menu / log. */
function tpmSummary_(res) {
  var lines = res.sheets.map(function (s) { return '• ' + s.sheet + ': ' + s.rows + ' baris'; });
  return 'Tab TPM diperbarui (' + getConfig_('TPM_TIPE') + ' selesai sejak ' + Utilities.formatDate(res.from, APP.TZ, 'dd/MM/yyyy') + '):\n' +
    (lines.join('\n') || '• (belum ada project di sheet Projects)') +
    (res.warn ? '\n\n⚠ ' + res.warn : '') +
    (res.untranslated ? '\n\n' + res.untranslated + ' teks belum diterjemahkan (batas sekali jalan / kuota Google Translate), tampil teks asli. Jalankan lagi nanti; tiap malam juga otomatis.' : '') +
    '\n\nCara pakai: buka tab TPM <project> → blok sel B' + TPM_ROW0_ + ' sampai baris terakhir kolom K → Copy → paste di Excel manager.' +
    '\nSalah isi → perbaiki di sheet Maintenance (atau label 中文/English di Pilihan / Mesin / Terjemahan), lalu jalankan lagi.';
}

function menuTpm() {
  requireUser_([APP.ROLES.ADMIN]);
  SpreadsheetApp.getUi().alert(tpmSummary_(buildTpm_()));
}
