/**
 * UJI BEBAN 1 / 2 TAHUN DI APPS SCRIPT ASLI — hanya untuk spreadsheet uji (Cikarang uji). JANGAN disalin ke produksi.
 * 2.6.4 profil bogor2: 2 tahun, master Bogor, ±24/hari, arsip 2024 sudah ada, 2025 belum (menu 7 mengarsipnya), menu 10 kapasitas, menu 11 malam Januari.
 * Dibuat oleh test/gas-tahun.js: UJT_ (di atas file ini) = ringkasan + daftar potongan data; isi sheet (±5.500 pekerjaan,
 * ±14.000 baris Log) & angka harapan ada di UjiTahunData*.js (gzip + base64), dihitung kode yang sama di atas mock.
 * Menu spreadsheet "🧪 Uji 1 tahun", jalankan berurutan; tiap menu ≤ 6 menit, hasil ditulis per bagian ke tab "Uji 1 tahun".
 * Bagian yang sedang berjalan dicatat di DocumentProperties: bila Apps Script membunuhnya di batas 6 menit, menu berikutnya
 * mencatatnya sebagai GAGAL (itu sendiri temuan: di produksi trigger malam / setup yang sama akan gagal).
 */

// 2.6.4: profil bogor2 (2 tahun, master Bogor, ±24/hari) → tab & menu "Uji 2 tahun"; tab "Uji 1 tahun" lama dihapus saat menu 1 mulai dari awal
var UJT_DUA_ = UJT_.meta.profil === 'bogor2';
var UJT_SHEET_ = UJT_DUA_ ? 'Uji 2 tahun' : 'Uji 1 tahun', UJT_MARK_ = 'UJT_MARK', UJT_ISI_ = 'UJT_ISI';
// setup 300 dtk (2.6.3, dulu 240): setup sendiri tidak memulai bangun ulang yang bisa melewati ±300 dtk (SETUP_BATAS_MS_),
// batas keras Apps Script 360 dtk. 240 adalah margin pilihan saya sendiri, bukan batas yang membuat setup gagal.
var UJT_BATAS_ = { tombol: 5000, layar: 5000, malam: 240000, januari: 300000, setup: 300000, cek: 10000 };
var UJT_LINE_ = 'UJI-1';

function ujtMenu_() {
  if (UJT_DUA_) {   // 3× data: menu dipecah supaya tiap menu ≤ 6 menit; jalankan dari atas ke bawah
    SpreadsheetApp.getUi().createMenu('🧪 ' + UJT_SHEET_)
      .addItem('1 · Isi data (ulangi sampai "Lanjut menu 2")', 'ujtIsi')
      .addItem('2 · Setup', 'ujtSetup')
      .addItem('2b · Laporan & KPI tahun-tahun lalu', 'ujtSetupLalu')
      .addItem('3 · Malam biasa', 'ujtMalam')
      .addItem('3b · Malam Januari (+ tahun lalu)', 'ujtJanuari')
      .addItem('4 · Tombol (SEBELUM arsip)', 'ujtTombol')
      .addItem('4b · Layar & Download (SEBELUM arsip)', 'ujtLayar')
      .addItem('5 · Input Manual & tutup ulang', 'ujtManual')
      .addItem('6 · Periksa isi', 'ujtPeriksa')
      .addItem('6b · Kapasitas (sebelum arsip)', 'ujtKapasitas')
      .addItem('7 · Arsip tahun lalu', 'ujtArsip')
      .addItem('7b · Tombol SESUDAH arsip', 'ujtTombolArsip')
      .addItem('7d · Layar SESUDAH arsip', 'ujtLayarArsip')
      .addItem('7c · Kapasitas (sesudah arsip)', 'ujtKapasitas')
      .addItem('9 · Profil tombol (diagnosis, opsional)', 'ujtProfil')
      .addSeparator()
      .addItem('6c · Admin ceroboh (urutkan, sisip kolom, ketik sembarang)', 'ujtCeroboh')
      .addItem('6d · Periksa isi lagi (sesudah 6c)', 'ujtPeriksaUlang')
      .addItem('6e · Serbuan: 6 tombol bersamaan + tombol saat malam', 'ujtSerbuan')
      .addItem('6f · Serbuan: baca hasil (±3 menit sesudah 6e)', 'ujtSerbuanHasil')
      .addSeparator()
      .addItem('▶ Jalankan SEMUA otomatis (±1–2 jam, cukup sekali klik)', 'ujtRantai')
      .addItem('■ Hentikan jalankan otomatis', 'ujtRantaiStop')
      .addSeparator()
      .addItem('8 · Selesai: hapus trigger uji', 'ujtSelesai')
      .addToUi();
    return;
  }
  SpreadsheetApp.getUi().createMenu('🧪 ' + UJT_SHEET_)
    .addItem('1 · Isi data (ulang bila diminta)', 'ujtIsi')
    .addItem('2 · Setup + laporan tahun lalu', 'ujtSetup')
    .addItem('3 · Malam (per tahap)', 'ujtMalam')
    .addItem('4 · Tombol & layar', 'ujtTombol')
    .addItem('5 · Input Manual & tutup ulang', 'ujtManual')
    .addItem('6 · Periksa isi', 'ujtPeriksa')
    .addItem('7 · Arsip tahun lalu + tombol ulang', 'ujtArsip')
    .addItem('9 · Profil tombol (diagnosis, ±5 menit)', 'ujtProfil')
    .addItem('10 · Kapasitas (batas 10 juta sel)', 'ujtKapasitas')
    .addSeparator()
    .addItem('8 · Selesai: hapus trigger uji', 'ujtSelesai')
    .addToUi();
}

function ujtMe_() {
  var me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  // 2.6.9: jalankan otomatis (trigger): email pelaksana disimpan saat menu diklik
  if (!me) me = String(PropertiesService.getDocumentProperties().getProperty('UJT_ME') || '').trim().toLowerCase();
  if (!me) throw new Error('Email pelaksana tidak terbaca. Jalankan dari spreadsheet dengan akun pemilik.');
  return me;
}

/** Satu potongan data (file UjiTahunData<i>.js): base64 → gzip → JSON. Dibuka satu per satu supaya memori Apps Script cukup. */
function ujtBlob_(i) {
  var blob = Utilities.newBlob(Utilities.base64Decode(ujtFile_(i)), 'application/x-gzip');
  return JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8'));
}
/** Semua baris satu kunci ('lap:2026', 'kpi:2025', …) digabung — hanya untuk tabel harapan yang kecil. */
function ujtRowsOf_(key) {
  var out = [];
  (UJT_.meta.blobs[key] || []).forEach(function (b) { out = out.concat(ujtBlob_(b[0]).rows); });
  return out;
}
var UJT_EXP_ = null;
function ujtExp_() { return UJT_EXP_ || (UJT_EXP_ = ujtBlob_(UJT_.meta.blobs.exp[0][0])); }

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
  var head = [[(UJT_.meta.judul || 'UJI 1 TAHUN') + ' — tahap ' + tahap + ': ' + ringkas + ' · total ' + lulus + ' LULUS, ' + gagal + ' GAGAL', '', '', '',
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
    res: res, t0: T0, samples: {},
    ok: function (cek, pass, detail, ms) { res.push([res.length + 1, cek, pass ? 'LULUS' : 'GAGAL', String(detail == null ? '' : detail).slice(0, 2000), ms == null ? '' : ms]); return pass; },
    info: function (cek, detail, ms) { res.push([res.length + 1, cek, 'INFO', String(detail == null ? '' : detail).slice(0, 2000), ms == null ? '' : ms]); },
    mark: function (part) { props.setProperty(UJT_MARK_, JSON.stringify({ tahap: tahap, part: part, t0: T0, t: Date.now() })); },
    timed: function (label, batas, fn) {
      R.mark(label);
      var P = UJT_PROF_ && !UJT_PROF_.lambat ? UJT_PROF_ : null;
      if (P) P.cur = {};
      var t = Date.now(), v = fn(), ms = Date.now() - t;
      props.deleteProperty(UJT_MARK_);
      if (P) {   // tahap 9: rincian per fungsi menggantikan baris waktu biasa
        R.info('Profil: ' + label, ujtProfTeks_(P.cur, ms), ms);
        if (P.probe) ujtProbe_(R, label);
      } else if (batas) R.ok('Waktu: ' + label, ms <= batas, ms + ' ms (batas ' + batas + ')', ms);
      else R.info('Waktu: ' + label, ms + ' ms', ms);
      return { v: v, ms: ms };
    },
    // 2.6.3: satu layar yang sama terukur 2,5–11,9 dtk antar-ronde → diukur berulang, kriteria pada rata-rata / median
    sample: function (label, fn) {
      R.mark(label);
      var P = UJT_PROF_, pertama = /pertama/.test(label), dingin = false;
      if (P && P.lambat && !pertama) {   // diagnosis: cache master sudah hilang SEBELUM aksi? (di luar waktu yang diukur)
        P.cur = null;
        try { dingin = !readMasterCache_(); } catch (e) { dingin = true; }
        P.n++;
        if (dingin) P.kosong.push(label);
      }
      if (P) P.cur = {};
      var t = Date.now(), v = fn(), ms = Date.now() - t;
      props.deleteProperty(UJT_MARK_);
      if (P && !P.lambat) {
        R.info('Profil: ' + label, ujtProfTeks_(P.cur, ms), ms);
        if (P.probe) ujtProbe_(R, label);
      } else if (P && ms > (pertama ? 10000 : UJT_BATAS_.tombol)) {
        R.info('Lambat: ' + label, (pertama ? '' : dingin ? 'cache master KOSONG sebelum aksi · ' : 'cache master ada sebelum aksi · ') + ujtProfTeks_(P.cur, ms), ms);
      }
      (R.samples[label] = R.samples[label] || []).push(ms);
      return { v: v, ms: ms };
    },
    /** Satu baris hasil dari sampel `label`: how = 'mean' | 'median'. Tahap profil: tanpa baris. @return {number} ms */
    report: function (label, batas, how) {
      var s = R.samples[label] || [];
      if (!s.length) return 0;
      var srt = s.slice().sort(function (a, b) { return a - b; });
      var val = how === 'median' ? srt[Math.floor(srt.length / 2)] : Math.round(s.reduce(function (a, b) { return a + b; }, 0) / s.length);
      if (!UJT_PROF_ || UJT_PROF_.lambat) R.ok('Waktu: ' + label, val <= batas, (s.length > 1 ? (how === 'median' ? 'median ' : 'rata-rata ') : '') + val + ' ms' +
        (s.length > 1 ? ' dari ' + s.join(' / ') : '') + ' (batas ' + batas + ')', val);
      return val;
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

function ujtIsi() {
  var me = ujtMe_(), ss = SpreadsheetApp.getActive(), props = PropertiesService.getDocumentProperties();
  var fresh = !props.getProperty(UJT_ISI_), old = ss.getSheetByName(UJT_SHEET_);
  if (fresh && old) old.clearContents();   // uji ulang dari awal: hasil putaran sebelumnya dibuang
  if (fresh && UJT_DUA_ && ss.getSheetByName('Uji 1 tahun')) ss.deleteSheet(ss.getSheetByName('Uji 1 tahun'));   // hasil uji 1 tahun sudah dibaca
  // tab arsip ronde sebelumnya ikut terhitung di Laporan <tahun> (Maintenance + Arsip): ronde 2 Laporan 2025 = 1.737, harap 984
  if (fresh) ss.getSheets().forEach(function (sh) { if (/^Arsip( Log| Sparepart)? \d{4}$/.test(sh.getName())) ss.deleteSheet(sh); });
  var R = ujtRunner_(1), st = JSON.parse(props.getProperty(UJT_ISI_) || '{"pos":{}}'), habis = false, TABEL = UJT_.meta.tabel, rusak = false;
  if (!ujtSewa_('UJT_ISI_SEWA', true)) {   // 2.6.10: dua pemuat bersamaan = data rusak (putaran 1)
    R.ok('Isi data', false, 'Pemuatan data lain sedang berjalan (menu 1 diklik dua kali / rantai ganda). Tunggu ±6 menit lalu jalankan lagi.');
    return R.selesai('BELUM SELESAI: jalankan menu 1 lagi');
  }
  try {
  R.safe('Isi data', function () {
    if (!ss.getSheetByName(APP.SHEETS.MAINT)) R.timed('setup awal (spreadsheet kosong)', 0, function () { return setup(); });
    var owner = '';
    try { owner = String(ss.getOwner() ? ss.getOwner().getEmail() : '').trim().toLowerCase(); } catch (e) { owner = ''; }
    var dibuka = 0, tBuka = 0;
    TABEL.forEach(function (name) {
      if (habis || st.pos[name] === 'ok') return;
      var w = UJT_.meta.width[name], n = UJT_.meta.rows[name], extra = name === 'Users' && owner && owner !== me ? 1 : 0;
      var sh = findSheet_(name, ss) || ss.insertSheet(name), from = st.pos[name] || 0, CH = 2500;
      // seperti aplikasi: "16:53" tetap teks (2.6.2; arsip ditulis dengan teks juga); Config: "01/11/2024" tidak dibaca en_US sebagai 11 Jan
      var asText = TEXT_SHEETS_.indexOf(name) !== -1 || /^Arsip /.test(name) || name === 'Config';
      if (!from) {
        sh.clearContents();
        if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
        if (sh.getMaxRows() < n + extra + 50) sh.insertRowsAfter(sh.getMaxRows(), n + extra + 50 - sh.getMaxRows());
      }
      UJT_.meta.blobs['tab:' + name].forEach(function (b) {   // [file, baris awal, jumlah]
        if (habis || b[1] + b[2] <= from) return;
        var t = Date.now(), rows = ujtBlob_(b[0]).rows;
        dibuka++; tBuka += Date.now() - t;
        if (extra && b[1] === 0) rows = rows.concat([[owner, 'Pemilik (Admin)', 'Admin', 'Ya', '']]);
        for (var i = Math.max(from, b[1]); i < b[1] + rows.length; i += CH) {
          if (Date.now() - R.t0 > 270000) { st.pos[name] = i; habis = true; return; }
          var part = rows.slice(i - b[1], i - b[1] + CH).map(function (r, k) {
            var x = r.map(function (v) { v = ujtVal_(v, me); return asText && i + k > 0 ? cellText_(v) : v; });
            while (x.length < w) x.push('');
            return x;
          });
          R.mark('tulis ' + name + ' baris ' + (i + 1));
          sh.getRange(i + 1, 1, part.length, w).setValues(part);
          SpreadsheetApp.flush();
        }
      });
      if (!habis) { st.pos[name] = 'ok'; forgetHeaders_(name); }
    });
    R.info('Waktu: buka ' + dibuka + ' potongan data (gzip ' + UJT_.meta.kb + ' KB total)', tBuka + ' ms', tBuka);
    props.setProperty(UJT_ISI_, JSON.stringify(st));
    var done = TABEL.filter(function (n) { return st.pos[n] === 'ok'; });
    R.ok('Tulis ' + done.length + ' / ' + TABEL.length + ' tab', !habis, done.join(', ') + (habis ? '\nBelum selesai: jalankan menu 1 sekali lagi (melanjutkan, tidak mengulang).' : ''));
    if (!habis) {
      invalidateMaster_(); resetMaster_();
      var C = UJT_.meta.counts;
      R.info('Data', C.maintenance + ' pekerjaan di Maintenance · ' + C.log + ' Log · ' + C.pemakaian + ' Pemakaian Sparepart · ' + C.kpiData + ' baris KPI data · ' +
        C.lines + ' line · ' + C.users + ' user · arsip ' + JSON.stringify(C.arsip || {}) + ' · Admin: ' + me + (owner && owner !== me ? ' + pemilik ' + owner : ''));
      props.deleteProperty(UJT_ISI_);
      // 2.6.10: setiap tab terisi lengkap (jumlah baris = bundel), sebelum tahap lain menguji di atasnya
      var beda = TABEL.filter(function (name) {
        var sh = findSheet_(name, ss), harap = UJT_.meta.rows[name] + (name === 'Users' && owner && owner !== me ? 1 : 0);
        return !sh || sh.getLastRow() !== harap;
      }).map(function (name) { var sh = findSheet_(name, ss); return name + ' ' + (sh ? sh.getLastRow() : 0) + ' (harap ' + UJT_.meta.rows[name] + ')'; });
      rusak = !!beda.length;
      R.ok('Data uji lengkap: jumlah baris semua tab = bundel', !rusak, rusak ? beda.join(' · ') + '\nDATA TIDAK LENGKAP: jalankan menu 1 dari awal.' : TABEL.length + ' tab cocok');
    }
  });
  } finally { ujtSewa_('UJT_ISI_SEWA', false); }
  return R.selesai(habis ? 'BELUM SELESAI: jalankan menu 1 lagi' : (rusak ? 'DATA TIDAK LENGKAP: jalankan menu 1 dari awal' : 'Lanjut menu 2.'));
}

// ---------- 2 · setup ----------

function ujtSetup() {
  var R = ujtRunner_(2), y = UJT_.meta.year;
  R.safe('setup dengan data penuh', function () {
    var s = R.timed('setup() dengan data setahun', UJT_BATAS_.setup, function () { return setup(); });
    R.info('Pesan setup', String(s.v).slice(0, 1500));
  });
  if (UJT_DUA_) return R.selesai('Lanjut menu 2b.');
  ujtTahunLalu_(R);
  return R.selesai('Lanjut menu 3.');
}

/** Laporan / Rekap / KPI tahun-tahun lalu, seperti tab yang sudah ada sejak tahun itu (dibangun trigger malam waktu itu). */
function ujtTahunLalu_(R) {
  UJT_.meta.years.slice(1).forEach(function (yr) {
    R.safe('Laporan ' + yr, function () {
      R.timed('Rekap + Laporan ' + yr + ' (trigger malam di bulan Januari)', UJT_BATAS_.malam, function () {
        return withLock_(function () { buildRekap_(yr); return buildLaporan_(yr); });
      });
      R.timed('KPI ' + yr, UJT_BATAS_.malam, function () { return buildKpi_(yr); });
    });
  });
}

function ujtSetupLalu() {
  var R = ujtRunner_(2.5);
  resetMaster_();
  ujtTahunLalu_(R);
  return R.selesai('Lanjut menu 3.');
}

// ---------- 3 · malam ----------

function ujtMalam() {
  var R = ujtRunner_(3), y = UJT_.meta.year, total = 0;
  resetMaster_();
  R.safe('Trigger malam per tahap (sama dengan refreshRekap)', function () {
    total += R.timed('Malam: cek urutan Maintenance + Rekap + Laporan ' + y + ' (di dalam lock)', 0, function () {
      return withLock_(function () { urutkanMaintenance_(new Date()); buildRekap_(y); return buildLaporan_(y); });
    }).ms;
    var t = R.timed('Malam: TPM (+ terjemahan baru, maks ' + TPM_TR_MAX_ + ' teks per bahasa)', 0, function () { return buildTpm_(); });
    total += t.ms;
    R.info('TPM', (t.v.sheets || []).map(function (x) { return x.sheet + ' ' + x.rows + ' baris'; }).join(', ') +
      (t.v.untranslated ? ' · ' + t.v.untranslated + ' teks belum diterjemahkan (dilanjutkan malam berikutnya)' : ' · semua teks sudah diterjemahkan'));
    total += R.timed('Malam: KPI + tutup bulan otomatis', 0, function () { buildKpi_(y); return kpiTutupOtomatis_(); }).ms;
    total += R.timed('Malam: rapikan tampilan', 0, function () { return rapikanTampilan_({}); }).ms;
    R.ok('Trigger malam total ≤ 240 dtk untuk data setahun (batas Apps Script 360)', total <= UJT_BATAS_.malam, Math.round(total / 1000) + ' dtk', total);
  });
  return R.selesai(UJT_DUA_ ? 'Lanjut menu 3b.' : 'Lanjut menu 4.');
}

// ---------- 4 · tombol & layar ----------

/**
 * Aksi teknisi & layar admin dengan data penuh; pekerjaan uji dibersihkan sesudahnya.
 * @param {{layar?: boolean}=} opts layar: false = hanya tombol (tahap 9, putaran kedua)
 * @return {string[]} ID uji
 */
/** ID permintaan seperti HP (2.6.4), baru per ketukan. */
function ujtRid_() { return 'ujt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

function ujtAlur_(R, label, opts) {
  opts = opts || {};
  var ss = SpreadsheetApp.getActive(), ids = [], tag = label ? ' (' + label + ')' : '', B = UJT_BATAS_;
  var prof = UJT_PROF_ && !UJT_PROF_.lambat;   // menu 9: sekali per aksi; tahap 4/7 (mode lambat): diulang seperti biasa
  var n = prof ? 1 : (opts.ulang || 2), nLayar = prof ? 1 : (opts.ulangLayar || 3);
  var L = findSheet_('Lines', ss), h = headers_(L, 'Lines');
  if (!lineOf_(masterData_(), UJT_LINE_)) {
    L.appendRow(objToRow_(h, { 'Line ID': UJT_LINE_, 'Nama Line': 'Line uji (dihapus otomatis)', 'Proses': 'Modul Line', 'Factory ID': 'F1', 'Baterai': 'Limo7', 'Area': '-', 'Aktif': 'Ya' }));
  }
  // seperti admin baru mengedit tab pengaturan: cache master dibangun ulang (dulu terjadi tiap 10 menit)
  var dingin = 'Buka aplikasi pertama setelah tab pengaturan diedit (cache dibangun ulang)' + tag;
  for (var k = 0; k < n; k++) { invalidateMaster_(); resetHeaders_(); R.sample(dingin, function () { return apiBootstrap('', '', {}); }); }
  R.report(dingin, 10000, 'mean');
  if (!prof) R.safe('Katalog & data awal' + tag, function () {   // 2.6.9: ±1.500 part di Apps Script asli (cache master per 24 ribu karakter)
    var md = masterData_(), boot = JSON.stringify(apiBootstrap('', '', {})), n0 = Number(CacheService.getScriptCache().get(MD_CACHE_KEY_ + ':n') || 0);
    var harap = UJT_.meta.counts.parts;
    R.ok('Sparepart aktif di aplikasi' + (harap != null ? ' = ' + harap + ' (1.500 − 40 nonaktif; baris contoh / kotor diabaikan)' : ''), harap == null || md.spareparts.length === harap,
      md.spareparts.length + ' part · ' + Object.keys(md.lines).length + ' line · ' + md.users.length + ' user · ' + md.warnings.length + ' peringatan master');
    R.ok('Cache master tersimpan (bukan dibangun ulang tiap tombol)', n0 > 0, n0 + ' potongan × ' + MD_CHUNK_ + ' karakter · data awal ke HP ' + Math.round(boot.length / 1024) + ' KB (sebelum gzip)');
  });
  // tiap aksi = permintaan web baru: memo per eksekusi (master, judul kolom, sheetId) kosong, cache bersama (CacheService) tetap
  var run = function (lbl, fn) { return R.sample(lbl + tag, function () { resetMaster_(); resetHeaders_(); return fn(); }); };
  // 2.6.4: jalur yang sama dengan HP (apiAct + ID permintaan baru per ketukan → biaya CacheService ikut terukur)
  var act = function (fn, args) { return apiAct(fn, args, ujtRid_()); };
  var BTN = ['Mulai', 'Pause', 'Resume', 'Pending', 'Lanjut (QR)', 'Selesai + 2 part + PIC', 'Mulai (untuk cancel)', 'Cancel']
    .concat(UJT_.meta.parts20 ? ['Mulai (untuk 20 part)', 'Selesai + 20 part + 15 PIC'] : []);
  R.safe('Alur teknisi' + tag, function () {
    for (var k = 0; k < n; k++) {
      var id = run('Mulai', function () { return act('apiStart', [UJT_LINE_, { baterai: 'Limo7', stopLine: 'Ya' }]); }).v.open.id;
      ids.push(id);
      run('Pause', function () { return act('apiPause', [id, { values: { 'Alasan pause': UJT_.meta.isian.pause } }]); });
      run('Resume', function () { return act('apiResume', [id]); });
      run('Pending', function () { return act('apiPending', [id, { values: { 'Pekerjaan dilakukan': 'Uji beban', 'Yang tertunda': 'Menunggu part' }, tenggat: 'BESOK' }]); });
      run('Lanjut (QR)', function () { return act('apiContinue', [id, UJT_LINE_]); });
      run('Selesai + 2 part + PIC', function () {
        return act('apiComplete', [id, { values: { 'Jenis kerusakan': 'Program', Masalah: 'Robot stuck / alarm', Penyebab: 'Posisi robot / servo hilang', Penanganan: 'Ganti part',
          'Detail masalah': 'Uji beban: robot stuck', 'Detail penanganan': 'Ganti sensor dan baut' },
          parts: UJT_.meta.parts, pics: [UJT_.meta.pic] }]);
      });
      var c = run('Mulai (untuk cancel)', function () { return act('apiStart', [UJT_LINE_, { baterai: 'Limo7', stopLine: 'Ya' }]); });
      ids.push(c.v.open.id);
      run('Cancel', function () { return act('apiCancel', [c.v.open.id, { values: { 'Alasan cancel': 'Input ganda' } }]); });
      if (UJT_.meta.parts20) {   // tombol terberat (2.6.4): 20 sparepart + 15 PIC tambahan → 20 baris Pemakaian, Laporan ①–⑳
        var g = run('Mulai (untuk 20 part)', function () { return act('apiStart', [UJT_LINE_, { baterai: 'Limo7', stopLine: 'Ya' }]); });
        ids.push(g.v.open.id);
        run('Selesai + 20 part + 15 PIC', function () {
          return act('apiComplete', [g.v.open.id, { values: { 'Jenis kerusakan': 'Mekanikal', Masalah: 'Part lepas / patah / kendur', Penyebab: 'Baut kendur / part patah',
            Penanganan: 'Ganti part', 'Detail penanganan': 'Uji beban: overhaul, 20 part diganti' }, parts: UJT_.meta.parts20, pics: UJT_.meta.pics15 }]);
        });
      }
      if (k) continue;
      var r = findById_(readTable_(APP.SHEETS.MAINT), id);
      R.ok('Alur: Completed dengan 2 part & PIC tambahan' + tag, r && r['Status'] === 'Completed' && /\n/.test(String(r['Part'])) && String(r['Teknisi terlibat']).indexOf(UJT_.meta.pic) !== -1,
        r ? r['Status'] + ' · ' + String(r['Part']).replace(/\n/g, ' | ') : 'tidak ada');
    }
  });
  BTN.forEach(function (b) { R.report(b + tag, B.tombol, 'mean'); });
  if (opts.layar === false) return ids;
  ujtLayar_(R, tag, ids, nLayar, n);
  return ids;
}

/**
 * Layar admin & teknisi + Download + trigger 15 menit (2.6.10: juga tahap sendiri 4b / 7d, supaya tahap tombol jauh di bawah
 * 6 menit). Tanpa `ids` (tahap sendiri): Detail memakai pekerjaan terakhir di Maintenance.
 */
function ujtLayar_(R, tag, ids, nLayar, n) {
  var B = UJT_BATAS_, uji = !!(ids && ids.length);
  var run = function (lbl, fn) { return R.sample(lbl + tag, function () { resetMaster_(); resetHeaders_(); return fn(); }); };
  if (!uji) ids = [String((readTail_(APP.SHEETS.MAINT, 1)[0] || {})['Maintenance ID'] || '')];
  R.safe('Layar' + tag, function () {
    // 365 hari terakhir data (profil 2 tahun: Download 2 tahun penuh memang dipotong di batas 12.000 baris, dengan pemberitahuan)
    var akhir = new Date(UJT_.meta.end + 'T12:00:00+07:00'), awal = Utilities.formatDate(new Date(akhir.getTime() - 364 * 86400000), APP.TZ, 'yyyy-MM-dd');
    var rg = { from: awal < UJT_.meta.start ? UJT_.meta.start : awal, to: UJT_.meta.end }, v = {};
    [['Buka aplikasi (apiBootstrap)', function () { return apiBootstrap('', '', {}); }],
      ['Halaman line (scan QR)', function () { return apiGetLine(UJT_LINE_); }],
      ['Detail pekerjaan (riwayat Log)', function () { return apiGetDetail(ids[0]); }],
      ['Dashboard 30 hari', function () { return apiDashboard({ periode: 30 }); }],
      ['Dashboard tahun ini', function () { return apiDashboard({ periode: 'ytd' }); }],
      ['Dashboard 365 hari', function () { return apiDashboard({ periode: 365 }); }],
      ['Riwayat semua (admin)', function () { return apiHistory({ scope: 'all' }); }],
      ['Tab Pending', function () { return apiListPending({}); }],
      ['Tab Review', function () { return apiListReview({}); }],
      ['Statistik per line, setahun', function () { return apiStats(Object.assign({ by: 'line', measure: 'frek' }, rg)); }],
      ['Statistik MTTR per bulan, setahun', function () { return apiStats(Object.assign({ by: 'bulan', measure: 'mttr' }, rg)); }],
      ['Statistik MTBF per line, setahun', function () { return apiStats(Object.assign({ by: 'line', measure: 'mtbf' }, rg)); }]
    ].forEach(function (x) {
      for (var k = 0; k < nLayar; k++) v[x[0]] = run(x[0], x[1]).v;
      R.report(x[0] + tag, B.layar, 'median');
    });
    R.info('Dashboard: peringatan' + tag, (v['Dashboard tahun ini'].warnings || []).join(' · ') || '(tidak ada)');
    var d = v['Detail pekerjaan (riwayat Log)'], ev = d ? d.events.map(function (e) { return e.event; }).join(', ') : 'tidak ada';
    if (uji) R.ok('Detail: riwayat Log pekerjaan uji lengkap' + tag, d && d.events.length >= 6, ev);
    else R.ok('Detail pekerjaan terakhir terbaca' + tag, !!d && d.events.length >= 1, ids[0] + ': ' + ev);
    var x = run('Download Riwayat setahun (bagian server)', function () { return apiExport(Object.assign({ scope: 'all' }, rg)); });
    R.report('Download Riwayat setahun (bagian server)' + tag, B.layar * 2, 'mean');
    var mb = Math.round(JSON.stringify(x.v).length / 1048576 * 10) / 10;
    R.ok('Download setahun lengkap (tidak terpotong batas ' + x.v.limit + ' baris)' + tag, !x.v.truncated, x.v.total + ' pekerjaan di rentang, terkirim ' +
      (x.v.rows ? x.v.rows.length : '?') + ' · ukuran kiriman ±' + mb + ' MB');
  });
  R.safe('Trigger 15 menit' + tag, function () {
    for (var k = 0; k < (n || 2); k++) run('checkTimeouts (trigger tiap 15 menit)', function () { return checkTimeouts(); });
    var ms = R.report('checkTimeouts (trigger tiap 15 menit)' + tag, B.cek, 'mean');
    R.ok('Kuota trigger: checkTimeouts × 96 per hari ≤ 30 menit (kuota akun 90 menit/hari, dibagi semua spreadsheet akun ini)' + tag,
      ms * 96 <= 30 * 60000, Math.round(ms * 96 / 60000) + ' menit per hari untuk spreadsheet ini');
  });
}

function ujtHapusLineUji_() {
  var L = findSheet_('Lines');
  rewriteKeeping_(L, L.getDataRange().getValues(), function (row) { return !/^UJI-/.test(String(row[0])); });
  resetHeaders_(); invalidateMaster_(); resetMaster_();
}

/** 4b / 7d: layar sendiri (2.6.10). */
function ujtLayar() { return ujtLayarTahap_(4.5, '', 'Lanjut menu 5.'); }
function ujtLayarArsip() { return ujtLayarTahap_(7.6, ' (setelah arsip)', 'Lanjut menu 7c.'); }
function ujtLayarTahap_(tahap, tag, next) {
  var R = ujtRunner_(tahap);
  resetMaster_();
  try { ujtProfPasang_(true); ujtLineUji_(UJT_LINE_); ujtLayar_(R, tag, [], UJT_DUA_ ? (tag ? 2 : 1) : 3, 2); }
  finally { ujtProfLepas_(); R.safe('Hapus line uji', ujtHapusLineUji_); }
  return R.selesai(next);
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
  rewriteKeeping_(L, L.getDataRange().getValues(), function (row) { return !/^UJI-/.test(String(row[0])); });   // UJI-1 + line serbuan UJI-S1…
  resetHeaders_(); invalidateMaster_(); resetMaster_();
  R.timed('Perbarui Laporan & KPI setelah data uji dibersihkan', 0, function () {
    withLock_(function () { buildLaporan_(UJT_.meta.year); });
    return buildKpi_(UJT_.meta.year);
  });
}

function ujtTombol() {
  var R = ujtRunner_(4), ids = [];
  resetMaster_();
  try {
    ujtProfPasang_(true);
    ids = ujtAlur_(R, '', UJT_DUA_ ? { layar: false } : {});   // 2.6.10: profil 2 tahun → layar di menu 4b
    // 2.6.4 di CacheService asli: sinyal putus sesudah server menyimpan → HP mengirim ID permintaan yang sama lagi
    R.safe('Ketuk ulang tanpa dobel', function () {
      var v = apiAct('apiStart', [UJT_LINE_, { baterai: 'Limo7', stopLine: 'Ya' }], ujtRid_()), id = v.open.id, rid = ujtRid_();
      ids.push(id);
      var P = [id, { values: { 'Alasan pause': UJT_.meta.isian.pause } }], a = apiAct('apiPause', P, rid), b = apiAct('apiPause', P, rid);
      var n = readWhere_(APP.SHEETS.LOG, 'Maintenance ID', id).filter(function (e) { return e['Kejadian'] === APP.EVENTS.PAUSE; }).length;
      R.ok('Ketuk ulang (ID permintaan sama) → aksi sekali, HP diberi tahu "sudah tersimpan"', !a.ulang && b.ulang === true && n === 1,
        'ketukan kedua ulang = ' + !!b.ulang + ' · Log pause = ' + n);
      apiAct('apiResume', [id], ujtRid_());
      apiAct('apiCancel', [id, { values: { 'Alasan cancel': 'Input ganda' } }], ujtRid_());
    });
  } finally {
    ujtCacheInfo_(R, '');
    ujtProfLepas_();
    R.safe('Bersihkan data uji', function () { ujtBersih_(ids, R); });
  }
  return R.selesai(UJT_DUA_ ? 'Lanjut menu 4b.' : 'Lanjut menu 5.');
}

// ---------- 5 · Input Manual & tutup ulang ----------

function ujtManual() {
  var R = ujtRunner_(5), ids = [];
  resetMaster_();
  try {
    R.safe('Input Manual', function () {
      var M = findSheet_(APP.SHEETS.MANUAL), h = headers_(M, APP.SHEETS.MANUAL);
      var tgl = Utilities.formatDate(new Date(Date.now() - 86400000), APP.TZ, 'dd/MM/yyyy');
      M.appendRow(objToRow_(h, { 'Tanggal': tgl, 'Jam mulai': '02:10', 'Jam selesai': '02:40', 'Line': UJT_.meta.manualLine, 'Baterai': 'Limo7', 'Stop line': 'Ya',
        'Jenis kerusakan': 'Program', 'Masalah': 'Robot stuck / alarm – uji beban', 'Penyebab': 'Posisi robot / servo hilang', 'Penanganan': 'Home / reset / restart',
        'PIC': UJT_.meta.picName, 'Catatan': 'Uji beban (dihapus otomatis)' }));
      R.timed('Input Manual: periksa', UJT_BATAS_.layar, function () { return apiInputManual({ periksa: true }); });
      var res = R.timed('Input Manual: masukkan 1 baris (Laporan + Rekap + KPI, tanpa TPM)', 60000, function () { return apiInputManual({}); });
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
  return R.selesai('Lanjut menu 6.');
}

// ---------- 6 · periksa ----------

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

function ujtPeriksa() { return ujtPeriksa_(6); }
function ujtPeriksaUlang() { return ujtPeriksa_(6.7); }   // 2.6.9: sesudah 6c (admin ceroboh) isi harus tetap sama persis

function ujtPeriksa_(tahap) {
  var R = ujtRunner_(tahap), ss = SpreadsheetApp.getActive(), y = UJT_.meta.year, E = ujtExp_(), gen = UJT_.meta.generatedMs;
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
    Object.keys(C.arsip || {}).forEach(function (n) {   // arsip yang dibuat admin di tahun-tahun lalu
      var a = ss.getSheetByName(n) ? readTable_(n).length : -1;
      R.ok(n + ': ' + C.arsip[n] + ' baris', a === C.arsip[n], a < 0 ? 'tab tidak ada' : a);
    });
  });
  R.safe('Baca panas (2.6.3)', function () {
    resetHeaders_();
    var full = readTable_(APP.SHEETS.MAINT), sh = sheet_(APP.SHEETS.MAINT), h = headers_(sh, APP.SHEETS.MAINT), last = sh.getLastRow();
    var panas = function (r) { return isOpen_(r) || r['Status'] === APP.STATUS.PENDING || r['Status review'] === APP.REVIEW.NEEDED; };
    var key = function (r) { return r._row + '|' + r['Maintenance ID'] + '|' + r['Status']; };
    // ekor kedua dipilih supaya pekerjaan panas tertua tepat di luar ekor → jalur "cari baris lama di server" ikut diuji
    var tua = full.findIndex(panas), ekor2 = tua >= 0 ? Math.max(1, full.length - tua - 1) : 50;
    [HOT_TAIL_, ekor2].forEach(function (tail) {
      var want = full.filter(function (r, i) { return i >= full.length - tail || panas(r); }), got = readHot_(tail);
      var lama = want.filter(function (r) { return r._row < full[full.length - tail]._row; }).length;
      R.ok('readHot_(' + tail + ') = baca penuh difilter (ekor + terbuka / pending / Perlu review)', got.map(key).join(',') === want.map(key).join(','),
        got.length + ' baris dibaca dari ' + full.length + ' · ' + lama + ' baris panas di luar ekor');
    });
    var cek = function (col, vals, pred) { var a = hotFind_(sh, h, col, vals, last).length, b = full.filter(pred).length; return [a === b, col + ' ' + vals.join('|') + ': ' + a + ' = ' + b]; };
    var hasil = [cek('Status', [APP.STATUS.ACTIVE, APP.STATUS.PAUSE, APP.STATUS.PENDING], function (r) { return isOpen_(r) || r['Status'] === APP.STATUS.PENDING; }),
      cek('Status review', [APP.REVIEW.NEEDED], function (r) { return r['Status review'] === APP.REVIEW.NEEDED; }),
      cek('Status', [APP.STATUS.COMPLETED], function (r) { return r['Status'] === APP.STATUS.COMPLETED; }),
      cek('Status', ['Cancel'], function (r) { return r['Status'] === 'Cancel'; })];   // seluruh sel: "Cancel" ≠ "Cancelled"
    R.ok('TextFinder regex + seluruh sel = baca penuh (Apps Script asli)', hasil.every(function (x) { return x[0]; }), hasil.map(function (x) { return x[1]; }).join(' · '));
  });
  R.safe('Teks bebas tetap teks', function () {   // 2.6.2: ditulis dengan awalan ' → Sheets menyimpannya sebagai teks, tanpa tanda itu
    var cols = ['Detail masalah', 'Detail penyebab', 'Detail penanganan'], dates = 0, quoted = 0, risky = 0, ex = '';
    readTable_(APP.SHEETS.MAINT).forEach(function (r) {
      cols.forEach(function (c) {
        var v = r[c];
        if (v instanceof Date) { dates++; ex = ex || r['Maintenance ID'] + ' · ' + c; }
        else if (typeof v === 'string') { if (v.charAt(0) === "'") quoted++; if (cellText_(v) !== v) risky++; }
      });
    });
    R.ok('Detail mirip jam / angka / rumus tersimpan sebagai teks (tanpa tanda \' terlihat)', !dates && !quoted && risky > 0,
      risky + ' sel berisiko tetap teks · ' + dates + ' berubah jadi tanggal' + (ex ? ' (mis. ' + ex + ')' : '') + ' · ' + quoted + ' menampilkan tanda \'');
  });
  UJT_.meta.years.forEach(function (yr) {
    R.safe('Laporan ' + yr, function () {
      var sh = ss.getSheetByName(laporanName_(yr));
      if (!R.ok('Laporan ' + yr + ': tab ada', !!sh, '')) return;
      var v = sh.getDataRange().getValues(), d = sh.getDataRange().getDisplayValues(), w = v[1].length - 1, act = {}, disp = {};
      for (var i = 2; i < v.length; i++) if (v[i][w]) { act[v[i][w]] = v[i].slice(0, w); disp[v[i][w]] = d[i].slice(0, w); }
      var exp = {}, L = { head: E.laporanHead[yr], rows: ujtRowsOf_('lap:' + yr) };
      L.rows.forEach(function (r) { exp[r[r.length - 1]] = r.slice(0, r.length - 1); });
      R.ok('Laporan ' + yr + ': jumlah baris', Object.keys(act).length === L.rows.length, Object.keys(act).length + ' (harap ' + L.rows.length + ')');
      ujtTabel_(R, 'Laporan ' + yr + ': isi semua sel', exp, act, disp, L.head, { kind: L.head.map(function (x) { return /Tanggal/.test(x) ? 'tgl' : ''; }) });
    });
  });
  UJT_.meta.years.forEach(function (yr) {
    R.safe('KPI ' + yr, function () {
      var sh = ss.getSheetByName(kpiName_(yr));
      if (!R.ok('KPI ' + yr + ': tab ada', !!sh, '')) return;
      var v = sh.getDataRange().getValues(), head = v[0], act = {}, exp = {};
      var key = function (r) { return ujtNorm_(r[0]) + ' · ' + r[1] + ' · ' + r[2]; };
      v.slice(1).forEach(function (r) { if (r[0]) act[key(r)] = r; });
      ujtRowsOf_('kpi:' + yr).forEach(function (r) { exp[key(r)] = r; });
      ujtTabel_(R, 'KPI ' + yr + ': semua bulan × Plant / Project / Line', exp, act, null, head, {
        skip: function (k, j) { return j === 11 || (!sameDay && k.indexOf(curKey) === 0 && (j === 7 || j === 8 || j === 10 || j === 12)); }
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
    // overdueNow tergantung jam sekarang (pending yang tenggatnya lewat sesudah data dibuat), jadi tidak dibandingkan
    var tetap = function (k) { var o = JSON.parse(JSON.stringify(k)); delete o.overdueNow; return JSON.stringify(o); };
    var d = tetap(apiDashboard({ periode: 'ytd' }).kpi), e = tetap(E.dashboard);
    R.ok('Dashboard tahun ini = mock', d === e, d.slice(0, 600) + (d === e ? '' : '\nharap ' + e.slice(0, 600)));
  });
  return R.selesai(UJT_DUA_ ? 'Lanjut menu 6b.' : 'Lanjut menu 7.');
}

// ---------- 7 · arsip ----------

function ujtArsip() {
  var R = ujtRunner_(7), y0 = UJT_.meta.year - 1, ids = [];
  resetMaster_();
  R.safe('Arsip ' + y0, function () {
    var w = apiDashboard({ periode: 30 }).warnings || [];
    R.ok('Dashboard memperingatkan data ' + y0 + ' belum diarsipkan', w.some(function (x) { return /belum diarsipkan/.test(x); }), w.join(' · '));
    var a = R.timed('Arsipkan data ' + y0, UJT_BATAS_.malam, function () { return arsipkanTahun_(y0); });
    R.ok('Arsip: ' + UJT_.meta.arsip + ' pekerjaan dipindah', a.v.maintenance === UJT_.meta.arsip, JSON.stringify({ maintenance: a.v.maintenance, log: a.v.log, sparepart: a.v.sparepart }));
    resetMaster_();
    R.info('Maintenance setelah arsip', readTable_(APP.SHEETS.MAINT).length + ' baris');
  });
  if (UJT_DUA_) return R.selesai('Lanjut menu 7b.');   // arsip 2 tahun ±3 menit: tombol & layar di menu sendiri
  // arsip ±90 dtk: layar diukur 2× (bukan 3×) supaya tahap ini tetap ≤ 6 menit
  ujtSesudahArsip_(R);
  return R.selesai('Coba aplikasi di HP, lalu menu 8.');
}

function ujtSesudahArsip_(R) {
  var ids = [];
  try { ujtProfPasang_(true); ids = ujtAlur_(R, 'setelah arsip', UJT_DUA_ ? { layar: false } : { ulangLayar: 2 }); } finally {
    ujtCacheInfo_(R, ' (setelah arsip)');
    ujtProfLepas_();
    R.safe('Bersihkan data uji', function () { ujtBersih_(ids, R); });
  }
}

function ujtTombolArsip() {
  var R = ujtRunner_(7.5);
  resetMaster_();
  ujtSesudahArsip_(R);
  return R.selesai('Lanjut menu 7d.');
}

// ---------- 9 · profil tombol (diagnosis) ----------

/**
 * Rincian waktu per fungsi untuk tiap aksi (tahap 4 hanya memberi total). Fungsi global dibungkus pengukur selama menu ini:
 * waktu INKLUSIF (fungsi di dalam fungsi lain ikut terhitung di keduanya), ×n = jumlah panggilan.
 * Putaran 2 juga membaca beberapa sel tab berumus sesudah tiap aksi (= menunggu hitung ulang rumus akibat tulisan tadi).
 */
// { cur: {kunci: [ms, n]}, probe: bool, asli: {nama: fungsi}, lambat: bool, kosong: [label], n: jumlah aksi }
// lambat = tahap 4/7: rincian hanya untuk sampel di atas batas + cek cache master sebelum tiap aksi
var UJT_PROF_ = null;
var UJT_PROF_FN_ = ['readTable_', 'readTail_', 'readOptional_', 'buildMaster_', 'readMasterCache_', 'writeMasterCache_', 'masterData_',
  'requireUser_', 'userNameMap_', 'writeObj_', 'appendObj_', 'log_', 'syncReports_', 'syncLaporan_', 'usageRows_', 'lineView_', 'serialize_',
  'bootstrap_', 'validateParts_', 'ensureMaintColumns_', 'setNames_', 'checkTimeouts'];
var UJT_PROF_ARG_ = { readTable_: 1, readTail_: 1, readOptional_: 1, writeObj_: 1, appendObj_: 1 };   // kunci per nama tab

function ujtProfAdd_(k, ms) {
  if (!UJT_PROF_ || !UJT_PROF_.cur) return;
  var x = UJT_PROF_.cur[k] || (UJT_PROF_.cur[k] = [0, 0]);
  x[0] += ms; x[1]++;
}

function ujtProfPasang_(lambat) {
  var G = globalThis, asli = {};
  UJT_PROF_ = { cur: null, probe: false, asli: asli, lambat: !!lambat, kosong: [], n: 0 };
  UJT_PROF_FN_.forEach(function (name) {
    var f = G[name];
    if (typeof f !== 'function') return;
    asli[name] = f;
    G[name] = function () {
      var t = Date.now();
      try { return f.apply(this, arguments); } finally { ujtProfAdd_(UJT_PROF_ARG_[name] ? name + '(' + arguments[0] + ')' : name, Date.now() - t); }
    };
  });
  // kunci dipecah: tunggu kunci · isi · flush (flush = tulisan diterapkan; sering menunggu hitung ulang rumus)
  asli.withLock_ = G.withLock_;
  G.withLock_ = function (fn) {
    var t0 = Date.now(), lock = LockService.getScriptLock();
    if (!lock.tryLock(APP.LOCK_TIMEOUT_MS)) throw new Error('Server sedang sibuk, coba lagi beberapa detik.');
    ujtProfAdd_('kunci: tunggu', Date.now() - t0);
    var t1 = Date.now();
    try { return fn(); } finally {
      ujtProfAdd_('kunci: isi', Date.now() - t1);
      var t2 = Date.now();
      SpreadsheetApp.flush();
      ujtProfAdd_('flush', Date.now() - t2);
      lock.releaseLock();
    }
  };
}

/** Tahap 4/7: berapa aksi yang mendapati cache master sudah kosong (dugaan: trigger onMasterChange menghapusnya). */
function ujtCacheInfo_(R, tag) {
  var P = UJT_PROF_;
  if (!P || !P.lambat) return;
  R.info('Cache master kosong sebelum aksi (selain "buka pertama")' + tag, P.kosong.length + ' dari ' + P.n + ' aksi' +
    (P.kosong.length ? ': ' + P.kosong.join(' · ') : ''));
}

function ujtProfLepas_() {
  if (!UJT_PROF_) return;
  var asli = UJT_PROF_.asli;
  Object.keys(asli).forEach(function (n) { globalThis[n] = asli[n]; });
  UJT_PROF_ = null;
}

/** "total 5757 ms · kunci: isi 3900 · readTable_(Maintenance) 2100 · …" (≥ 20 ms, terbesar dulu). */
function ujtProfTeks_(p, total) {
  var keys = Object.keys(p || {}).sort(function (a, b) { return p[b][0] - p[a][0]; });
  return 'total ' + total + ' ms · ' + keys.filter(function (k) { return p[k][0] >= 20; }).slice(0, 16).map(function (k) {
    return k + ' ' + p[k][0] + (p[k][1] > 1 ? ' ×' + p[k][1] : '');
  }).join(' · ');
}

/** Sesudah aksi: baca blok kecil di tab berumus (menunggu hitung ulang FILTER / COUNTIFS akibat tulisan aksi tadi). */
function ujtProbe_(R, label) {
  var ss = SpreadsheetApp.getActive(), out = [];
  // Ringkasan & Pending Work dibaca seluruhnya = menunggu SEMUA rumusnya; tab besar cukup 5×5 sel
  [['Ringkasan', 1], ['Pending Work', 1], ['Maintenance Limo7', 0], [laporanName_(UJT_.meta.year), 0]].forEach(function (x) {
    var sh = ss.getSheetByName(x[0]);
    if (!sh) return;
    var t = Date.now();
    (x[1] ? sh.getDataRange() : sh.getRange(1, 1, Math.min(5, sh.getMaxRows()), Math.min(5, sh.getMaxColumns()))).getValues();
    out.push(x[0] + (x[1] ? ' (penuh) ' : ' ') + (Date.now() - t));
  });
  R.info('Rumus sesudah: ' + label, 'baca (ms): ' + out.join(' · '));
}

/** Biaya baca Maintenance per bentuk (3× masing-masing): dasar memilih perbaikan. */
function ujtUkurBaca_(R) {
  var ss = SpreadsheetApp.getActive(), sh = sheet_(APP.SHEETS.MAINT), last = sh.getLastRow(), lc = sh.getLastColumn();
  var id = String(sh.getRange(Math.max(2, last - 300), 1).getValue());
  var ukur = function (label, fn, n) {
    var ts = [];
    for (var i = 0; i < (n || 3); i++) { var t = Date.now(); fn(); ts.push(Date.now() - t); }
    R.info('Ukur: ' + label, ts.join(' / ') + ' ms', ts.slice().sort(function (a, b) { return a - b; })[Math.floor(ts.length / 2)]);
  };
  ukur('Maintenance penuh ' + (last - 1) + ' baris × ' + lc + ' kolom (getDataRange)', function () { sh.getDataRange().getValues(); });
  ukur('Maintenance kolom A:G saja', function () { sh.getRange(1, 1, last, 7).getValues(); });
  ukur('Maintenance kolom ID saja', function () { sh.getRange(1, 1, last, 1).getValues(); });
  ukur('Maintenance 1 baris penuh', function () { sh.getRange(last, 1, 1, lc).getValues(); });
  ukur('TextFinder: cari 1 ID di kolom A', function () { sh.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext(); });
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  ukur('Ubah ' + (vals.length - 1) + ' baris jadi object (JS saja, tanpa Sheets)', function () { rowsToObjs_(h, vals.slice(1), 2); });
  var L = ss.getSheetByName(laporanName_(UJT_.meta.year));
  if (L) ukur('Laporan: kolom kunci ' + (L.getLastRow() - 1) + ' baris', function () { L.getRange(2, L.getLastColumn(), L.getLastRow() - 1, 1).getValues(); });
  ukur('Log: getLastRow', function () { sheet_(APP.SHEETS.LOG).getLastRow(); });
  ukur('Cache master (CacheService)', function () { resetMaster_(); readMasterCache_(); });
  ukur('Bangun master dari sheet (tanpa cache)', function () { resetMaster_(); resetHeaders_(); buildMaster_(); }, 1);   // ±9 dtk: sekali saja
}

function ujtProfil() {
  var R = ujtRunner_(9), ids = [];
  resetMaster_();
  try {
    R.safe('Pengukur dipasang', function () {
      ujtProfPasang_();
      UJT_PROF_.cur = {};
      readOptional_(APP.SHEETS.FACTORY);   // dipanggil lewat nama global → harus tercatat
      R.ok('Pengukur fungsi aktif (pembungkus global berlaku)', !!UJT_PROF_.cur['readTable_(Factory)'], JSON.stringify(UJT_PROF_.cur));
    });
    ids = ids.concat(ujtAlur_(R, 'profil 1'));
    UJT_PROF_.probe = true;
    ids = ids.concat(ujtAlur_(R, 'profil 2 + cek rumus', { layar: false }));
    UJT_PROF_.probe = false;
    UJT_PROF_.cur = null;
    R.safe('Ukur baca Maintenance', function () { ujtUkurBaca_(R); });
  } finally {
    ujtProfLepas_();
    R.safe('Bersihkan data uji', function () { ujtBersih_(ids, R); });
  }
  return R.selesai('Kirim "sudah" ke Claude.');
}

// ---------- 8 · selesai ----------

// ---------- 10 · kapasitas ----------

/**
 * Batas Google Sheets: 10 juta sel per file, termasuk sel kosong (baris / kolom yang sudah ada). Dihitung maxRows × maxColumns
 * semua tab; proyeksi = pertumbuhan per tahun data dikali tahun. Jalankan sesudah menu 6 dan sesudah menu 7 (arsip).
 */
function ujtKapasitas() {
  var ss = SpreadsheetApp.getActive(), BATAS = 10000000, sesudah = !!ss.getSheetByName(archiveName_(UJT_.meta.year - 1));
  var R = ujtRunner_(sesudah ? 7.9 : 6.5);   // 6b sebelum arsip tahun lalu, 7c sesudah (dua hasil tersimpan berdampingan)
  if (!sesudah) R.safe('Tab backup (2.6.6)', function () {   // seperti trigger 03:00: minggu & bulan lalu, lalu dihapus lagi (tidak ikut terhitung)
    var props = PropertiesService.getDocumentProperties(), simpan = props.getProperty(BACKUP_PROP_);
    var ada = {};
    ss.getSheets().forEach(function (sh) { ada[sh.getName()] = true; });
    var t = R.timed('Buat tab backup minggu & bulan lalu (trigger harian 03:00)', 120000, function () { return backupJalan_(new Date(), true); });
    var baru = ss.getSheets().filter(function (sh) { return BACKUP_RE_.test(sh.getName()) && !ada[sh.getName()]; });
    R.ok('Tab backup dibuat (format Laporan, pas isi)', baru.length >= 1, t.v.join(' · ') + ' · ' +
      baru.map(function (sh) { return sh.getName() + ' ' + sh.getMaxRows() + ' × ' + sh.getMaxColumns() + ' = ' + sh.getMaxRows() * sh.getMaxColumns() + ' sel'; }).join(' · '));
    baru.forEach(function (sh) { ss.deleteSheet(sh); });
    if (simpan === null) props.deleteProperty(BACKUP_PROP_); else props.setProperty(BACKUP_PROP_, simpan);
  });
  R.safe('Kapasitas', function () {
    var tabs = ss.getSheets().map(function (sh) {
      var r = sh.getMaxRows(), c = sh.getMaxColumns(), lr = sh.getLastRow(), lc = sh.getLastColumn();
      return { n: sh.getName(), sel: r * c, isi: lr * lc, r: r, c: c, lr: lr };
    });
    var total = 0, isi = 0, master = 0;
    tabs.forEach(function (t) { total += t.sel; isi += t.isi; if (/^(Users|Factory|Projects|Lines|Sparepart|Pilihan|Form|Config|Format Laporan|Catatan Panduan)$/.test(t.n)) master += t.sel; });
    tabs.sort(function (a, b) { return b.sel - a.sel; });
    var pct = function (x) { return Math.round(x / BATAS * 1000) / 10 + '%'; }, fmt = function (x) { return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
    R.info('Keadaan', sesudah ? 'SESUDAH arsip ' + (UJT_.meta.year - 1) : 'SEBELUM arsip ' + (UJT_.meta.year - 1) + ' (admin terlambat mengarsip)');
    R.info('Sel di file ini (dihitung Google, termasuk kosong)', fmt(total) + ' dari 10.000.000 (' + pct(total) + ') · berisi data ' + fmt(isi) + ' · kosong ' + fmt(total - isi) + ' · ' + tabs.length + ' tab');
    R.info('6 tab terbesar', tabs.slice(0, 6).map(function (t) { return t.n + ' ' + fmt(t.sel) + ' (' + fmt(t.r) + ' baris × ' + t.c + ', terisi ' + fmt(t.lr) + ')'; }).join(' · '));
    var tahun = (UJT_.meta.days || 365) / 365, perTahun = Math.max(0, total - master) / tahun;
    R.info('Proyeksi (pertumbuhan ±' + fmt(Math.round(perTahun)) + ' sel / tahun data)', [3, 5, 8].map(function (k) {
      var v = Math.round(master + perTahun * k); return 'tahun ke-' + k + ': ' + fmt(v) + ' (' + pct(v) + ')'; }).join(' · ') +
      ' · penuh sesudah ±' + Math.floor((BATAS - master) / Math.max(1, perTahun)) + ' tahun');
    var boros = tabs.filter(function (t) { return t.r - t.lr > 2000; });
    R.info('Tab dengan > 2.000 baris kosong', boros.length ? boros.map(function (t) { return t.n + ' ' + fmt(t.r - t.lr) + ' baris × ' + t.c; }).join(' · ') : 'tidak ada');
    R.ok('Kapasitas sesudah ' + Math.round(tahun * 10) / 10 + ' tahun data < 50% batas', total < BATAS / 2, pct(total));
  });
  return R.selesai(sesudah ? 'Lanjut menu 9 (opsional) atau kirim "sudah" ke Claude.' : 'Lanjut menu 7.');
}

// ---------- 11 · malam Januari ----------

/**
 * Trigger malam di bulan Januari = refreshRekap dengan tahun lalu ikut dibangun ulang (Laporan, Rekap, KPI). Urutan sama dengan
 * src/Rekap.js refreshRekap. Satu eksekusi; dihentikan sendiri di 330 dtk supaya hasilnya sempat tercatat (batas Apps Script 360).
 */
function ujtJanuari() {
  var R = ujtRunner_(3.5), y = UJT_.meta.year, total = 0, stop = false;
  resetMaster_();
  var langkah = [['Cek urutan Maintenance + Rekap + Laporan ' + y + ' (di dalam lock)', function () { return withLock_(function () { urutkanMaintenance_(new Date()); buildRekap_(y); return buildLaporan_(y); }); }],
    ['Rekap + Laporan ' + (y - 1) + ' (Januari)', function () { return withLock_(function () { buildRekap_(y - 1); return buildLaporan_(y - 1); }); }],
    ['TPM', function () { return buildTpm_(); }],
    ['KPI ' + y + ' + KPI ' + (y - 1) + ' (Januari) + tutup bulan otomatis', function () { buildKpi_(y); buildKpi_(y - 1); return kpiTutupOtomatis_(); }],
    ['rapikan tampilan', function () { return rapikanTampilan_({}); }]];
  R.safe('Malam Januari', function () {
    langkah.forEach(function (l) {
      if (stop) { R.ok('Malam Januari: ' + l[0], false, 'TIDAK SEMPAT: waktu eksekusi habis (di produksi tahap ini tidak jalan malam itu)'); return; }
      total += R.timed('Malam Januari: ' + l[0], 0, l[1]).ms;
      if (Date.now() - R.t0 > 330000) stop = true;
    });
    R.ok('Trigger malam Januari total ≤ ' + UJT_BATAS_.januari / 1000 + ' dtk (batas Apps Script 360)', !stop && total <= UJT_BATAS_.januari, Math.round(total / 1000) + ' dtk', total);
  });
  return R.selesai('Lanjut menu 4.');
}

function ujtSelesai() {
  var R = ujtRunner_(8), n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  R.ok('Trigger uji dihapus', true, n + ' trigger milik akun ini di proyek uji (supaya tidak memakai kuota 90 menit/hari yang sama dengan Bogor). Web app tetap bisa dibuka; Run setup untuk menyalakannya lagi.');
  return R.selesai('Uji selesai. Kirim "sudah" ke Claude.');
}

// ---------- 6c · admin ceroboh (2.6.9) ----------

var UJT_SELESAI_ = function () {
  return { values: { 'Jenis kerusakan': 'Program', Masalah: 'Robot stuck / alarm', Penyebab: 'Posisi robot / servo hilang', Penanganan: 'Ganti part',
    'Detail masalah': 'Uji beban: robot stuck', 'Detail penanganan': 'Ganti sensor dan baut' }, parts: UJT_.meta.parts, pics: [UJT_.meta.pic] };
};

function ujtLineUji_(id, nama) {
  var L = findSheet_('Lines'), h = headers_(L, 'Lines');
  if (lineOf_(masterData_(), id)) return;
  L.appendRow(objToRow_(h, { 'Line ID': id, 'Nama Line': nama || 'Line uji (dihapus otomatis)', 'Proses': 'Modul Line', 'Factory ID': 'F1', 'Baterai': 'Limo7', 'Area': '-', 'Aktif': 'Ya' }));
  invalidateMaster_(); resetMaster_();
}

/**
 * Yang wajar dilakukan admin di spreadsheet: mengurutkan tab Maintenance per Line, menyaring, menyisipkan kolom "No." di kiri
 * (juga di Users), menyisipkan kolom catatan di tengah, mengetik di bawah data. Sesudahnya aplikasi harus tetap benar:
 * login, ID baru unik, nilai masuk kolom yang benar, Laporan lengkap; malam mengurutkan ulang. Lalu tab dipulihkan + menu 6d.
 */
function ujtCeroboh() {
  var R = ujtRunner_(6.6), ss = SpreadsheetApp.getActive(), ids = [], B = UJT_BATAS_, SAMPAH = 'cek lagi besok (admin)';
  resetMaster_();
  var sh = sheet_(APP.SHEETS.MAINT), U = findSheet_(APP.SHEETS.USERS, ss), n0 = readTable_(APP.SHEETS.MAINT).length;
  var act = function (fn, args) { resetMaster_(); resetHeaders_(); return apiAct(fn, args, ujtRid_()); };
  var mulai = function () { return act('apiStart', [UJT_LINE_, { baterai: 'Limo7', stopLine: 'Ya' }]); };
  ujtLineUji_(UJT_LINE_);
  try {
    R.safe('Dua pekerjaan hari ini di line uji', function () {
      for (var k = 0; k < 2; k++) { var id = mulai().open.id; ids.push(id); act('apiComplete', [id, UJT_SELESAI_()]); }
      R.info('ID hari ini', ids.join(', '));
    });
    R.safe('Admin mengurutkan tab per Line (Z→A) + menyaring', function () {
      var h = headers_(sh, APP.SHEETS.MAINT);
      R.timed('Urutkan tab Maintenance per Line (Data → Sort range)', 0, function () {
        return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).sort({ column: h.indexOf('Line') + 1, ascending: false });
      });
      var f = sh.getFilter();
      if (f) f.setColumnFilterCriteria(h.indexOf('Status') + 1, SpreadsheetApp.newFilterCriteria().setHiddenValues([APP.STATUS.CANCELLED]).build());
      R.info('Filter', f ? 'baris Cancelled disembunyikan lewat filter tab' : 'tab tanpa filter');
    });
    R.safe('Admin menyisipkan kolom (kiri & tengah, juga di Users) + mengetik di bawah data', function () {
      sh.insertColumnBefore(1); sh.getRange(1, 1).setValue('No.'); sh.getRange(2, 1, 5, 1).setValues([[1], [2], [3], [4], [5]]);
      resetHeaders_();
      var c = headers_(sh, APP.SHEETS.MAINT).indexOf('Status') + 1;
      sh.insertColumnAfter(c); sh.getRange(1, c + 1).setValue('Catatan admin');
      sh.getRange(sh.getLastRow() + 3, 3).setValue(SAMPAH);
      U.insertColumnBefore(1); U.getRange(1, 1).setValue('No.');
      resetHeaders_(); invalidateMaster_(); resetMaster_();
    });
    R.safe('Aplikasi tetap benar', function () {
      var boot = R.timed('Buka aplikasi (Users bergeser 1 kolom)', B.layar, function () { invalidateMaster_(); resetMaster_(); return apiBootstrap('', '', {}); });
      R.ok('Login & peran tetap terbaca', boot.v && boot.v.user && boot.v.user.role === APP.ROLES.ADMIN, boot.v && boot.v.user ? boot.v.user.email + ' · ' + boot.v.user.role : 'gagal');
      var id3 = R.timed('Mulai sesudah tab diurutkan (ID harus unik)', B.tombol, mulai).v.open.id;
      ids.push(id3);
      R.timed('Selesai + 2 part + PIC (kolom bergeser)', B.tombol, function () { return act('apiComplete', [id3, UJT_SELESAI_()]); });
      resetHeaders_();
      var M = readTable_(APP.SHEETS.MAINT), seen = {}, dobel = [];
      M.forEach(function (r) { var k = String(r['Maintenance ID']); if (seen[k]) dobel.push(k); seen[k] = true; });
      R.ok('ID baru unik walau tab diurutkan', ids.indexOf(id3) === 2 && ids.slice(0, 2).indexOf(id3) === -1, id3 + ' · sebelumnya ' + ids.slice(0, 2).join(', '));
      R.ok('Tidak ada ID dobel di seluruh tab', !dobel.length, dobel.length ? dobel.slice(0, 5).join(', ') : M.length + ' ID unik');
      R.ok('Jumlah pekerjaan = sebelum + 3 (baris ketikan admin tidak terbaca sebagai pekerjaan)', M.length === n0 + 3, M.length + ' (harap ' + (n0 + 3) + ')');
      var r3 = findById_(M, id3);
      R.ok('Nilai masuk kolom yang benar (menurut nama kolom)', !!r3 && r3['Line'] === UJT_LINE_ && r3['Status'] === APP.STATUS.COMPLETED && r3['No.'] === '' && r3['Catatan admin'] === '',
        r3 ? r3['Line'] + ' · ' + r3['Status'] + ' · No.="' + r3['No.'] + '" · Catatan admin="' + r3['Catatan admin'] + '"' : 'tidak ada');
      R.timed('Dashboard 30 hari (tab bergeser & diurutkan)', B.layar, function () { return apiDashboard({ periode: 30 }); });
      var t = R.timed('Malam: cek urutan → urutkan ulang (di dalam lock)', 60000, function () { return withLock_(function () { return urutkanMaintenance_(new Date()); }, MALAM_LOCK_MS_); });
      R.ok('Malam mendeteksi tab tidak urut dan mengurutkan ulang', t.v === true, String(t.v));
      resetHeaders_();
      var cm = headers_(sh, APP.SHEETS.MAINT).indexOf('Mulai'), prev = 0, turun = 0;
      sh.getRange(2, cm + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (v) { if (v[0] instanceof Date) { if (v[0].getTime() < prev) turun++; else prev = v[0].getTime(); } });
      R.ok('Sesudah malam: kolom Mulai urut naik (ekor tab = pekerjaan terbaru lagi)', !turun, turun + ' baris turun');
      R.timed('Laporan dibangun ulang (kolom bergeser)', B.malam, function () { return withLock_(function () { return buildLaporan_(UJT_.meta.year); }); });
      var lap = ss.getSheetByName(laporanName_(UJT_.meta.year)), ada = lap ? lap.createTextFinder(id3).matchEntireCell(true).findNext() : null;
      R.ok('Laporan memuat pekerjaan baru', !!ada, ada ? 'baris ' + ada.getRow() : 'tidak ada');
    });
  } finally {
    R.safe('Pulihkan tab (kolom sisipan, filter, ketikan) + hapus data uji', function () {
      resetHeaders_();
      var f = sh.getFilter(), cs = headers_(sh, APP.SHEETS.MAINT).indexOf('Status');
      if (f && cs >= 0) f.removeColumnFilterCriteria(cs + 1);
      ['Catatan admin', 'No.'].forEach(function (name) { resetHeaders_(); var c = headers_(sh, APP.SHEETS.MAINT).indexOf(name); if (c >= 0) sh.deleteColumn(c + 1); });
      sh.createTextFinder(SAMPAH).matchEntireCell(true).findAll().forEach(function (rg) { rg.clearContent(); });
      resetHeaders_();
      if (headers_(U, APP.SHEETS.USERS)[0] === 'No.') U.deleteColumn(1);
      resetHeaders_(); invalidateMaster_(); resetMaster_();
      ujtBersih_(ids, R);
    });
  }
  return R.selesai('Lanjut menu 6d (periksa isi lagi: harus sama seperti menu 6).');
}

// ---------- 6e / 6f · serbuan: tombol bersamaan dari banyak HP (2.6.9) ----------

var UJT_SERBU_ = 'UJT_SERBU', UJT_SERBU_N_ = 6;

/**
 * 6 teknisi menekan Mulai lalu Selesai di detik yang sama (listrik turun, 6 line berhenti), lalu pembaruan malam memegang lock
 * sementara 2 teknisi shift malam menekan Mulai. Tiap teknisi = eksekusi sendiri (trigger), seperti HP yang berbeda.
 */
function ujtSerbuan() {
  var R = ujtRunner_(6.8), props = PropertiesService.getDocumentProperties(), techs = (UJT_.meta.pics15 || []).slice(0, UJT_SERBU_N_ + 2);
  resetMaster_();
  R.safe('Siapkan', function () {
    if (techs.length < UJT_SERBU_N_ + 2) throw new Error('Teknisi di data uji kurang dari ' + (UJT_SERBU_N_ + 2));
    ScriptApp.getProjectTriggers().forEach(function (t) { if (/^ujtSerbu/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t); });
    Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf(UJT_SERBU_) === 0) props.deleteProperty(k); });
    var lines = [];
    for (var i = 1; i <= UJT_SERBU_N_; i++) { lines.push('UJI-S' + i); ujtLineUji_('UJI-S' + i, 'Line uji serbuan ' + i); }
    var at = Date.now() + 100000;
    props.setProperty(UJT_SERBU_, JSON.stringify({ at: at, malam: at + 120000, lines: lines, techs: techs, me: ujtMe_() }));
    for (var k = 0; k < UJT_SERBU_N_; k++) ScriptApp.newTrigger('ujtSerbuSlot').timeBased().after(30000).create();
    ScriptApp.newTrigger('ujtSerbuMalam').timeBased().after(150000).create();
    for (var m = 0; m < 2; m++) ScriptApp.newTrigger('ujtSerbuSlot').timeBased().after(150000).create();
    R.info('Jadwal', UJT_SERBU_N_ + ' teknisi menekan Mulai bersamaan pukul ' + Utilities.formatDate(new Date(at), APP.TZ, 'HH:mm:ss') +
      ' · pembaruan malam + 2 teknisi pukul ' + Utilities.formatDate(new Date(at + 120000), APP.TZ, 'HH:mm:ss') + ' · baca hasil (menu 6f) sesudah ±4 menit');
  });
  return R.selesai('Tunggu ±4 menit, lalu menu 6f.');
}

function ujtSerbuHapusSendiri_(e) {
  try { ScriptApp.getProjectTriggers().forEach(function (t) { if (e && t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t); }); } catch (x) { /* abaikan */ }
}

/** Satu "HP": ambil nomor slot, tunggu detik bersama, Mulai → Selesai sebagai teknisi itu. */
function ujtSerbuSlot(e) {
  ujtSerbuHapusSendiri_(e);
  var props = PropertiesService.getDocumentProperties(), plan = JSON.parse(props.getProperty(UJT_SERBU_) || 'null');
  if (!plan) return;
  var dl = LockService.getDocumentLock(), slot = -1;   // lock dokumen ≠ lock aplikasi (script lock) → tidak ikut mengantre
  if (dl.tryLock(30000)) {
    try { slot = Number(props.getProperty(UJT_SERBU_ + '_n') || 0); props.setProperty(UJT_SERBU_ + '_n', String(slot + 1)); } finally { dl.releaseLock(); }
  }
  if (slot < 0 || slot >= UJT_SERBU_N_ + 2) return;
  var malam = slot >= UJT_SERBU_N_, target = malam ? plan.malam + 15000 : plan.at;
  var tech = plan.techs[slot], line = plan.lines[malam ? slot - UJT_SERBU_N_ : slot], out = { slot: slot, tech: tech, line: line, malam: malam };
  out.telat = Date.now() - target;
  if (out.telat < 0) Utilities.sleep(-out.telat);
  currentEmail_ = function () { return tech; };   // HP teknisi itu (uji saja; produksi memakai Session)
  // seperti HP (2.6.9): "Server sedang sibuk" → dicoba ulang sekali sesudah 5 dtk dengan ID permintaan yang sama
  var coba = function (fn, args) {
    var rid = ujtRid_();
    try { return apiAct(fn, args, rid); } catch (e) {
      if (!/sedang sibuk/.test(String(e && e.message || e))) throw e;
      out.ulang = (out.ulang || 0) + 1;
      Utilities.sleep(5000); resetMaster_(); resetHeaders_();
      return apiAct(fn, args, rid);
    }
  };
  var t = Date.now();
  try {
    var v = coba('apiStart', [line, { baterai: 'Limo7', stopLine: 'Ya' }]);
    out.id = v.open.id; out.msMulai = Date.now() - t;
    if (!malam) { t = Date.now(); resetMaster_(); resetHeaders_(); coba('apiComplete', [out.id, UJT_SELESAI_()]); out.msSelesai = Date.now() - t; }
    else { resetMaster_(); resetHeaders_(); coba('apiCancel', [out.id, { values: { 'Alasan cancel': 'Input ganda' } }]); }
  } catch (err) { out.err = String(err && err.message || err).slice(0, 200); out.msGagal = Date.now() - t; }
  props.setProperty(UJT_SERBU_ + '_r' + slot, JSON.stringify(out));
}

/** Pembaruan malam (bagian di dalam lock) berjalan saat 2 teknisi shift malam menekan Mulai. */
function ujtSerbuMalam(e) {
  ujtSerbuHapusSendiri_(e);
  var props = PropertiesService.getDocumentProperties(), plan = JSON.parse(props.getProperty(UJT_SERBU_) || 'null');
  if (!plan) return;
  if (Date.now() < plan.malam) Utilities.sleep(plan.malam - Date.now());
  var t = Date.now(), out = {};
  try {
    withLock_(function () { out.mulaiLock = Date.now() - t; urutkanMaintenance_(new Date()); buildRekap_(UJT_.meta.year); buildLaporan_(UJT_.meta.year); }, MALAM_LOCK_MS_);
    out.ms = Date.now() - t;
  } catch (err) { out.err = String(err && err.message || err).slice(0, 200); }
  props.setProperty(UJT_SERBU_ + '_m', JSON.stringify(out));
}

function ujtSerbuanHasil() {
  var R = ujtRunner_(6.9), props = PropertiesService.getDocumentProperties(), ids = [];
  resetMaster_();
  R.safe('Serbuan ' + UJT_SERBU_N_ + ' tombol bersamaan', function () {
    var plan = JSON.parse(props.getProperty(UJT_SERBU_) || 'null');
    if (!R.ok('Jadwal serbuan ada (menu 6e sudah dijalankan)', !!plan, '')) return;
    var res = [];
    for (var i = 0; i < UJT_SERBU_N_ + 2; i++) { var x = props.getProperty(UJT_SERBU_ + '_r' + i); if (x) res.push(JSON.parse(x)); }
    var siang = res.filter(function (r) { return !r.malam; }), malam = res.filter(function (r) { return r.malam; });
    res.forEach(function (r) { if (r.id) ids.push(r.id); });
    R.info('Trigger terlambat dari detik bersama', res.map(function (r) { return 'slot ' + r.slot + ' ' + Math.round(r.telat / 1000) + ' dtk'; }).join(' · '));
    var okS = siang.filter(function (r) { return r.id && r.msSelesai != null && !r.err; });
    R.ok(UJT_SERBU_N_ + ' teknisi Mulai + Selesai bersamaan: semua tersimpan (HP mencoba ulang sekali bila "sibuk")', siang.length === UJT_SERBU_N_ && okS.length === UJT_SERBU_N_,
      siang.map(function (r) { return r.line + ': ' + (r.err ? 'GAGAL ' + r.err : r.id + ' Mulai ' + r.msMulai + ' ms · Selesai ' + r.msSelesai + ' ms' + (r.ulang ? ' (dicoba ulang ' + r.ulang + '×)' : '')); }).join('\n'));
    var maxMs = Math.max.apply(null, okS.map(function (r) { return Math.max(r.msMulai, r.msSelesai); }).concat([0]));
    R.ok('Terlama menunggu (antre + coba ulang) ≤ 60 dtk', maxMs <= 60000, maxMs + ' ms · ' + okS.filter(function (r) { return r.ulang; }).length + ' dari ' + okS.length + ' perlu coba ulang', maxMs);
    resetHeaders_();
    var M = readTable_(APP.SHEETS.MAINT), seen = {}, dobel = 0;
    M.forEach(function (r) { var k = String(r['Maintenance ID']); if (seen[k]) dobel++; seen[k] = true; });
    var log = {};
    readTable_(APP.SHEETS.LOG).forEach(function (r) { var k = String(r['Maintenance ID']); if (ids.indexOf(k) !== -1) (log[k] = log[k] || []).push(r['Kejadian']); });
    R.ok('ID unik & Log lengkap untuk semua tombol serbuan', !dobel && okS.every(function (r) { return (log[r.id] || []).join(',') === 'start,complete'; }),
      dobel + ' ID dobel · ' + okS.map(function (r) { return r.id + ' ' + (log[r.id] || []).join(','); }).join(' · '));
    var m = JSON.parse(props.getProperty(UJT_SERBU_ + '_m') || 'null');
    R.info('Pembaruan malam memegang lock (Rekap + Laporan ' + UJT_.meta.year + ')', m ? (m.err ? 'GAGAL ' + m.err : m.ms + ' ms') : 'tidak jalan', m && m.ms);
    R.info('Tombol saat pembaruan malam (aplikasi menunggu lock ≤ 25 dtk, HP mencoba ulang otomatis sekali)', malam.map(function (r) {
      return r.tech + ' ' + r.line + ': ' + (r.err ? (/sibuk/.test(r.err) ? '"Server sedang sibuk" sesudah ' + r.msGagal + ' ms' : 'GAGAL ' + r.err) : 'tersimpan dalam ' + r.msMulai + ' ms');
    }).join(' · ') || 'tidak jalan');
    R.ok('Tombol saat malam tidak merusak data (berhasil atau ditolak jelas, tanpa pekerjaan setengah jadi)', malam.length === 2 && malam.every(function (r) { return !r.err || /sibuk/.test(r.err); }),
      malam.map(function (r) { return r.err || 'ok'; }).join(' · '));
  });
  R.safe('Bersihkan', function () {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (/^ujtSerbu/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t); });
    Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf(UJT_SERBU_) === 0) props.deleteProperty(k); });
    ujtBersih_(ids, R);
  });
  return R.selesai('Lanjut menu 7.');
}

// ---------- ▶ jalankan semua otomatis (2.6.9) ----------

var UJT_RANTAI_ = 'UJT_RANTAI';
var UJT_LANGKAH_ = ['ujtIsi', 'ujtSetup', 'ujtSetupLalu', 'ujtMalam', 'ujtJanuari', 'ujtTombol', 'ujtLayar', 'ujtManual', 'ujtPeriksa', 'ujtKapasitas',
  'ujtCeroboh', 'ujtPeriksaUlang', 'ujtSerbuan', 'ujtSerbuanHasil', 'ujtArsip', 'ujtTombolArsip', 'ujtLayarArsip', 'ujtKapasitas'];
var UJT_FN_ = { ujtIsi: ujtIsi, ujtSetup: ujtSetup, ujtSetupLalu: ujtSetupLalu, ujtMalam: ujtMalam, ujtJanuari: ujtJanuari, ujtTombol: ujtTombol,
  ujtLayar: ujtLayar, ujtManual: ujtManual, ujtPeriksa: ujtPeriksa, ujtKapasitas: ujtKapasitas, ujtCeroboh: ujtCeroboh, ujtPeriksaUlang: ujtPeriksaUlang,
  ujtSerbuan: ujtSerbuan, ujtSerbuanHasil: ujtSerbuanHasil, ujtArsip: ujtArsip, ujtTombolArsip: ujtTombolArsip, ujtLayarArsip: ujtLayarArsip };
var UJT_SEWA_MS_ = 390000;   // > 6 menit (batas eksekusi Apps Script): sewa yang lebih tua = eksekusinya sudah dibunuh

/**
 * 2.6.10: hanya SATU eksekusi rantai / pemuat data pada satu waktu. Putaran 1 menjalankan dua rantai bersamaan: data uji
 * rusak (±6.000 baris hilang di pemuat) dan semua waktu terukur di bawah beban ganda. Lock dokumen (bukan lock aplikasi).
 * @param {boolean} ambil true = ambil (gagal bila dipegang eksekusi lain yang masih hidup), false = lepas
 */
function ujtSewa_(kunci, ambil) {
  var dl = LockService.getDocumentLock();
  if (!dl.tryLock(15000)) return false;
  try {
    var props = PropertiesService.getDocumentProperties(), v = Number(props.getProperty(kunci) || 0);
    if (!ambil) { props.deleteProperty(kunci); return true; }
    if (v && Date.now() - v < UJT_SEWA_MS_) return false;
    props.setProperty(kunci, String(Date.now()));
    return true;
  } finally { dl.releaseLock(); }
}

/** Satu klik: semua tahap berurutan, masing-masing eksekusi sendiri (≤ 6 menit) lewat trigger. Kemajuan di tab hasil & baris "Rantai". */
function ujtRantai() {
  var props = PropertiesService.getDocumentProperties(), me = ujtMe_(), ui = SpreadsheetApp.getUi();
  var lama = JSON.parse(props.getProperty(UJT_RANTAI_) || 'null');
  if (lama && Date.now() - lama.mulai < 3 * 3600000) {   // klik kedua tidak boleh memulai rantai kedua
    var tny = ui.alert('Uji otomatis sedang berjalan', 'Rantai yang dimulai ' + Math.round((Date.now() - lama.mulai) / 60000) + ' menit lalu masih berjalan (tahap ' +
      (lama.i + 1) + ' / ' + UJT_LANGKAH_.length + ').\n\nMulai ulang DARI AWAL (data uji dimuat ulang)? Pilih No untuk membiarkannya berjalan.', ui.ButtonSet.YES_NO);
    if (tny !== ui.Button.YES) return;
  }
  ['UJT_RANTAI_SEWA', 'UJT_ISI_SEWA', UJT_ISI_, UJT_MARK_].forEach(function (k) { props.deleteProperty(k); });
  props.setProperty('UJT_ME', me);
  props.setProperty(UJT_RANTAI_, JSON.stringify({ i: 0, mulai: Date.now(), ulang: 0, log: [] }));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'ujtRantaiJalan') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('ujtRantaiJalan').timeBased().after(10000).create();
  ui.alert('Uji 2 tahun berjalan otomatis (' + UJT_LANGKAH_.length + ' tahap, ±1,5–2 jam). Spreadsheet boleh ditutup; klik menu ini SEKALI saja.\n\n' +
    'Hasil muncul bertahap di tab "' + UJT_SHEET_ + '". Selesai = baris tahap 99 menyebut "Rantai selesai". Menu ■ untuk menghentikan.');
}

function ujtRantaiStop() {
  PropertiesService.getDocumentProperties().deleteProperty(UJT_RANTAI_);
  PropertiesService.getDocumentProperties().deleteProperty('UJT_RANTAI_SEWA');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (/^ujtRantaiJalan$|^ujtSerbu/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t); });
  SpreadsheetApp.getUi().alert('Jalankan otomatis dihentikan. Tahap yang sedang berjalan (bila ada) tetap diselesaikan.');
}

function ujtRantaiJalan(e) {
  ujtSerbuHapusSendiri_(e);
  if (!ujtSewa_('UJT_RANTAI_SEWA', true)) return;   // eksekusi rantai lain masih berjalan: yang ini keluar tanpa apa-apa
  try { ujtRantaiLangkah_(); } finally { ujtSewa_('UJT_RANTAI_SEWA', false); }
}

function ujtRantaiLangkah_() {
  var props = PropertiesService.getDocumentProperties(), st = JSON.parse(props.getProperty(UJT_RANTAI_) || 'null');
  if (!st) return;
  if (st.berjalan) {   // eksekusi sebelumnya dibunuh di batas 6 menit (penjaga menyalakan lagi): tahap itu dicatat GAGAL, lanjut
    st.log.push(st.berjalan + ': BERHENTI di batas waktu Apps Script (lihat baris GAGAL tahap itu)');
    if (st.berjalan !== 'ujtIsi' || st.ulang >= 12) st.i++; else st.ulang++;
    st.berjalan = null;
  }
  var name = UJT_LANGKAH_[st.i], me = props.getProperty('UJT_ME');
  if (!name) return;
  currentEmail_ = function () { return me; };   // trigger: Session bisa kosong → email pelaksana yang disimpan saat menu diklik
  st.berjalan = name;
  props.setProperty(UJT_RANTAI_, JSON.stringify(st));
  ScriptApp.newTrigger('ujtRantaiJalan').timeBased().after(420000).create();   // penjaga: tahap ini dibunuh → rantai tetap lanjut
  var hasil = '';
  try { hasil = String(UJT_FN_[name]()); } catch (err) { hasil = 'ERROR ' + (err && err.message || err); }
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'ujtRantaiJalan') ScriptApp.deleteTrigger(t); });
  st.berjalan = null;
  var ulang = name === 'ujtIsi' && /BELUM SELESAI/.test(hasil) && st.ulang < 12;
  if (ulang) st.ulang++; else st.i++;
  st.log.push(name + ': ' + hasil.slice(0, 160));
  if (!PropertiesService.getDocumentProperties().getProperty(UJT_RANTAI_)) return;   // dihentikan selama tahap berjalan
  var rusak = name === 'ujtIsi' && /TIDAK LENGKAP/.test(hasil);   // jangan menguji di atas data yang rusak
  if (rusak) { st.log.push('Rantai DIHENTIKAN: data uji tidak lengkap. Jalankan ▶ lagi (mulai dari awal).'); st.i = UJT_LANGKAH_.length; }
  var selesai = st.i >= UJT_LANGKAH_.length;
  props.setProperty(UJT_RANTAI_, JSON.stringify(st));
  var R = ujtRunner_(99);
  R.info('Rantai: ' + (selesai ? 'SELESAI' : 'tahap ' + st.i + ' / ' + UJT_LANGKAH_.length), st.log.join('\n').slice(-1900), Date.now() - st.mulai);
  R.selesai(selesai ? 'Rantai selesai ' + Math.round((Date.now() - st.mulai) / 60000) + ' menit. Kirim "sudah" ke Claude.' : 'berikutnya: ' + UJT_LANGKAH_[st.i]);
  if (selesai) { props.deleteProperty(UJT_RANTAI_); return; }
  ScriptApp.newTrigger('ujtRantaiJalan').timeBased().after(name === 'ujtSerbuan' ? 240000 : 15000).create();
}
