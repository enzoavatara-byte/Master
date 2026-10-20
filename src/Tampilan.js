/**
 * Tampilan spreadsheet yang mudah dibaca (2.5.1).
 * - Tab "Ringkasan" (rumus: selalu terbaru, tidak memperlambat tombol teknisi) dan "Baca Saya", dua bahasa (Indonesia + 中文).
 * - Gaya tabel: judul berwarna & dibekukan, baris belang, filter, status berwarna, dropdown di sheet pengaturan.
 * - Warna & urutan tab per kelompok; tab yang jarang dipakai disembunyikan (menu → Tampilkan semua tab).
 * Hanya format: isi data, nama kolom, dan urutan kolom tidak diubah.
 * Dipanggil dari setup (penuh), trigger malam (ringan: Ringkasan + baris belang untuk baris baru) dan menu.
 */

var RINGKASAN_ = 'Ringkasan';
var BACA_ = 'Baca Saya';

/** Warna. Pasangan [latar, teks] semuanya ≥ 4,5:1 kontras; baris nonaktif sengaja pudar (3,7:1). */
var TEMA_ = {
  title: '#1F3A5F', head: '#2F4B6E', headText: '#FFFFFF', band: '#F3F6FA', section: '#E8EEF7', input: '#FFF4C2',
  ink: '#202124', muted: '#5F6368', off: '#80868B', late: '#B3261E', chart: '#2A78D6',
  tab: { baca: '#34A853', laporan: '#F4B400', atur: '#4285F4', app: '#9AA0A6', arsip: '#5F6368' },
  status: {
    'Aktif': ['#DCEBFC', '#104281'], 'Pause': ['#ECECEA', '#3D3D3A'], 'Pending': ['#FDEBC0', '#6B4A00'],
    'Completed': ['#D7F0D7', '#0B5A0B'], 'Cancelled': ['#F2F2F0', '#5F5F5A'], 'Abandoned': ['#F8DADA', '#8F1F1F']
  },
  review: ['#FDE2CC', '#7A3A0B']
};
var STATUS_ZH_ = { 'Aktif': '进行中', 'Pause': '暂停', 'Pending': '挂起', 'Completed': '已完成', 'Cancelled': '已取消', 'Abandoned': '已放弃' };
/** Kolom "Kondisi perbaikan" di Laporan (APP.STATUS_LABEL) → warna status. */
var KONDISI_WARNA_ = { 'Dikerjakan': 'Aktif', 'Pause': 'Pause', 'Pending': 'Pending', 'Selesai': 'Completed', 'Cancel': 'Cancelled', 'Abandoned': 'Abandoned' };
var SARAN_WARNA_ = { 'Baru': 'Aktif', 'Dibaca': 'Pause', 'Direncanakan': 'Pending', 'Selesai': 'Completed', 'Ditolak': 'Cancelled' };
var DATE_FMT_ = 'dd/mm/yyyy hh:mm';

// ---------- rumus & locale ----------
/*
 * Semua rumus di kode ditulis dengan sintaks en_US: argumen "," · array kolom "," baris ";" · desimal ".".
 * Spreadsheet ber-locale desimal koma (mis. Indonesia in_ID) membaca rumus dengan argumen ";", array kolom "\",
 * desimal "," — di sana "{1,2}" diam-diam berarti angka 1,2 dan "IF(A,B,C)" error. Diuji di Google Sheets asli.
 * fxMode_ menguji sekali per eksekusi apakah spreadsheet ini menerima sintaks en_US; jika tidak, fx_ mengonversi.
 */
var FX_MODE_ = null;
function fxMode_() {
  if (FX_MODE_) return FX_MODE_;
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(RINGKASAN_) || ss.insertSheet(RINGKASAN_, 0);
  var cell = sh.getRange(5, 11);   // K5: kolom bantu Ringkasan (disembunyikan)
  var hasil12 = function (f) {     // 12 hanya jika array 2 kolom DAN IF 3 argumen terbaca benar
    try { cell.setFormula(f); SpreadsheetApp.flush(); return cell.getValue() === 12; } catch (e) { return false; }
  };
  try {
    if (hasil12('=COLUMNS({1,2})+IF(TRUE,10,0)')) FX_MODE_ = 'en';
    else if (hasil12('=COLUMNS({1\\2})+IF(TRUE;10;0)')) FX_MODE_ = 'koma';
    else FX_MODE_ = 'en';
  } finally {
    cell.clearContent();
  }
  return FX_MODE_;
}

/** Rumus sintaks en_US → sintaks spreadsheet ini. Teks "…" dan nama sheet '…' tidak diubah. */
function fx_(f) {
  if (fxMode_() === 'en') return f;
  return fxKoma_(f);
}
function fxKoma_(f) {
  var out = '', stack = [], q = false, sq = false;   // q = teks "…", sq = nama sheet '…'
  for (var i = 0; i < f.length; i++) {
    var ch = f.charAt(i);
    if (ch === '"' && !sq) q = !q;
    else if (ch === "'" && !q) sq = !sq;
    else if (!q && !sq) {
      if (ch === '(' || ch === '{') stack.push(ch);
      else if (ch === ')' || ch === '}') stack.pop();
      else if (ch === ',') { out += stack[stack.length - 1] === '{' ? '\\' : ';'; continue; }
      else if (ch === '.' && /\d/.test(f.charAt(i - 1)) && /\d/.test(f.charAt(i + 1)) && !/[A-Za-z!]/.test(f.charAt(i - 2))) { out += ','; continue; }
    }
    out += ch;
  }
  return out;
}

// ---------- pintu masuk ----------

/**
 * @param {{full?:boolean}} opts full = setup / menu (urutan tab, sembunyikan, lebar kolom, filter, dropdown);
 *   tanpa full = trigger malam (Ringkasan dibangun ulang, baris belang & warna diperluas ke baris baru).
 * @return {string[]} masalah yang dilewati (format gagal tidak boleh menggagalkan setup / trigger)
 */
function rapikanTampilan_(opts) {
  opts = opts || {};
  var ss = SpreadsheetApp.getActive(), problems = [];
  var safe = function (label, fn) { try { fn(); } catch (e) { problems.push(label + ': ' + (e && e.message || e)); console.warn('Tampilan ' + label + ': ' + e); } };
  var specs = tableSpecs_();
  Object.keys(specs).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) safe(name, function () { styleTable_(sh, specs[name], opts.full); });
  });
  safe(APP.SHEETS.PENDING, function () { stylePendingWork_(ss, opts.full); });
  safe(RINGKASAN_, function () { buildRingkasan_(ss); });
  if (opts.full) {
    safe(BACA_, function () { buildBacaSaya_(ss); });
    safe('tab', function () { applyTabs_(ss, true); });
  } else {
    safe('tab', function () { applyTabs_(ss, false); });
  }
  return problems;
}

function menuRapikanTampilan() {
  requireUser_([APP.ROLES.ADMIN]);
  var p = rapikanTampilan_({ full: true });
  SpreadsheetApp.getUi().alert(p.length ? 'Selesai, kecuali:\n' + p.join('\n') : 'Tampilan spreadsheet sudah dirapikan.\n\nTab yang jarang dipakai disembunyikan; buka lewat menu → Tampilkan semua tab.');
}

function menuTampilkanSemuaTab() {
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) { if (sh.isSheetHidden()) sh.showSheet(); });
}

// ---------- tab: warna, urutan, sembunyikan ----------

/** @return {Array<[string,string,boolean]>} [nama tab, kelompok warna, disembunyikan], urutan = urutan tampil */
function tabPlan_(ss) {
  var S = APP.SHEETS, y = yearOf_(new Date()), plan = [], seen = {};
  var add = function (name, grp, hide) { if (!seen[name] && ss.getSheetByName(name)) { seen[name] = true; plan.push([name, grp, !!hide]); } };
  add(RINGKASAN_, 'baca'); add(BACA_, 'baca');
  add(laporanName_(y), 'laporan'); add(rekapName_(y), 'laporan'); add(S.PENDING, 'laporan'); add(S.SARAN, 'laporan');
  add(S.MAINT, 'app'); add(S.PEMAKAIAN, 'app');
  [S.USERS, S.LINES, S.MESIN, S.SPAREPART, S.OPTIONS].forEach(function (n) { add(n, 'atur'); });
  [S.PROJECTS, S.FACTORY, S.FORM, S.FORMAT, S.PANDUAN, S.CONFIG, S.RENCANA].forEach(function (n) { add(n, 'atur', true); });
  add(S.LOG, 'app', true); add(S.TERJEMAHAN, 'app', true);
  var rest = ss.getSheets().map(function (sh) { return sh.getName(); }).filter(function (n) { return !seen[n]; });
  rest.filter(function (n) { return /^(Laporan|Rekap) \d{4}$/.test(n); }).sort().reverse().forEach(function (n) { add(n, 'laporan', true); });
  rest.filter(function (n) { return n.indexOf(S.MAINT + ' ') === 0; }).forEach(function (n) { add(n, 'app', true); });
  rest.filter(function (n) { return /^Arsip( Log| Sparepart)? \d{4}$/.test(n); }).sort().reverse().forEach(function (n) { add(n, 'arsip', true); });
  return plan;   // tab buatan admin sendiri tidak disentuh (tetap di belakang, tetap terlihat)
}

/** order = setup / menu: urutkan & sembunyikan. Tanpa order (trigger malam) hanya warna tab. */
function applyTabs_(ss, order) {
  var plan = tabPlan_(ss);
  plan.forEach(function (p) { ss.getSheetByName(p[0]).setTabColor(TEMA_.tab[p[1]]); });
  if (!order) return;
  plan.forEach(function (p, i) {
    var sh = ss.getSheetByName(p[0]);
    if (sh.getIndex() !== i + 1) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
  });
  // Tampilkan dulu yang harus terlihat, aktifkan Ringkasan, baru sembunyikan (tab aktif tidak bisa disembunyikan).
  plan.forEach(function (p) { var sh = ss.getSheetByName(p[0]); if (!p[2] && sh.isSheetHidden()) sh.showSheet(); });
  ss.setActiveSheet(ss.getSheetByName(plan[0][0]));
  plan.forEach(function (p) { var sh = ss.getSheetByName(p[0]); if (p[2] && !sh.isSheetHidden()) sh.hideSheet(); });
}

// ---------- tabel ----------

function tableSpecs_() {
  var S = APP.SHEETS, YT = [APP.YES, APP.NO], spec = {};
  var mins = ['Total aktif (menit)', 'Total pause (menit)', 'Total pending (menit)'];
  spec[S.MAINT] = {
    filter: true, clip: true, freezeCols: 2, status: 'Status', late: ['Tenggat', 'Status'], ints: mins,
    // email & cap waktu sistem: dipakai kode, jarang dibaca orang (Nama PIC / Nama teknisi tetap terlihat)
    hide: ['Teknisi awal', 'Teknisi terakhir', 'Teknisi terlibat', 'Direview oleh', 'Status sejak', 'Konfirmasi terakhir', 'Peringatan pada', 'Mesin ID'],
    wide: { 'Maintenance ID': 150, 'Line': 70, 'Baterai': 80, 'Status': 105, 'Mulai': 125, 'Selesai': 125, 'Tenggat': 125, 'Nama Mesin': 140, 'Nama PIC': 140 },
    text: { 'Masuk MTTR': { 'Tidak': [null, TEMA_.off], 'Menunggu': TEMA_.status.Pending }, 'Status review': { 'Perlu review': TEMA_.review } }
  };
  spec[S.PEMAKAIAN] = { filter: true, clip: true, hide: ['Email PIC'], wide: { 'Tanggal': 125, 'Maintenance ID': 150, 'Nama Sparepart': 160, 'Model': 140 } };
  spec[S.LOG] = { filter: true, clip: true, wide: { 'Timestamp': 125, 'Maintenance ID': 150, 'User': 190, 'Detail': 520 } };
  spec[S.SARAN] = {
    filter: true, wrap: ['Isi', 'Terjemahan', 'Tanggapan'], hide: ['ID', 'Email'], wide: { 'Tanggal': 125, 'Ditanggapi pada': 125 },
    status: 'Status', statusMap: SARAN_WARNA_, dropdowns: { 'Status': APP.SARAN_STATUS, 'Kategori': APP.SARAN_KATEGORI }
  };
  spec[S.TERJEMAHAN] = { filter: true, wrap: ['Teks', 'id', 'zh', 'en'], wide: { 'Diperbarui': 125 } };
  spec[S.USERS] = { off: 'Aktif', wide: { 'Email': 230, 'Nama': 180 }, dropdowns: { 'Peran': [APP.ROLES.TECH, APP.ROLES.ADMIN], 'Aktif': YT, 'Bahasa': ['id', 'zh'] } };
  [S.FACTORY, S.PROJECTS, S.FORMAT].forEach(function (n) { spec[n] = { off: 'Aktif', dropdowns: { 'Aktif': YT } }; });
  [S.LINES, S.MESIN, S.SPAREPART, S.OPTIONS].forEach(function (n) { spec[n] = { filter: true, off: 'Aktif', dropdowns: { 'Aktif': YT } }; });
  spec[S.FORM] = { filter: true, off: 'Aktif', wide: { 'Label': 230, 'Label (中文)': 160 },
    dropdowns: { 'Tipe': ['pilihan', 'teks', 'angka', 'sistem'], 'Wajib': YT, 'Lainnya isi sendiri': YT, 'Aktif': YT } };
  spec[S.PANDUAN] = { off: 'Aktif', wrap: ['Isi'], dropdowns: { 'Untuk': ['Teknisi', 'Admin', 'Semua'], 'Aktif': YT } };
  spec[S.RENCANA] = { off: 'Aktif', wrap: ['Isi'], dropdowns: { 'Aktif': YT } };
  spec[S.CONFIG] = { wrap: ['Keterangan'], wide: { 'Key': 190, 'Value': 200, 'Keterangan': 420 } };
  return spec;
}

/**
 * Gaya satu tabel (judul di baris 1). full = juga lebar kolom, filter, dropdown, kolom tersembunyi.
 * Tanpa full: hanya diperluas jika baris sheet bertambah (baris baru ikut belang & berwarna).
 */
function styleTable_(sh, o, full) {
  var h = headers_(sh), w = h.length;
  if (!w) return;
  var max = Math.max(sh.getMaxRows(), 2), bands = sh.getBandings();
  if (!full && bands.length && bands[0].getRange().getLastRow() >= max) return;   // malam: belum ada baris baru
  var col = function (name) { return h.indexOf(name) + 1; };
  var body = function (c) { return sh.getRange(2, c, max - 1, 1); };

  bands.forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, max, w).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(TEMA_.head).setFirstRowColor('#FFFFFF').setSecondRowColor(TEMA_.band);
  sh.setConditionalFormatRules(foreignRules_(sh).concat(tableRules_(sh, h, o, max)));
  if (!full) return;

  sh.getRange(1, 1, 1, w).setFontColor(TEMA_.headText).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  if (o.freezeCols) sh.setFrozenColumns(o.freezeCols);
  var wrap = o.wrap || [];
  sh.getRange(2, 1, max - 1, w).setVerticalAlignment('top')
    .setWrapStrategy(o.clip ? SpreadsheetApp.WrapStrategy.CLIP : SpreadsheetApp.WrapStrategy.OVERFLOW);
  h.forEach(function (name, i) {
    var wd = (o.wide && o.wide[name]) || (wrap.indexOf(name) !== -1 ? 280 : Math.max(80, Math.min(200, name.length * 8 + 28)));
    sh.setColumnWidth(i + 1, wd);
    if (wrap.indexOf(name) !== -1) body(i + 1).setWrap(true);
  });
  (APP.DATE_COLUMNS[sh.getName()] || []).forEach(function (n) { if (col(n)) body(col(n)).setNumberFormat(DATE_FMT_); });
  (o.ints || []).forEach(function (n) { if (col(n)) body(col(n)).setNumberFormat('0'); });
  Object.keys(o.dropdowns || {}).forEach(function (n) {
    if (!col(n)) return;
    body(col(n)).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(o.dropdowns[n], true).setAllowInvalid(true).build());
  });
  (o.hide || []).forEach(function (n) { if (col(n)) sh.hideColumns(col(n)); });
  if (o.filter) {
    var f = sh.getFilter();
    if (f) f.remove();
    sh.getRange(1, 1, max, w).createFilter();
  }
}

/** Aturan warna otomatis untuk satu tabel: status, teks khusus, tenggat lewat (merah), baris nonaktif (pudar). */
function tableRules_(sh, h, o, max) {
  var rules = [], rule = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  var rng = function (c) { return sh.getRange(2, c, max - 1, 1); };
  var addText = function (c, map) {
    Object.keys(map).forEach(function (v) {
      var pair = map[v], r = rule().whenTextEqualTo(v).setRanges([rng(c)]);
      if (pair[0]) r.setBackground(pair[0]);
      if (pair[1]) r.setFontColor(pair[1]);
      rules.push(r.build());
    });
  };
  var sc = h.indexOf(o.status) + 1;
  if (o.status && sc) {
    var m = {};
    if (o.statusMap) Object.keys(o.statusMap).forEach(function (v) { m[v] = TEMA_.status[o.statusMap[v]]; });
    else Object.keys(TEMA_.status).forEach(function (v) { m[v] = TEMA_.status[v]; });
    addText(sc, m);
  }
  Object.keys(o.text || {}).forEach(function (n) { var c = h.indexOf(n) + 1; if (c) addText(c, o.text[n]); });
  if (o.late) {
    var dc = h.indexOf(o.late[0]) + 1, stc = h.indexOf(o.late[1]) + 1;
    if (dc && stc) {
      var d = '$' + colLetter_(dc) + '2', s = '$' + colLetter_(stc) + '2';
      rules.push(rule().whenFormulaSatisfied(fx_('=AND(' + s + '="' + APP.STATUS.PENDING + '",ISNUMBER(' + d + '),' + d + '<NOW())'))
        .setFontColor(TEMA_.late).setBold(true).setRanges([rng(dc)]).build());
    }
  }
  var oc = h.indexOf(o.off) + 1;
  if (o.off && oc) {
    rules.push(rule().whenFormulaSatisfied(fx_('=$' + colLetter_(oc) + '2="' + APP.NO + '"')).setFontColor(TEMA_.off)
      .setRanges([sh.getRange(2, 1, max - 1, h.length)]).build());
  }
  return rules;
}

/** Aturan warna buatan admin sendiri dipertahankan; aturan buatan aplikasi (warna TEMA_) diganti. */
function foreignRules_(sh) {
  var mine = {};
  var mark = function (c) { if (c) mine[String(c).toUpperCase()] = true; };
  Object.keys(TEMA_.status).forEach(function (k) { mark(TEMA_.status[k][0]); mark(TEMA_.status[k][1]); });
  [TEMA_.review[0], TEMA_.review[1], TEMA_.off, TEMA_.late].forEach(mark);
  return sh.getConditionalFormatRules().filter(function (r) {
    try {
      var b = r.getBooleanCondition();
      if (!b) return true;
      return !(mine[String(b.getBackground() || '').toUpperCase()] || mine[String(b.getFontColor() || '').toUpperCase()]);
    } catch (e) { return true; }
  });
}

/** Tab "Pending Work" (rumus): judul berwarna, belang, tenggat lewat merah. */
function stylePendingWork_(ss, full) {
  var sh = ss.getSheetByName(APP.SHEETS.PENDING);
  if (!sh) return;
  var w = 7, max = Math.max(sh.getMaxRows(), 2);
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, max, w).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(TEMA_.head).setFirstRowColor('#FFFFFF').setSecondRowColor(TEMA_.band);
  sh.setConditionalFormatRules(foreignRules_(sh).concat([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(fx_('=AND(ISNUMBER($E2),$E2<NOW())')).setFontColor(TEMA_.late).setBold(true).setRanges([sh.getRange(2, 5, max - 1, 1)]).build()]));
  if (!full) return;
  sh.getRange(1, 1, 1, w).setFontColor(TEMA_.headText).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 36);
  [150, 70, 80, 220, 125, 150, 110].forEach(function (wd, i) { sh.setColumnWidth(i + 1, wd); });
  sh.getRange(2, 5, max - 1, 1).setNumberFormat(DATE_FMT_);
  sh.getRange(2, 7, max - 1, 1).setNumberFormat('0.0');
}

/** Laporan <tahun> (dipanggil buildLaporan_): judul, header, belang, kolom Kondisi berwarna. Kolom tidak diubah. */
function styleLaporan_(sh, cols, fmtRows) {
  var w = Math.max(1, cols.length), last = fmtRows + 1;
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, 1, w).setBackground(TEMA_.title).setFontColor(TEMA_.headText).setFontSize(14).setVerticalAlignment('middle');
  sh.setRowHeight(1, 34);
  sh.getRange(2, 1, 1, w).setFontColor(TEMA_.headText).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.getRange(2, 1, last - 1, w).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(TEMA_.head).setFirstRowColor('#FFFFFF').setSecondRowColor(TEMA_.band);
  if (last > 2) sh.getRange(3, 1, last - 2, w).setVerticalAlignment('top');
  var rules = [];
  cols.forEach(function (c, j) {
    if (c.sumber !== 'Kondisi perbaikan' || last <= 2) return;
    Object.keys(KONDISI_WARNA_).forEach(function (v) {
      var p = TEMA_.status[KONDISI_WARNA_[v]];
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(v).setBackground(p[0]).setFontColor(p[1])
        .setRanges([sh.getRange(3, j + 1, last - 2, 1)]).build());
    });
  });
  sh.setConditionalFormatRules(rules);
  sh.setTabColor(TEMA_.tab.laporan);
}

/** Rekap <tahun> (dipanggil buildRekap_): judul, catatan, header, belang bulan, baris total menonjol. */
function styleRekap_(sh, nRows, w) {
  // Tanpa merge: sinkron per aksi menulis ulang baris 1–2 (judul & catatan meluber ke sel kosong di kanannya).
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, 1, w).setBackground(TEMA_.title).setFontColor(TEMA_.headText).setFontSize(14).setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(1, 34);
  sh.getRange(2, 1, 1, w).setFontColor(TEMA_.muted).setWrap(false);
  sh.getRange(4, 1, nRows - 4, w).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(TEMA_.head).setFirstRowColor('#FFFFFF').setSecondRowColor(TEMA_.band);
  sh.getRange(4, 1, 1, w).setFontColor(TEMA_.headText).setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(4, 48);
  sh.getRange(nRows, 1, 1, w).setBackground(TEMA_.section).setFontColor(TEMA_.title).setFontWeight('bold')
    .setBorder(true, null, null, null, null, null, TEMA_.head, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setColumnWidth(1, 120);
  for (var c = 2; c <= w; c++) sh.setColumnWidth(c, 115);
  sh.setTabColor(TEMA_.tab.laporan);
}

// ---------- Ringkasan ----------

/**
 * Tab Ringkasan: semua angka berupa rumus ke sheet Maintenance, jadi selalu terbaru tanpa menambah kerja tombol teknisi.
 * Daftar baterai & jenis kerusakan ditulis saat dibangun (setup / malam / menu). Tanggal pilihan pembaca (C4) dipertahankan.
 */
function buildRingkasan_(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var md = masterData_();
  var sh = ss.getSheetByName(RINGKASAN_) || ss.insertSheet(RINGKASAN_, 0);
  var pick = sh.getLastRow() >= 4 ? sh.getRange(4, 3).getValue() : '';
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  var area = sh.getRange(1, 1, Math.max(sh.getMaxRows(), 120), Math.max(sh.getMaxColumns(), 16));
  area.breakApart().clearDataValidations();
  sh.clear();
  sh.setConditionalFormatRules([]);
  sh.showColumns(1, sh.getMaxColumns());
  sh.setHiddenGridlines(true);

  // ---- rentang kolom Maintenance ----
  var mh = headers_(ss.getSheetByName(APP.SHEETS.MAINT));
  var R = function (name) {
    var i = mh.indexOf(name);
    if (i < 0) throw new Error('Kolom "' + name + '" tidak ada di Maintenance. Jalankan setup.');
    var L = colLetter_(i + 1);
    return "'" + APP.SHEETS.MAINT + "'!" + L + '2:' + L;
  };
  var ST = R('Status'), MU = R('Mulai'), SE = R('Selesai'), SJ = R('Status sejak'), AK = R('Total aktif (menit)'), MM = R('Masuk MTTR');
  var TI = R('Tipe'), BA = R('Baterai'), JE = R('Jenis kerusakan'), SL = R('Stop line'), TG = R('Tenggat'), RV = R('Status review');
  var LI = R('Line'), NM = R('Nama Mesin'), PIC = R('Nama PIC'), TT = R('Yang tertunda');
  // Sel bantu (kolom K, disembunyikan): K1 tanggal tampil, K2 awal bulan, K3 awal bulan berikutnya.
  var D = '$K$1', B0 = '$K$2', B1 = '$K$3';
  var between = function (rng, a, b) { return rng + ',">="&' + a + ',' + rng + ',"<"&' + b; };
  // Tanggal final seperti Rekap: Selesai (Completed) atau Status sejak (Cancelled / Abandoned).
  var FIN = 'IF((' + ST + '="' + APP.STATUS.COMPLETED + '")*ISNUMBER(' + SE + '),' + SE + ',' + SJ + ')';
  var mttr = function (a, b, extra) {
    return '=IFERROR(ROUND(AVERAGE(FILTER(' + AK + ',' + MM + '="' + APP.MTTR.YES + '"' + (extra || '') + ',' + FIN + '>=' + a + ',' + FIN + '<' + b + ')),0),"–")';
  };
  var done = function (a, b, extra) { return 'COUNTIFS(' + ST + ',"' + APP.STATUS.COMPLETED + '",' + between(SE, a, b) + (extra || '') + ')'; };
  var D1 = '(' + D + '+1)';

  // ---- isi grid (satu tulisan setValues) ----
  var W = 11, g = [];
  var row = function (r) { while (g.length < r) { var x = []; for (var i = 0; i < W; i++) x.push(''); g.push(x); } return g[r - 1]; };
  var put = function (r, c, v) { row(r)[c - 1] = v; };
  var fmt = [];   // [a1/range builder, fn] dijalankan setelah nilai ditulis
  var cols = 'ABCDEFGHIJK';
  var A = function (r, c, r2, c2) { return cols[c - 1] + r + (r2 ? ':' + cols[(c2 || c) - 1] + r2 : ''); };

  put(1, 2, '📊 RINGKASAN MAINTENANCE · 维修总览 — ' + appName_());
  put(2, 2, 'Angka di tab ini dihitung otomatis dari tab Maintenance (selalu terbaru). Yang boleh diubah hanya sel kuning.  ·  本页数据自动计算，只可修改黄色单元格。');
  put(4, 2, 'Pilih tanggal 选择日期');
  put(4, 3, pick instanceof Date ? pick : '');
  put(4, 4, '← kosong = hari ini · 空白 = 今天');
  put(4, 7, 'Ditampilkan 显示:');
  put(4, 8, '=' + D);
  put(1, 11, '=IF(ISNUMBER($C$4),INT($C$4),TODAY())');
  put(2, 11, '=DATE(YEAR(' + D + '),MONTH(' + D + '),1)');
  put(3, 11, '=EDATE(' + B0 + ',1)');

  var r = 6;
  var section = function (text) { put(r, 2, text); fmt.push(['section', r]); r++; };
  var kpis = function (items) {   // 4 kotak, masing-masing 2 kolom
    items.forEach(function (it, i) { put(r, 2 + i * 2, it[0]); put(r + 1, 2 + i * 2, it[1]); });
    fmt.push(['kpi', r, items.length]);
    r += 3;
  };
  section('HARI INI 今天  ·  tanggal yang dipilih');
  kpis([
    ['Dimulai 开始', '=COUNTIFS(' + between(MU, D, D1) + ')'],
    ['Selesai 完成', '=' + done(D, D1)],
    ['MTTR (menit) 平均修复时间', mttr(D, D1)],
    ['Stop line 停线', '=COUNTIFS(' + SL + ',"' + APP.YES + '",' + between(MU, D, D1) + ')']
  ]);
  var nowRow = r + 1;
  section('SEKARANG 现在  ·  saat ini, tidak tergantung tanggal');
  kpis([
    ['Sedang dikerjakan 进行中', '=COUNTIF(' + ST + ',"' + APP.STATUS.ACTIVE + '")+COUNTIF(' + ST + ',"' + APP.STATUS.PAUSE + '")'],
    ['Pending 挂起', '=COUNTIF(' + ST + ',"' + APP.STATUS.PENDING + '")'],
    ['Lewat tenggat 已逾期', '=COUNTIFS(' + ST + ',"' + APP.STATUS.PENDING + '",' + TG + ',"<"&NOW())'],
    ['Perlu review 待审核', '=COUNTIF(' + RV + ',"' + APP.REVIEW.NEEDED + '")']
  ]);
  section('="BULAN 本月  ·  "&TEXT(' + B0 + ',"mmmm yyyy")');
  var types = mttrTypes_();
  var corr = types.map(function (t) { return done(B0, B1, ',' + TI + ',"' + t + '"'); }).concat([done(B0, B1, ',' + TI + ',""')]).join('+');
  var isDefault = types.length === 1 && types[0] === 'corrective';
  kpis([
    ['Selesai 完成', '=' + done(B0, B1)],
    ['MTTR (menit) 平均修复时间', mttr(B0, B1)],
    [isDefault ? 'Corrective 故障维修' : 'Masuk MTTR (' + types.join(', ') + ')', '=' + corr],
    [isDefault ? 'Preventive 预防性维护' : 'Tipe lain 其他类型', '=' + done(B0, B1) + '-(' + corr + ')']
  ]);

  // status pekerjaan yang dimulai bulan ini (kotak berwarna = arti warna di semua tab)
  put(r, 2, 'Status pekerjaan yang dimulai bulan ini  ·  本月开始的工作状态'); fmt.push(['sub', r]); r++;
  var statuses = Object.keys(TEMA_.status), stRow = r;
  statuses.forEach(function (s, i) {
    put(r, 2 + i, s + '\n' + STATUS_ZH_[s]);
    put(r + 1, 2 + i, '=COUNTIFS(' + ST + ',"' + s + '",' + between(MU, B0, B1) + ')');
  });
  fmt.push(['status', stRow]);
  r += 3;
  var dailyRow = r;   // grafik "selesai per hari" (±11 baris)
  r += 13;

  // per project
  put(r, 2, 'Per project bulan ini  ·  本月各项目'); fmt.push(['sub', r]); r++;
  ['Baterai 电池项目', 'Selesai 完成', 'MTTR (menit) 平均修复时间', 'Target 目标', 'Hasil 结果'].forEach(function (t, i) { put(r, 2 + i, t); });
  var pHead = r; r++;
  var seenBat = {}, projects = md.projects.filter(function (p) { if (seenBat[p.battery]) return false; seenBat[p.battery] = true; return true; });
  projects.forEach(function (p) {
    var q = '"' + String(p.battery).replace(/"/g, '""') + '"';
    put(r, 2, p.battery);
    put(r, 3, '=' + done(B0, B1, ',' + BA + ',' + q));
    put(r, 4, mttr(B0, B1, ',' + BA + '=' + q));
    put(r, 5, p.target == null ? '' : p.target);
    put(r, 6, '=IF(OR(NOT(ISNUMBER(D' + r + ')),NOT(ISNUMBER(E' + r + '))),"",IF(D' + r + '<=E' + r + ',"✓ Sesuai target 达标","▲ Di atas target 超标"))');
    r++;
  });
  if (!projects.length) { put(r, 2, '(belum ada project di sheet Projects)'); r++; }
  fmt.push(['table', pHead, r - 1, 5]);
  r++;

  // jenis kerusakan (selesai bulan ini), urut terbanyak → grafik batang
  put(r, 2, 'Jenis kerusakan (selesai bulan ini)  ·  本月已完成的故障类型'); fmt.push(['sub', r]); r++;
  put(r, 2, 'Jenis 类型'); put(r, 3, 'Jumlah 数量');
  var jHead = r; r++;
  var jenis = (md.options['Jenis Kerusakan'] || []);
  var label = function (v) { var zh = md.tr.zh[v]; return zh ? v + ' ' + zh : v; };
  if (jenis.length) {
    put(r, 2, '=SORT({' + jenis.map(function (v) {
      return '"' + label(v).replace(/"/g, '""') + '",' + done(B0, B1, ',' + JE + ',"' + v.replace(/"/g, '""') + '"');
    }).join(';') + '},2,FALSE)');
  }
  var jLast = jHead + Math.max(1, jenis.length);
  r = jLast + 1;
  fmt.push(['table', jHead, jLast, 2]);
  var chartRow = jHead;   // grafik di kanan tabel jenis (kolom E)
  r = Math.max(r, chartRow + 15) + 1;

  // 5 mesin paling sering bermasalah bulan ini (tanpa cancel)
  put(r, 2, '5 mesin paling sering bermasalah bulan ini  ·  本月故障最多的 5 台设备'); fmt.push(['sub', r]); r++;
  put(r, 2, 'Line 产线'); put(r, 3, 'Mesin 设备'); put(r, 4, 'Jumlah 数量');
  var tHead = r; r++;
  var qd = function (x) { return 'date \'"&YEAR(' + x + ')&"-"&TEXT(MONTH(' + x + '),"00")&"-"&TEXT(DAY(' + x + '),"00")&"\''; };
  put(r, 2, '=IFERROR(QUERY({' + LI + ',' + NM + ',' + MU + ',' + ST + '},"select Col1, Col2, count(Col3) where Col3 >= ' + qd(B0) +
    ' and Col3 < ' + qd(B1) + ' and Col4 <> \'' + APP.STATUS.CANCELLED + '\' and Col2 <> \'\' group by Col1, Col2 order by count(Col3) desc limit 5 label Col1 \'\', Col2 \'\', count(Col3) \'\'",0),"–")');
  r += 5;
  fmt.push(['table', tHead, r - 1, 3]);
  r++;

  // masih terbuka sekarang (rumus FILTER memanjang ke bawah: selalu paling bawah)
  put(r, 2, 'Masih terbuka (sekarang)  ·  未完成的工作（现在）'); fmt.push(['sub', r]); r++;
  ['Line 产线', 'Mesin 设备', 'Status 状态', 'Teknisi 技术员', 'Mulai 开始', 'Tenggat 期限', 'Yang tertunda 待处理'].forEach(function (t, i) { put(r, 2 + i, t); });
  var oHead = r; r++;
  put(r, 2, '=IFERROR(SORT(FILTER({' + [LI, NM, ST, PIC, MU, TG, TT].join(',') + '},(' + ST + '="' + APP.STATUS.ACTIVE + '")+(' + ST + '="' +
    APP.STATUS.PAUSE + '")+(' + ST + '="' + APP.STATUS.PENDING + '")),3,TRUE,5,TRUE),"Tidak ada · 无")');

  // grafik "selesai per hari bulan ini": data bantu di kolom M:N (disembunyikan)
  var days = [['Tanggal', 'Selesai 完成']];
  for (var dd = 1; dd <= 31; dd++) {
    var day = '(' + B0 + '+' + (dd - 1) + ')';
    days.push(['=IF(MONTH(' + day + ')=MONTH(' + B0 + '),"' + dd + '","")', '=IF(MONTH(' + day + ')=MONTH(' + B0 + '),' + done(day, '(' + day + '+1)') + ',"")']);
  }

  writeGrid_(sh, g, 1, 1);
  sh.getRange(1, 13, 1, 2).setValues([days[0]]);
  sh.getRange(2, 13, days.length - 1, 2).setFormulas(days.slice(1).map(function (r) { return r.map(fx_); }));   // blok rumus utuh: satu panggilan

  // ---- format ----
  sh.setColumnWidth(1, 18);
  for (var c = 2; c <= 9; c++) sh.setColumnWidth(c, 128);
  sh.setColumnWidth(10, 18);
  sh.hideColumns(11, 4);   // K:N = sel bantu
  sh.getRange(1, 2, g.length + 40, 8).setFontColor(TEMA_.ink).setVerticalAlignment('middle');
  sh.getRange('B1:I1').merge().setBackground(TEMA_.title).setFontColor(TEMA_.headText).setFontSize(18).setFontWeight('bold');
  sh.setRowHeight(1, 46);
  sh.getRange('B2:I2').merge().setFontColor(TEMA_.muted).setWrap(true);
  sh.setRowHeight(2, 36);
  sh.getRange('B4').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('C4').setBackground(TEMA_.input).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('dd/mm/yyyy')
    .setBorder(true, true, true, true, null, null, '#C9A400', SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
      .setHelpText('Tanggal (dd/mm/yyyy). Kosongkan = hari ini. · 输入日期；空白 = 今天。').build());
  sh.getRange('D4:F4').merge().setFontColor(TEMA_.muted);
  sh.getRange('G4').setHorizontalAlignment('right').setFontColor(TEMA_.muted);
  sh.getRange('H4:I4').merge().setNumberFormat('dddd, d mmmm yyyy').setFontWeight('bold');
  sh.setRowHeight(3, 8);
  var rules = [];
  fmt.forEach(function (f) {
    if (f[0] === 'section') {
      sh.getRange(A(f[1], 2, f[1], 9)).merge().setBackground(TEMA_.section).setFontColor(TEMA_.title).setFontWeight('bold').setFontSize(12);
      sh.setRowHeight(f[1], 28);
    } else if (f[0] === 'sub') {
      sh.getRange(A(f[1], 2, f[1], 9)).merge().setFontWeight('bold').setFontColor(TEMA_.title);
    } else if (f[0] === 'kpi') {
      for (var i = 0; i < f[2]; i++) {
        var c0 = 2 + i * 2;
        sh.getRange(A(f[1], c0, f[1], c0 + 1)).merge().setFontColor(TEMA_.muted).setFontSize(11).setHorizontalAlignment('center').setWrap(true);
        sh.getRange(A(f[1] + 1, c0, f[1] + 1, c0 + 1)).merge().setFontSize(24).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('0');
        sh.getRange(A(f[1], c0, f[1] + 1, c0 + 1))
          .setBorder(true, true, true, true, null, null, '#D0D7E2', SpreadsheetApp.BorderStyle.SOLID);
      }
      sh.setRowHeight(f[1] + 1, 46);
    } else if (f[0] === 'status') {
      statuses.forEach(function (s, i) {
        var p = TEMA_.status[s];
        sh.getRange(f[1], 2 + i, 2, 1).setBackground(p[0]).setFontColor(p[1]).setHorizontalAlignment('center').setFontWeight('bold');
      });
      sh.getRange(f[1], 2, 1, statuses.length).setWrap(true).setFontSize(11);
      sh.getRange(f[1] + 1, 2, 1, statuses.length).setFontSize(18).setNumberFormat('0');
      sh.setRowHeight(f[1], 36);
      sh.setRowHeight(f[1] + 1, 36);
    } else if (f[0] === 'table') {
      sh.getRange(f[1], 2, 1, f[3]).setBackground(TEMA_.head).setFontColor(TEMA_.headText).setFontWeight('bold').setWrap(true);
      if (f[2] > f[1]) sh.getRange(f[1] + 1, 2, f[2] - f[1], f[3]).setBorder(null, null, true, null, null, true, '#E3E7ED', SpreadsheetApp.BorderStyle.SOLID);
    }
  });
  // daftar "masih terbuka": judul, status berwarna, tanggal pendek, tenggat lewat merah
  sh.getRange(oHead, 2, 1, 7).setBackground(TEMA_.head).setFontColor(TEMA_.headText).setFontWeight('bold').setWrap(true);
  var open = function (c) { return sh.getRange(oHead + 1, c, 300, 1); };
  open(6).setNumberFormat('dd/mm hh:mm');
  open(7).setNumberFormat('dd/mm hh:mm');
  Object.keys(TEMA_.status).forEach(function (s) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(TEMA_.status[s][0]).setFontColor(TEMA_.status[s][1]).setRanges([open(4)]).build());
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(fx_('=AND(ISNUMBER($G' + (oHead + 1) + '),$G' + (oHead + 1) + '<NOW())'))
    .setFontColor(TEMA_.late).setBold(true).setRanges([open(7)]).build());
  // kotak "Lewat tenggat" & "Perlu review" berwarna jika > 0; hasil project hijau / merah
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground(TEMA_.status.Abandoned[0]).setFontColor(TEMA_.late)
    .setRanges([sh.getRange(A(nowRow + 1, 6, nowRow + 1, 7))]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground(TEMA_.review[0]).setFontColor(TEMA_.review[1])
    .setRanges([sh.getRange(A(nowRow + 1, 8, nowRow + 1, 9))]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('✓').setFontColor(TEMA_.status.Completed[1]).setBold(true).setRanges([sh.getRange(pHead + 1, 6, Math.max(1, projects.length), 1)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('▲').setFontColor(TEMA_.late).setBold(true).setRanges([sh.getRange(pHead + 1, 6, Math.max(1, projects.length), 1)]).build());
  sh.setConditionalFormatRules(rules);

  // ---- grafik: satu warna (jumlah), angka ada di tabel sebelahnya ----
  if (jenis.length) {
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.BAR).addRange(sh.getRange(jHead, 2, jenis.length + 1, 2)).setNumHeaders(1)
      .setPosition(chartRow, 5, 0, 0)
      .setOption('title', 'Jenis kerusakan bulan ini · 本月故障类型').setOption('legend', { position: 'none' })
      .setOption('colors', [TEMA_.chart]).setOption('width', 500).setOption('height', 290).build());
  }
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN).addRange(sh.getRange(1, 13, 32, 2)).setNumHeaders(1)
    .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
    .setPosition(dailyRow, 2, 0, 0)
    .setOption('title', 'Pekerjaan selesai per hari bulan ini · 本月每日完成数').setOption('legend', { position: 'none' })
    .setOption('colors', [TEMA_.chart]).setOption('width', 1000).setOption('height', 230).build());

  var prot = sh.protect().setDescription('Ringkasan dibuat otomatis. Yang boleh diubah: sel tanggal (C4).').setWarningOnly(true);
  prot.setUnprotectedRanges([sh.getRange('C4')]);
  sh.setTabColor(TEMA_.tab.baca);
}

/**
 * Tulis grid campuran: nilai biasa lewat setValues, rumus lewat setFormulas (per deret rumus yang bersebelahan),
 * dikonversi ke sintaks locale spreadsheet (fx_).
 */
function writeGrid_(sh, grid, r0, c0) {
  var isF = function (v) { return typeof v === 'string' && v.charAt(0) === '='; };
  var w = grid[0].length;
  sh.getRange(r0, c0, grid.length, w).setValues(grid.map(function (row) { return row.map(function (v) { return isF(v) ? '' : v; }); }));
  grid.forEach(function (row, i) {
    for (var j = 0; j < w; j++) {
      if (!isF(row[j])) continue;
      var k = j;
      while (k + 1 < w && isF(row[k + 1])) k++;
      sh.getRange(r0 + i, c0 + j, 1, k - j + 1).setFormulas([row.slice(j, k + 1).map(fx_)]);
      j = k;
    }
  });
}

// ---------- Baca Saya ----------

function buildBacaSaya_(ss) {
  var sh = ss.getSheetByName(BACA_) || ss.insertSheet(BACA_, 1);
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), 80), Math.max(sh.getMaxColumns(), 6)).breakApart();
  sh.clear();
  sh.setConditionalFormatRules([]);
  sh.setHiddenGridlines(true);
  var y = yearOf_(new Date()), app = appName_();
  var T = TEMA_.tab;
  var tabs = [
    [T.baca, RINGKASAN_, 'Angka hari ini, sekarang, dan bulan ini + grafik. Ganti tanggal di sel kuning.\n今天、现在和本月的数据与图表。在黄色单元格中更改日期。', 'Hanya sel tanggal (kuning)\n只改黄色日期格'],
    [T.baca, BACA_, 'Penjelasan ini.\n本说明。', 'Tidak\n否'],
    [T.laporan, laporanName_(y), 'Laporan format Excel (Form Stop Line). Satu baris = satu pekerjaan. Untuk dikirim ke atasan.\nExcel 格式报表（停线表）。一行 = 一项工作。', 'Tidak: dibuat ulang otomatis. Salah isi → perbaiki di tab Maintenance.\n否：自动重建。请在 Maintenance 中修改。'],
    [T.laporan, rekapName_(y), 'Jumlah pekerjaan & MTTR per bulan.\n每月工作数量和 MTTR。', 'Tidak (otomatis)\n否（自动）'],
    [T.laporan, APP.SHEETS.PENDING, 'Pekerjaan yang tertunda (pending). Merah = lewat tenggat.\n挂起的工作。红色 = 已逾期。', 'Tidak (otomatis)\n否（自动）'],
    [T.laporan, APP.SHEETS.SARAN, 'Saran dari teknisi. Tanggapi lewat aplikasi (💡 Saran).\n技术员的建议。请在应用中回复。', 'Status & Tanggapan boleh\n可改状态和回复'],
    [T.app, APP.SHEETS.MAINT, 'Semua data pekerjaan (data asli aplikasi). Kolom email & waktu sistem disembunyikan.\n所有维修原始数据。邮箱和系统时间列已隐藏。', 'Hanya admin, untuk memperbaiki salah isi\n仅管理员修正错误'],
    [T.app, APP.SHEETS.PEMAKAIAN, 'Satu baris = satu sparepart yang dipakai. Bisa difilter.\n每行 = 一个使用的备件。可以筛选。', 'Tidak\n否'],
    [T.atur, APP.SHEETS.USERS, 'Teknisi & admin. Nama di sini yang tampil di laporan. Bahasa: zh = aplikasi 中文.\n技术员和管理员。Bahasa 填 zh = 中文界面。', 'Ya (admin)\n可以（管理员）'],
    [T.atur, APP.SHEETS.LINES, 'Daftar line. Satu baris = satu QR.\n产线列表。一行 = 一个二维码。', 'Ya (admin)\n可以（管理员）'],
    [T.atur, APP.SHEETS.MESIN, 'Mesin per line.\n每条产线的设备。', 'Ya (admin)\n可以（管理员）'],
    [T.atur, APP.SHEETS.SPAREPART, 'Katalog sparepart: Jenis → Nama → Model.\n备件目录：类别 → 名称 → 型号。', 'Ya (admin)\n可以（管理员）'],
    [T.atur, APP.SHEETS.OPTIONS, 'Isi pilihan di form (masalah, penyebab, …) + nama 中文.\n表单选项（现象、原因 …）及中文名称。', 'Ya (admin)\n可以（管理员）']
  ];
  var hidden = [
    [T.atur, APP.SHEETS.PROJECTS + ', ' + APP.SHEETS.FACTORY, 'Project baterai & target MTTR; daftar factory.\n电池项目和 MTTR 目标；工厂列表。'],
    [T.atur, APP.SHEETS.FORM + ', ' + APP.SHEETS.FORMAT, 'Pertanyaan form aplikasi; kolom tab Laporan.\n应用表单问题；报表列。'],
    [T.atur, APP.SHEETS.CONFIG + ', ' + APP.SHEETS.PANDUAN + ', ' + APP.SHEETS.RENCANA, 'Aturan (jam peringatan, nama aplikasi…); catatan & rencana di Panduan aplikasi.\n规则；应用指南中的说明和计划。'],
    [T.app, APP.SHEETS.LOG + ', ' + APP.SHEETS.TERJEMAHAN, 'Riwayat setiap tombol; hasil terjemahan (boleh dikoreksi).\n每次操作记录；翻译结果（可修改）。'],
    [T.app, APP.SHEETS.MAINT + ' <baterai>', 'Data Maintenance per baterai (otomatis).\n按电池项目的维修数据（自动）。'],
    [T.arsip, 'Arsip <tahun>, Laporan/Rekap tahun lalu', 'Data tahun sebelumnya.\n往年数据。']
  ];
  var g = [];
  var line = function (a, b, c, d) { g.push([a || '', b || '', c || '', d || '']); return g.length; };
  var rows = {};
  rows.title = line('', '📘 BACA SAYA · 使用说明 — ' + app);
  rows.intro = line('', 'Spreadsheet ini diisi otomatis oleh aplikasi ' + app + '. Mulai dari tab Ringkasan. Warna tab menunjukkan kelompoknya.\n本表格由应用自动填写。请先看 Ringkasan 标签页。标签页颜色表示分组。');
  line();
  rows.legendHead = line('', 'Arti warna 颜色说明');
  var legend = [
    [T.baca, 'Tab hijau: mulai dari sini (dibaca) · 绿色：从这里开始'],
    [T.laporan, 'Tab kuning: laporan untuk dibaca / dikirim · 黄色：报表'],
    [T.atur, 'Tab biru: pengaturan, boleh diedit admin · 蓝色：设置，管理员可编辑'],
    [T.app, 'Tab abu-abu: ditulis aplikasi, jangan diedit · 灰色：应用写入，请勿编辑']
  ];
  rows.legend = g.length + 1;
  legend.forEach(function (l) { line('', '', l[1]); });
  rows.status = g.length + 1;
  Object.keys(TEMA_.status).forEach(function (s) { line('', s + ' · ' + STATUS_ZH_[s], { 'Aktif': 'Sedang dikerjakan', 'Pause': 'Istirahat sebentar', 'Pending': 'Tertunda (menunggu part, dll.)', 'Completed': 'Selesai', 'Cancelled': 'Dibatalkan (salah input)', 'Abandoned': 'Ditinggal tanpa konfirmasi' }[s] + ' · ' + { 'Aktif': '正在维修', 'Pause': '短暂暂停', 'Pending': '等待备件等', 'Completed': '完成', 'Cancelled': '录入错误已取消', 'Abandoned': '超时未确认' }[s]); });
  rows.extra = g.length + 1;
  line('', 'Teks merah 红字', 'Lewat tenggat · 已逾期');
  line('', 'Baris pudar 灰色行', 'Aktif = Tidak (tidak dipakai lagi) · 已停用');
  line('', 'Sel kuning 黄色格', 'Boleh diisi · 可以填写');
  line();
  rows.tabHead = line('', 'Tab 标签页', 'Isinya apa? 内容', 'Boleh diedit? 可以编辑吗？');
  rows.tabs = g.length + 1;
  tabs.forEach(function (t) { line('', t[1], t[2], t[3]); });
  line();
  rows.hidHead = line('', 'Tab tersembunyi 隐藏的标签页', 'Buka: menu "' + app + '" → Tampilkan semua tab. Rapikan lagi: menu → Rapikan tampilan spreadsheet.\n打开：菜单 → Tampilkan semua tab。', '');
  rows.hid = g.length + 1;
  hidden.forEach(function (t) { line('', t[1], t[2], ''); });
  line();
  rows.ruleHead = line('', 'Aturan penting 重要规则');
  rows.rules = g.length + 1;
  [
    '1. Jangan ganti nama tab atau judul kolom (baris 1). · 不要修改标签页名称或列标题。',
    '2. Di tab biru, jangan hapus baris: ubah Aktif menjadi Tidak. · 蓝色标签页中不要删除行，请把 Aktif 改为 Tidak。',
    '3. Salah isi data pekerjaan: perbaiki di tab Maintenance, lalu Dashboard aplikasi → Perbarui Laporan & Rekap. · 数据错误请在 Maintenance 中修改。',
    '4. Laporan & Rekap diperbarui otomatis setiap tombol ditekan di aplikasi, dan dibangun ulang tiap malam. · 报表在每次操作后自动更新。'
  ].forEach(function (t) { line('', t); });

  sh.getRange(1, 1, g.length, 4).setValues(g);
  sh.setColumnWidth(1, 18); sh.setColumnWidth(2, 230); sh.setColumnWidth(3, 520); sh.setColumnWidth(4, 280);
  sh.getRange(1, 2, g.length, 3).setWrap(true).setVerticalAlignment('middle').setFontColor(TEMA_.ink);
  sh.getRange(rows.title, 2, 1, 3).merge().setBackground(TEMA_.title).setFontColor(TEMA_.headText).setFontSize(18).setFontWeight('bold');
  sh.setRowHeight(rows.title, 46);
  sh.getRange(rows.intro, 2, 1, 3).merge().setFontColor(TEMA_.muted);
  sh.setRowHeight(rows.intro, 44);
  [rows.legendHead, rows.ruleHead].forEach(function (r) {
    sh.getRange(r, 2, 1, 3).merge().setBackground(TEMA_.section).setFontColor(TEMA_.title).setFontWeight('bold').setFontSize(12);
  });
  legend.forEach(function (l, i) { sh.getRange(rows.legend + i, 2).setBackground(l[0]); });
  Object.keys(TEMA_.status).forEach(function (s, i) {
    sh.getRange(rows.status + i, 2).setBackground(TEMA_.status[s][0]).setFontColor(TEMA_.status[s][1]).setFontWeight('bold');
  });
  sh.getRange(rows.extra, 2).setFontColor(TEMA_.late).setFontWeight('bold');
  sh.getRange(rows.extra + 1, 2).setFontColor(TEMA_.off);
  sh.getRange(rows.extra + 2, 2).setBackground(TEMA_.input);
  [rows.tabHead, rows.hidHead].forEach(function (r) {
    sh.getRange(r, 2, 1, 3).setBackground(TEMA_.head).setFontColor(TEMA_.headText).setFontWeight('bold');
  });
  tabs.forEach(function (t, i) {
    sh.getRange(rows.tabs + i, 2).setFontWeight('bold')
      .setBorder(null, true, null, null, null, null, t[0], SpreadsheetApp.BorderStyle.SOLID_THICK);
  });
  hidden.forEach(function (t, i) {
    sh.getRange(rows.hid + i, 2).setFontWeight('bold').setFontColor(TEMA_.muted)
      .setBorder(null, true, null, null, null, null, t[0], SpreadsheetApp.BorderStyle.SOLID_THICK);
  });
  sh.getRange(rows.tabs, 2, tabs.length, 3).setBorder(null, null, true, null, null, true, '#E3E7ED', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(rows.rules, 2, 4, 3).mergeAcross();
  sh.protect().setDescription('Baca Saya dibuat otomatis (menu → Rapikan tampilan spreadsheet).').setWarningOnly(true);
  sh.setTabColor(TEMA_.tab.baca);
}
