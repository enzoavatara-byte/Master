/**
 * UJI BEBAN 1 TAHUN DI APPS SCRIPT ASLI — hanya untuk spreadsheet uji (Cikarang uji). JANGAN disalin ke produksi.
 * Dibuat oleh test/gas-tahun.js: UJT_ (di atas file ini) = ringkasan + daftar potongan data; isi sheet (±5.500 pekerjaan,
 * ±14.000 baris Log) & angka harapan ada di UjiTahunData*.js (gzip + base64), dihitung kode yang sama di atas mock.
 * Menu spreadsheet "🧪 Uji 1 tahun", jalankan berurutan; tiap menu ≤ 6 menit, hasil ditulis per bagian ke tab "Uji 1 tahun".
 * Bagian yang sedang berjalan dicatat di DocumentProperties: bila Apps Script membunuhnya di batas 6 menit, menu berikutnya
 * mencatatnya sebagai GAGAL (itu sendiri temuan: di produksi trigger malam / setup yang sama akan gagal).
 */

var UJT_SHEET_ = 'Uji 1 tahun', UJT_MARK_ = 'UJT_MARK', UJT_ISI_ = 'UJT_ISI';
var UJT_BATAS_ = { tombol: 5000, layar: 5000, malam: 240000, setup: 240000, cek: 10000 };
var UJT_LINE_ = 'UJI-1';

function ujtMenu_() {
  SpreadsheetApp.getUi().createMenu('🧪 Uji 1 tahun')
    .addItem('1 · Isi data (ulang bila diminta)', 'ujtIsi')
    .addItem('2 · Setup + laporan tahun lalu', 'ujtSetup')
    .addItem('3 · Malam (per tahap)', 'ujtMalam')
    .addItem('4 · Tombol & layar', 'ujtTombol')
    .addItem('5 · Periksa isi', 'ujtPeriksa')
    .addItem('6 · Arsip tahun lalu + tombol ulang', 'ujtArsip')
    .addSeparator()
    .addItem('7 · Selesai: hapus trigger uji', 'ujtSelesai')
    .addToUi();
}

function ujtMe_() {
  var me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!me) throw new Error('Email pelaksana tidak terbaca. Jalankan dari spreadsheet dengan akun pemilik.');
  return me;
}

var UJT_CACHE_ = null;
/** Isi sheet & harapan: potongan base64 → gzip → JSON (±10 dtk sekali per eksekusi). */
function ujtData_() {
  if (UJT_CACHE_) return UJT_CACHE_;
  var blob = Utilities.newBlob(Utilities.base64Decode(ujtChunks_().join('')), 'application/x-gzip');
  UJT_CACHE_ = JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8'));
  return UJT_CACHE_;
}

function ujtVal_(v, me) {
  if (v && typeof v === 'object' && v.d != null) return new Date(v.d);
  return typeof v === 'string' ? v.split(UJT_.meta.admin).join(me) : v;
}

// ---------- pencatat hasil ----------

/** Tab "Uji 1 tahun": baris tahap ini diganti, tahap lain dipertahankan. Kolom: Tahap · No · Cek · Hasil · Detail · ms. */
function ujtHasil_(tahap, rows, ringkas, final) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(UJT_SHEET_) || ss.insertSheet(UJT_SHEET_, 0);
  var old = sh.getLastRow() > 2 ? sh.getRange(3, 1, sh.getLastRow() - 2, 6).getValues() : [];
  var keep = old.filter(function (r) { return r[0] !== '' && Number(r[0]) !== tahap; });
  var all = keep.concat(rows.map(function (r) { return [tahap].concat(r); }));
  all.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  var lulus = all.filter(function (r) { return r[3] === 'LULUS'; }).length, gagal = all.filter(function (r) { return r[3] === 'GAGAL'; }).length;
  var head = [['UJI 1 TAHUN — tahap ' + tahap + ': ' + ringkas + ' · total ' + lulus + ' LULUS, ' + gagal + ' GAGAL', '', '', '',
    'versi ' + APP.VERSION + ' · data ' + UJT_.meta.start + ' – ' + UJT_.meta.end + ' (' + UJT_.meta.jobs + ' pekerjaan, dibuat ' + UJT_.meta.todayKey +
    ') · dijalankan ' + Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH:mm') + ' oleh ' + ujtMe_(), ''],
    ['Tahap', 'No', 'Cek', 'Hasil', 'Detail', 'ms']];
  sh.clearContents();
  sh.getRange(1, 1, head.length + all.length, 6).setValues(head.concat(all));
  if (!final) { SpreadsheetApp.flush(); return; }
  sh.getRange(1, 1, 2, 6).setFontWeight('bold');
  if (all.length) sh.getRange(3, 5, all.length, 1).setWrap(true);
  sh.setColumnWidth(3, 330); sh.setColumnWidth(5, 640);
  sh.setFrozenRows(2);
  var rg = sh.getRange(3, 4, Math.max(1, all.length), 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('LULUS').setBackground('#D7F0D7').setFontColor('#0B5A0B').setRanges([rg]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('GAGAL').setBackground('#F8DADA').setFontColor('#8F1F1F').setRanges([rg]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('INFO').setBackground('#E8EEF8').setFontColor('#1F3A6B').setRanges([rg]).build()
  ]);
  ss.setActiveSheet(sh);
}

/** Pencatat satu tahap: ok / info / timed (dengan batas) / safe (tulis hasil sementara) / selesai. */
function ujtRunner_(tahap) {
  var T0 = Date.now(), res = [], props = PropertiesService.getDocumentProperties();
  var prev = props.getProperty(UJT_MARK_);
  if (prev) {   // eksekusi sebelumnya berhenti di tengah bagian (batas 6 menit Apps Script)
    try {
      var m = JSON.parse(prev), sh = SpreadsheetApp.getActive().getSheetByName(UJT_SHEET_);
      var rows = sh && sh.getLastRow() > 2 ? sh.getRange(3, 1, sh.getLastRow() - 2, 6).getValues().filter(function (r) { return Number(r[0]) === m.tahap; })
        .map(function (r) { return r.slice(1); }) : [];
      rows.push([rows.length + 1, 'Tahap ' + m.tahap + ' berhenti di "' + m.part + '"', 'GAGAL', 'Apps Script berhenti ' + Math.round((m.t - m.t0) / 1000) +
        ' dtk setelah tahap mulai, saat bagian ini berjalan (batas 360 dtk per eksekusi). Di produksi bagian yang sama akan gagal dengan data setahun.', '']);
      ujtHasil_(m.tahap, rows, 'berhenti di batas waktu', true);
    } catch (e) { /* catatan rusak: abaikan */ }
    props.deleteProperty(UJT_MARK_);
  }
  var R = {
    res: res, t0: T0,
    ok: function (cek, pass, detail, ms) { res.push([res.length + 1, cek, pass ? 'LULUS' : 'GAGAL', String(detail == null ? '' : detail).slice(0, 2000), ms == null ? '' : ms]); return pass; },
    info: function (cek, detail, ms) { res.push([res.length + 1, cek, 'INFO', String(detail == null ? '' : detail).slice(0, 2000), ms == null ? '' : ms]); },
    mark: function (part) { props.setProperty(UJT_MARK_, JSON.stringify({ tahap: tahap, part: part, t0: T0, t: Date.now() })); },
    timed: function (label, batas, fn) {
      R.mark(label);
      var t = Date.now(), v = fn(), ms = Date.now() - t;
      props.deleteProperty(UJT_MARK_);
      if (batas) R.ok('Waktu: ' + label, ms <= batas, ms + ' ms (batas ' + batas + ')', ms);
      else R.info('Waktu: ' + label, ms + ' ms', ms);
      return { v: v, ms: ms };
    },
    safe: function (cek, fn) {
      try { fn(); } catch (e) { R.ok(cek, false, 'Error: ' + (e && e.message || e) + (e && e.stack ? '\n' + String(e.stack).slice(0, 600) : '')); }
      props.deleteProperty(UJT_MARK_);
      ujtHasil_(tahap, res, 'berjalan… selesai: ' + cek + ' · ' + Math.round((Date.now() - T0) / 1000) + ' dtk', false);
    },
    selesai: function (next) {
      var lulus = res.filter(function (r) { return r[2] === 'LULUS'; }).length, gagal = res.filter(function (r) { return r[2] === 'GAGAL'; }).length;
      var txt = lulus + ' LULUS, ' + gagal + ' GAGAL · ' + Math.round((Date.now() - T0) / 1000) + ' dtk' + (next ? ' · ' + next : '');
      ujtHasil_(tahap, res, txt, true);
      return txt;
    }
  };
  return R;
}

// ---------- 1 · isi data ----------

var UJT_TABEL_ = ['Users', 'Factory', 'Projects', 'Lines', 'Sparepart', 'Pilihan', 'Config', 'KPI data', 'Input Manual', 'Pemakaian Sparepart', 'Log', 'Maintenance'];

function ujtIsi() {
  var me = ujtMe_(), ss = SpreadsheetApp.getActive(), props = PropertiesService.getDocumentProperties();
  var R = ujtRunner_(1), st = JSON.parse(props.getProperty(UJT_ISI_) || '{"pos":{}}'), habis = false;
  R.safe('Isi data', function () {
    if (!ss.getSheetByName(APP.SHEETS.MAINT)) R.timed('setup awal (spreadsheet kosong)', 0, function () { return setup(); });
    var D = R.timed('buka data (gzip ' + UJT_.meta.kb + ' KB)', 0, ujtData_).v.data;
    var owner = '';
    try { owner = String(ss.getOwner() ? ss.getOwner().getEmail() : '').trim().toLowerCase(); } catch (e) { owner = ''; }
    UJT_TABEL_.forEach(function (name) {
      if (habis || st.pos[name] === 'ok') return;
      var rows = D[name].slice();
      if (name === 'Users' && owner && owner !== me) rows.push([owner, 'Pemilik (Admin)', 'Admin', 'Ya', '']);
      var w = rows[0].length, sh = findSheet_(name, ss) || ss.insertSheet(name), from = st.pos[name] || 0, CH = 2500;
      if (!from) {
        sh.clearContents();
        if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
        if (sh.getMaxRows() < rows.length + 50) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 50 - sh.getMaxRows());
      }
      for (var i = from; i < rows.length; i += CH) {
        if (Date.now() - R.t0 > 270000) { st.pos[name] = i; habis = true; break; }
        var part = rows.slice(i, i + CH).map(function (r) { var x = r.map(function (v) { return ujtVal_(v, me); }); while (x.length < w) x.push(''); return x; });
        R.mark('tulis ' + name + ' baris ' + (i + 1));
        sh.getRange(i + 1, 1, part.length, w).setValues(part);
        SpreadsheetApp.flush();
      }
      if (!habis) { st.pos[name] = 'ok'; forgetHeaders_(name); }
    });
    props.setProperty(UJT_ISI_, JSON.stringify(st));
    var done = UJT_TABEL_.filter(function (n) { return st.pos[n] === 'ok'; });
    R.ok('Tulis ' + done.length + ' / ' + UJT_TABEL_.length + ' tab', !habis, done.join(', ') + (habis ? '\nBelum selesai: jalankan menu 1 sekali lagi (melanjutkan, tidak mengulang).' : ''));
    if (!habis) {
      invalidateMaster_(); resetMaster_();
      var C = UJT_.meta.counts;
      R.info('Data', C.maintenance + ' pekerjaan · ' + C.log + ' Log · ' + C.pemakaian + ' Pemakaian Sparepart · ' + C.kpiData + ' baris KPI data · ' +
        C.lines + ' line · ' + C.users + ' user · Admin: ' + me + (owner && owner !== me ? ' + pemilik ' + owner : ''));
      props.deleteProperty(UJT_ISI_);
    }
  });
  return R.selesai(habis ? 'BELUM SELESAI: jalankan menu 1 lagi' : 'Lanjut menu 2.');
}

// ---------- 2 · setup ----------

function ujtSetup() {
  var R = ujtRunner_(2), y = UJT_.meta.year;
  R.safe('setup dengan data penuh', function () {
    var s = R.timed('setup() dengan data setahun', UJT_BATAS_.setup, function () { return setup(); });
    R.info('Pesan setup', String(s.v).slice(0, 1500));
  });
  R.safe('Laporan tahun lalu', function () {
    R.timed('Rekap + Laporan ' + (y - 1) + ' (trigger malam di bulan Januari)', UJT_BATAS_.malam, function () {
      return withLock_(function () { buildRekap_(y - 1); return buildLaporan_(y - 1); });
    });
    R.timed('KPI ' + (y - 1), UJT_BATAS_.malam, function () { return buildKpi_(y - 1); });
  });
  return R.selesai('Lanjut menu 3.');
}

// ---------- 3 · malam ----------

function ujtMalam() {
  var R = ujtRunner_(3), y = UJT_.meta.year, total = 0;
  resetMaster_();
  R.safe('Trigger malam per tahap (sama dengan refreshRekap)', function () {
    total += R.timed('Malam: Rekap + Laporan ' + y + ' (di dalam lock)', 0, function () { return withLock_(function () { buildRekap_(y); return buildLaporan_(y); }); }).ms;
    var t = R.timed('Malam: TPM (+ terjemahan baru, maks ' + TPM_TR_MAX_ + ' teks per bahasa)', 0, function () { return buildTpm_(); });
    total += t.ms;
    R.info('TPM', (t.v.sheets || []).map(function (x) { return x.sheet + ' ' + x.rows + ' baris'; }).join(', ') +
      (t.v.untranslated ? ' · ' + t.v.untranslated + ' teks belum diterjemahkan (dilanjutkan malam berikutnya)' : ' · semua teks sudah diterjemahkan'));
    total += R.timed('Malam: KPI + tutup bulan otomatis', 0, function () { buildKpi_(y); return kpiTutupOtomatis_(); }).ms;
    total += R.timed('Malam: rapikan tampilan', 0, function () { return rapikanTampilan_({}); }).ms;
    R.ok('Trigger malam total ≤ 240 dtk untuk data setahun (batas Apps Script 360)', total <= UJT_BATAS_.malam, Math.round(total / 1000) + ' dtk', total);
  });
  return R.selesai('Lanjut menu 4.');
}

// ---------- 4 · tombol & layar ----------

/** Aksi teknisi & layar admin dengan data penuh; pekerjaan uji dibersihkan sesudahnya. @return {string[]} ID uji */
function ujtAlur_(R, label) {
  var ss = SpreadsheetApp.getActive(), ids = [], tag = label ? ' (' + label + ')' : '', B = UJT_BATAS_;
  var L = findSheet_('Lines', ss), h = headers_(L, 'Lines');
  if (!lineOf_(masterData_(), UJT_LINE_)) {
    L.appendRow(objToRow_(h, { 'Line ID': UJT_LINE_, 'Nama Line': 'Line uji (dihapus otomatis)', 'Proses': 'Modul Line', 'Factory ID': 'F1', 'Baterai': 'Limo7', 'Area': '-', 'Aktif': 'Ya' }));
    invalidateMaster_(); resetMaster_();
  }
  R.safe('Alur teknisi' + tag, function () {
    var s = R.timed('Mulai' + tag, B.tombol, function () { return apiStart(UJT_LINE_, { baterai: 'Limo7', stopLine: 'Ya' }); }), id = s.v.open.id;
    ids.push(id);
    R.timed('Pause' + tag, B.tombol, function () { return apiPause(id, { values: { 'Alasan pause': 'Istirahat' } }); });
    R.timed('Resume' + tag, B.tombol, function () { return apiResume(id); });
    R.timed('Pending' + tag, B.tombol, function () { return apiPending(id, { values: { 'Pekerjaan dilakukan': 'Uji beban', 'Yang tertunda': 'Menunggu part' }, tenggat: 'BESOK' }); });
    R.timed('Lanjut (QR)' + tag, B.tombol, function () { return apiContinue(id, UJT_LINE_); });
    R.timed('Selesai + 2 part + PIC' + tag, B.tombol, function () {
      return apiComplete(id, { values: { 'Jenis kerusakan': 'Program', Masalah: 'Robot stuck / alarm', Penyebab: 'Posisi robot / servo hilang', Penanganan: 'Ganti part',
        'Detail masalah': 'Uji beban: robot stuck', 'Detail penanganan': 'Ganti sensor dan baut' },
        parts: UJT_.meta.parts, pics: [UJT_.meta.pic] });
    });
    var c = R.timed('Mulai (untuk cancel)' + tag, B.tombol, function () { return apiStart(UJT_LINE_, { baterai: 'Limo7', stopLine: 'Ya' }); });
    ids.push(c.v.open.id);
    R.timed('Cancel' + tag, B.tombol, function () { return apiCancel(c.v.open.id, { values: { 'Alasan cancel': 'Input ganda' } }); });
    var r = findById_(readTable_(APP.SHEETS.MAINT), id);
    R.ok('Alur: Completed dengan 2 part & PIC tambahan' + tag, r && r['Status'] === 'Completed' && /\n/.test(String(r['Part'])) && String(r['Teknisi terlibat']).indexOf(UJT_.meta.pic) !== -1,
      r ? r['Status'] + ' · ' + String(r['Part']).replace(/\n/g, ' | ') : 'tidak ada');
  });
  R.safe('Layar' + tag, function () {
    R.timed('Buka aplikasi (apiBootstrap)' + tag, B.layar, function () { return apiBootstrap('', '', {}); });
    R.timed('Halaman line (scan QR)' + tag, B.layar, function () { return apiGetLine(UJT_LINE_); });
    R.timed('Dashboard 30 hari' + tag, B.layar, function () { return apiDashboard({ periode: 30 }); });
    var d = R.timed('Dashboard tahun ini' + tag, B.layar, function () { return apiDashboard({ periode: 'ytd' }); });
    R.info('Dashboard: peringatan' + tag, (d.v.warnings || []).join(' · ') || '(tidak ada)');
    R.timed('Dashboard 365 hari' + tag, B.layar, function () { return apiDashboard({ periode: 365 }); });
    R.timed('Riwayat semua (admin)' + tag, B.layar, function () { return apiHistory({ scope: 'all' }); });
    R.timed('Tab Pending' + tag, B.layar, function () { return apiListPending({}); });
    R.timed('Tab Review' + tag, B.layar, function () { return apiListReview({}); });
    var rg = { from: UJT_.meta.start, to: UJT_.meta.end };
    R.timed('Statistik per line, setahun' + tag, B.layar, function () { return apiStats(Object.assign({ by: 'line', measure: 'frek' }, rg)); });
    R.timed('Statistik MTTR per bulan, setahun' + tag, B.layar, function () { return apiStats(Object.assign({ by: 'bulan', measure: 'mttr' }, rg)); });
    R.timed('Statistik MTBF per line, setahun' + tag, B.layar, function () { return apiStats(Object.assign({ by: 'line', measure: 'mtbf' }, rg)); });
    var x = R.timed('Download Riwayat setahun (bagian server)' + tag, B.layar * 2, function () { return apiExport(Object.assign({ scope: 'all' }, rg)); });
    var mb = Math.round(JSON.stringify(x.v).length / 1048576 * 10) / 10;
    R.ok('Download setahun lengkap (tidak terpotong batas ' + x.v.limit + ' baris)' + tag, !x.v.truncated, x.v.total + ' pekerjaan di rentang, terkirim ' +
      (x.v.rows ? x.v.rows.length : '?') + ' · ukuran kiriman ±' + mb + ' MB');
  });
  R.safe('Trigger 15 menit' + tag, function () {
    var t = R.timed('checkTimeouts (trigger tiap 15 menit)' + tag, B.cek, function () { return checkTimeouts(); });
    R.ok('Kuota trigger: checkTimeouts × 96 per hari ≤ 30 menit (kuota akun 90 menit/hari, dibagi semua spreadsheet akun ini)' + tag,
      t.ms * 96 <= 30 * 60000, Math.round(t.ms * 96 / 60000) + ' menit per hari untuk spreadsheet ini');
  });
  return ids;
}

function ujtBersih_(ids, R) {
  var ss = SpreadsheetApp.getActive(), drop = {};
  ids.forEach(function (x) { drop[x] = true; });
  [APP.SHEETS.MAINT, APP.SHEETS.LOG, APP.SHEETS.PEMAKAIAN].forEach(function (n) {
    var sh = ss.getSheetByName(n), v = sh.getDataRange().getValues(), c = v[0].map(String).indexOf('Maintenance ID');
    rewriteKeeping_(sh, v, function (row) { return !drop[row[c]]; });
  });
  var M = findSheet_(APP.SHEETS.MANUAL, ss);
  if (M) rewriteKeeping_(M, M.getDataRange().getValues(), function (row) { return String(row.join('|')).indexOf('Uji beban (dihapus otomatis)') === -1; });
  var L = findSheet_('Lines', ss);
  rewriteKeeping_(L, L.getDataRange().getValues(), function (row) { return row[0] !== UJT_LINE_; });
  resetHeaders_(); invalidateMaster_(); resetMaster_();
  R.timed('Perbarui Laporan, TPM & KPI setelah data uji dibersihkan', 0, function () {
    withLock_(function () { buildLaporan_(UJT_.meta.year); });
    buildTpm_();
    return buildKpi_(UJT_.meta.year);
  });
}

function ujtTombol() {
  var R = ujtRunner_(4), ids = [];
  resetMaster_();
  try {
    ids = ujtAlur_(R, '');
    R.safe('Input Manual', function () {
      var M = findSheet_(APP.SHEETS.MANUAL), h = headers_(M, APP.SHEETS.MANUAL);
      var tgl = Utilities.formatDate(new Date(Date.now() - 86400000), APP.TZ, 'dd/MM/yyyy');
      M.appendRow(objToRow_(h, { 'Tanggal': tgl, 'Jam mulai': '02:10', 'Jam selesai': '02:40', 'Line': UJT_.meta.manualLine, 'Baterai': 'Limo7', 'Stop line': 'Ya',
        'Jenis kerusakan': 'Program', 'Masalah': 'Robot stuck / alarm – uji beban', 'Penyebab': 'Posisi robot / servo hilang', 'Penanganan': 'Home / reset / restart',
        'PIC': UJT_.meta.picName, 'Catatan': 'Uji beban (dihapus otomatis)' }));
      R.timed('Input Manual: periksa', UJT_BATAS_.layar, function () { return apiInputManual({ periksa: true }); });
      var res = R.timed('Input Manual: masukkan 1 baris', 0, function () { return apiInputManual({}); });
      ids.push.apply(ids, res.v.ids || []);
      R.ok('Input Manual masuk', (res.v.ids || []).length === 1, res.v.summary);
    });
  } finally {
    R.safe('Bersihkan data uji', function () { ujtBersih_(ids, R); });
  }
  // sesudah line uji dihapus: salinan KPI bulan lalu tidak memuat line UJI-1
  R.safe('Tutup ulang bulan lalu', function () {
    var t = R.timed('Tutup ulang bulan lalu', 0, function () { return apiTutupBulan(UJT_.meta.prevKey); });
    R.ok('Tutup ulang ' + UJT_.meta.prevKey + ' tercatat', t.v.reclosed, t.v.label);
  });
  return R.selesai('Lanjut menu 5.');
}

// ---------- 5 · periksa ----------

function ujtNorm_(v, kind) {
  if (v && typeof v === 'object' && v.d != null) v = new Date(v.d);
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, kind === 'tgl' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Bandingkan tabel per kunci (nilai ATAU tampilan sama = cocok). */
function ujtTabel_(R, cek, exp, act, disp, cols, opts) {
  opts = opts || {};
  var keys = Object.keys(exp), miss = [], extra = [], diff = [], perCol = {};
  keys.forEach(function (k) {
    if (!act[k]) { miss.push(k); return; }
    exp[k].forEach(function (e, j) {
      if (opts.skip && opts.skip(k, j)) return;
      var kind = opts.kind && opts.kind[j], en = ujtNorm_(e, kind), an = ujtNorm_(act[k][j], kind);
      var ad = disp && disp[k] ? String(disp[k][j]).trim() : null;
      if (en === an || (ad !== null && ad === en)) return;
      perCol[cols[j]] = (perCol[cols[j]] || 0) + 1;
      if (diff.length < 10) diff.push(k + ' · ' + cols[j] + ': harap "' + en.slice(0, 80) + '" ≠ dapat "' + an.slice(0, 80) + '"');
    });
  });
  Object.keys(act).forEach(function (k) { if (!exp[k]) extra.push(k); });
  var n = Object.keys(perCol).reduce(function (a, c) { return a + perCol[c]; }, 0);
  R.ok(cek, !miss.length && !extra.length && !n, keys.length + ' baris dibanding' + (miss.length ? ' · hilang ' + miss.length + ': ' + miss.slice(0, 5).join(', ') : '') +
    (extra.length ? ' · lebih ' + extra.length + ': ' + extra.slice(0, 5).join(', ') : '') + (n ? ' · ' + n + ' sel beda ' + JSON.stringify(perCol) + '\n' + diff.join('\n') : ''));
}

function ujtPeriksa() {
  var R = ujtRunner_(5), ss = SpreadsheetApp.getActive(), y = UJT_.meta.year, E = ujtData_().expect, gen = UJT_.meta.generatedMs;
  var todayKey = Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'), curKey = todayKey.slice(0, 7), sameDay = todayKey === UJT_.meta.todayKey;
  resetMaster_();
  R.safe('Jumlah baris', function () {
    var C = UJT_.meta.counts, M = readTable_(APP.SHEETS.MAINT), st = {};
    M.forEach(function (r) { var k = r['Status'] + (r['Status review'] ? '/' + r['Status review'] : ''); st[k] = (st[k] || 0) + 1; });
    R.ok('Maintenance: ' + C.maintenance + ' pekerjaan, status sama', M.length === C.maintenance && JSON.stringify(st) === JSON.stringify(C.status),
      M.length + ' · ' + JSON.stringify(st) + (JSON.stringify(st) === JSON.stringify(C.status) ? '' : ' (harap ' + JSON.stringify(C.status) + ')'));
    var lg = readTable_(APP.SHEETS.LOG).filter(function (e) { return e['Timestamp'] instanceof Date && e['Timestamp'].getTime() < gen; }).length;
    R.ok('Log: ' + C.log + ' baris (tanpa kejadian uji sesudahnya)', lg === C.log, lg);
    var u = readTable_(APP.SHEETS.PEMAKAIAN).length;
    R.ok('Pemakaian Sparepart: ' + C.pemakaian + ' baris', u === C.pemakaian, u);
  });
  [y, y - 1].forEach(function (yr) {
    R.safe('Laporan ' + yr, function () {
      var sh = ss.getSheetByName(laporanName_(yr));
      if (!R.ok('Laporan ' + yr + ': tab ada', !!sh, '')) return;
      var v = sh.getDataRange().getValues(), d = sh.getDataRange().getDisplayValues(), w = v[1].length - 1, act = {}, disp = {};
      for (var i = 2; i < v.length; i++) if (v[i][w]) { act[v[i][w]] = v[i].slice(0, w); disp[v[i][w]] = d[i].slice(0, w); }
      var exp = {}, L = E.laporan[yr];
      L.rows.forEach(function (r) { exp[r[r.length - 1]] = r.slice(0, r.length - 1); });
      R.ok('Laporan ' + yr + ': jumlah baris', Object.keys(act).length === L.rows.length, Object.keys(act).length + ' (harap ' + L.rows.length + ')');
      ujtTabel_(R, 'Laporan ' + yr + ': isi semua sel', exp, act, disp, L.head, { kind: L.head.map(function (x) { return /Tanggal/.test(x) ? 'tgl' : ''; }) });
    });
  });
  [y, y - 1].forEach(function (yr) {
    R.safe('KPI ' + yr, function () {
      var sh = ss.getSheetByName(kpiName_(yr));
      if (!R.ok('KPI ' + yr + ': tab ada', !!sh, '')) return;
      var v = sh.getDataRange().getValues(), head = v[0], act = {}, exp = {};
      var key = function (r) { return ujtNorm_(r[0]) + ' · ' + r[1] + ' · ' + r[2]; };
      v.slice(1).forEach(function (r) { if (r[0]) act[key(r)] = r; });
      E.kpi[yr].forEach(function (r) { exp[key(r)] = r; });
      ujtTabel_(R, 'KPI ' + yr + ': semua bulan × Plant / Project / Line', exp, act, null, head, {
        skip: function (k, j) { return j === 11 || (!sameDay && k.indexOf(curKey) === 0 && (j === 7 || j === 8 || j === 10)); }
      });
      var closed = v.slice(1).filter(function (r) { return r[1] === 'Plant' && /^Ditutup/.test(String(r[11])); }).length;
      R.ok('KPI ' + yr + ': bulan tertutup (Plant)', closed === E.kpiClosed[yr], closed + ' bulan (harap ' + E.kpiClosed[yr] + ')');
    });
  });
  R.safe('TPM & Maintenance <baterai>', function () {
    Object.keys(E.tpm).forEach(function (name) {
      var sh = ss.getSheetByName(name), n = 0;
      if (sh && sh.getLastRow() >= 9) n = sh.getRange(9, 2, sh.getLastRow() - 8, 1).getValues().filter(function (r) { return typeof r[0] === 'number'; }).length;
      R.ok(name + ': ' + E.tpm[name] + ' baris', n === E.tpm[name], n);
    });
    Object.keys(E.perBaterai).forEach(function (name) {   // tab FILTER: dihitung Sheets asli (mock tidak menghitung rumus)
      var sh = ss.getSheetByName(name), n = 0;
      if (sh && sh.getLastRow() >= 3) n = sh.getRange(3, 1, sh.getLastRow() - 2, 1).getValues().filter(function (r) { return typeof r[0] === 'number'; }).length;
      R.ok(name + ': ' + E.perBaterai[name] + ' baris (rumus FILTER dari Laporan)', n === E.perBaterai[name], n);
    });
  });
  R.safe('Ringkasan & Dashboard', function () {
    var sh = ss.getSheetByName('Ringkasan'), bad = [];
    if (sh) sh.getDataRange().getDisplayValues().forEach(function (r, i) { r.forEach(function (x, j) { if (/^#(REF|N\/A|VALUE|ERROR|NAME|DIV|NUM)/.test(x) && bad.length < 5) bad.push('R' + (i + 1) + 'C' + (j + 1) + ' ' + x); }); });
    R.ok('Ringkasan tanpa #ERROR', !!sh && !bad.length, bad.join(' · ') || 'ok');
    var d = apiDashboard({ periode: 'ytd' }).kpi, e = E.dashboard;
    R.ok('Dashboard tahun ini = mock', JSON.stringify(d) === JSON.stringify(e), JSON.stringify(d).slice(0, 600) + (JSON.stringify(d) === JSON.stringify(e) ? '' : '\nharap ' + JSON.stringify(e).slice(0, 600)));
  });
  return R.selesai('Lanjut menu 6.');
}

// ---------- 6 · arsip ----------

function ujtArsip() {
  var R = ujtRunner_(6), y0 = UJT_.meta.year - 1, ids = [];
  resetMaster_();
  R.safe('Arsip ' + y0, function () {
    var w = apiDashboard({ periode: 30 }).warnings || [];
    R.ok('Dashboard memperingatkan data ' + y0 + ' belum diarsipkan', w.some(function (x) { return /belum diarsipkan/.test(x); }), w.join(' · '));
    var a = R.timed('Arsipkan data ' + y0, UJT_BATAS_.malam, function () { return arsipkanTahun_(y0); });
    R.ok('Arsip: ' + UJT_.meta.arsip + ' pekerjaan dipindah', a.v.maintenance === UJT_.meta.arsip, JSON.stringify({ maintenance: a.v.maintenance, log: a.v.log, sparepart: a.v.sparepart }));
    resetMaster_();
    R.info('Maintenance setelah arsip', readTable_(APP.SHEETS.MAINT).length + ' baris');
  });
  try { ids = ujtAlur_(R, 'setelah arsip'); } finally { R.safe('Bersihkan data uji', function () { ujtBersih_(ids, R); }); }
  return R.selesai('Lanjut menu 7 setelah mencoba aplikasi di HP.');
}

// ---------- 7 · selesai ----------

function ujtSelesai() {
  var R = ujtRunner_(7), n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  R.ok('Trigger uji dihapus', true, n + ' trigger milik akun ini di proyek uji (supaya tidak memakai kuota 90 menit/hari yang sama dengan Bogor). Web app tetap bisa dibuka; Run setup untuk menyalakannya lagi.');
  return R.selesai('Uji selesai. Kirim "sudah" ke Claude.');
}
