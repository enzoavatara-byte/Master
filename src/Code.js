/**
 * Entry point web app + setup + menu spreadsheet.
 */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var user;
  try {
    user = getCurrentUser_();
  } catch (err) {
    return renderMessage_('Konfigurasi belum lengkap', escapeHtml_(String(err.message || err)));
  }
  if (!user.authorized) {
    return renderMessage_('Access Denied',
      'Email <b>' + escapeHtml_(user.email || '(tidak terdeteksi)') + '</b> tidak terdaftar atau nonaktif. ' +
      'Hubungi Admin untuk didaftarkan.<br><br>该邮箱未注册或已停用，请联系管理员登记。');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  // Whitelist karakter: nilai ini ditanam ke <script> di Index.html.
  t.lineId = String(params.line || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 50);
  t.mesinId = String(params.mesin || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 50);
  // Data awal ditanam langsung di halaman: HP tidak perlu perjalanan kedua ke server sebelum tampil.
  var boot = null;
  try { boot = bootstrap_(user, t.lineId, t.mesinId, null); } catch (err) { console.warn('bootstrap di doGet gagal: ' + err); }
  t.boot = safeJson_(boot);
  var out = t.evaluate()
    .setTitle(appName_())
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  // 2.6.4: ikon shortcut layar utama HP (Config IKON_APLIKASI); alamat yang ditolak Google tidak menggagalkan halaman
  var ikon = '';
  try { ikon = String(getConfig_('IKON_APLIKASI') || '').trim(); } catch (err) { ikon = ''; }
  if (/^https:\/\/\S+$/.test(ikon)) { try { out.setFaviconUrl(ikon); } catch (err) { console.warn('IKON_APLIKASI ditolak: ' + err); } }
  return out;
}

/** JSON yang aman ditanam di dalam <script> (tidak bisa menutup tag script). */
function safeJson_(v) {
  return JSON.stringify(v === undefined ? null : v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function renderMessage_(title, htmlBody) {
  var out;
  try {
    var t = HtmlService.createTemplateFromFile('Message');
    t.title = title;
    t.body = htmlBody;
    out = t.evaluate();
  } catch (e) {
    // File HTML Message/Styles belum dibuat: pesan aslinya tetap tampil, tidak tertutup error "file tidak ditemukan".
    out = HtmlService.createHtmlOutput('<div style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px">' +
      '<h2>' + escapeHtml_(title) + '</h2><p>' + htmlBody + '</p><p style="color:#b7791f">Catatan admin: file HTML <b>Message</b> atau <b>Styles</b> ' +
      'belum ada di Apps Script (' + escapeHtml_(String(e.message || e)) + '). Buat file HTML dengan nama persis seperti di folder src.</p></div>');
  }
  return out.setTitle(appName_() + ' - ' + title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function onOpen() {
  var name = APP.NAME;
  try { name = appName_(); } catch (e) { /* belum setup: pakai nama default */ }
  SpreadsheetApp.getUi().createMenu(name)
    .addItem('Setup / perbaiki sheet & trigger', 'setup')
    .addItem('Jalankan cek 3/4 jam sekarang', 'checkTimeouts')
    .addSeparator()
    .addItem('Laporan & Rekap tahunan (buat / perbarui)…', 'menuRekapTahunan')
    .addItem('Perbarui tab TPM (format Excel manager)', 'menuTpm')
    .addItem('Perbarui tab KPI (MTTR & MTBF)', 'menuKpi')
    .addItem('Tutup bulan KPI…', 'menuTutupBulan')
    .addItem('Masukkan Input Manual…', 'menuInputManual')
    .addItem('Arsipkan data tahun lalu…', 'menuArsipkanTahun')
    .addItem('Hapus data testing…', 'menuHapusDataTesting')
    .addItem('Buat tab backup sekarang (minggu & bulan lalu)', 'menuBackupSekarang')
    .addSeparator()
    .addItem('Isi terjemahan otomatis (中文 / English)…', 'menuIsiTerjemahan')
    .addSeparator()
    .addItem('Rapikan tampilan spreadsheet', 'menuRapikanTampilan')
    .addItem('Tampilkan semua tab', 'menuTampilkanSemuaTab')
    .addSeparator()
    .addItem('Muat ulang data master (jika perubahan sheet belum muncul)', 'menuMuatUlangMaster')
    .addItem('Tentang (versi ' + APP.VERSION + ')', 'menuTentang')
    .addToUi();
}

function menuTentang() {
  SpreadsheetApp.getUi().alert(appName_() + ' versi ' + APP.VERSION + '\n\nCatatan perubahan: CHANGELOG.md di GitHub, atau menu Panduan di aplikasi.\n' +
    'Dua factory: pastikan kedua spreadsheet memakai versi yang sama.');
}

/** Simple trigger: setiap edit manual di spreadsheet → cache master dihapus (perubahan langsung terlihat). */
function onEdit(e) {
  var name = '';
  var sheet = null;
  try { sheet = e && e.range ? e.range.getSheet() : null; name = sheet ? sheet.getName() : ''; } catch (err) { /* abaikan */ }
  if (name === APP.SHEETS.TERJEMAHAN) {   // admin mengoreksi terjemahan → cache teks itu dibuang
    try {
      var sh = e.range.getSheet(), h = headers_(sh), c = h.indexOf('Teks') + 1;
      if (c > 0) sh.getRange(e.range.getRow(), c, e.range.getNumRows(), 1).getValues().forEach(function (r) { forgetTranslation_(r[0]); });
    } catch (err) { /* abaikan */ }
    return;
  }
  // Hanya sheet pengaturan yang ada di cache master. Edit lain (Maintenance, Ringkasan, Laporan, …) tidak menghapus cache,
  // supaya buka app berikutnya tetap cepat. Tab pengaturan yang sudah diganti nama dikenali lewat sheetId (2.6).
  // Nama / sheetId tidak terbaca → hapus cache (aman).
  if (name && APP.MASTER_SHEETS.indexOf(name) === -1) {
    var master = true;
    try { master = !!masterNameOf_(sheet); } catch (err) { /* aman: hapus cache */ }
    if (!master) return;
  }
  invalidateMaster_();
}

/**
 * Trigger terpasang (setup): perubahan struktur (hapus/sisip baris, tab baru) juga menghapus cache.
 * Edit nilai sudah ditangani onEdit (hanya sheet pengaturan) dan ganti format tidak mengubah data → dilewati.
 * Event onChange tidak menyebut sheet mana yang berubah, jadi perubahan struktur selalu menghapus cache.
 */
function onMasterChange(e) {
  var type = e && e.changeType;
  if (type === 'EDIT' || type === 'FORMAT') return;
  invalidateMaster_();
}

function menuMuatUlangMaster() {
  requireUser_([APP.ROLES.ADMIN]);
  invalidateMaster_();
  SpreadsheetApp.getUi().alert('Data master akan dibaca ulang dari sheet pada request berikutnya.');
}

/**
 * Idempotent: aman dijalankan berulang kali.
 * - Membuat sheet + header yang belum ada (tidak menghapus data).
 * - Mengisi Config dan Pilihan default (hanya jenis yang masih kosong).
 * - Membuat ulang tab turunan (FILTER): Maintenance <Baterai> dan Pending Work.
 * - Mendaftarkan pemanggil sebagai Admin jika sheet Users masih kosong.
 * - Memasang trigger checkTimeouts (tanpa duplikat).
 */
/**
 * Cek semua file proyek sudah dibuat (Run dari editor). Dipanggil juga di awal setup(),
 * supaya file yang terlewat langsung disebut namanya, bukan muncul sebagai "X is not defined".
 */
function cekFile() {
  var missing = [];
  var scripts = { Config: typeof APP, Db: typeof readTable_, Auth: typeof currentEmail_, Master: typeof masterData_,
    Maintenance: typeof apiStart, Api: typeof apiBootstrap, Rekap: typeof buildLaporan_, Translate: typeof translate_, Tampilan: typeof rapikanTampilan_, Tpm: typeof buildTpm_, Kpi: typeof computeKpi_ };
  Object.keys(scripts).forEach(function (f) { if (scripts[f] === 'undefined') missing.push(f + ' (script)'); });
  ['Index', 'App', 'Styles', 'Message', 'Panduan', 'I18n'].forEach(function (f) {
    try { HtmlService.createHtmlOutputFromFile(f); } catch (e) { missing.push(f + ' (HTML)'); }
  });
  if (missing.length) {
    throw new Error('File belum lengkap di Apps Script: ' + missing.join(', ') + '. Buat file dengan nama persis itu ' +
      '(tanpa .gs / .html), paste isinya dari folder src di GitHub, Ctrl+S, lalu Run setup lagi.');
  }
  if (!SpreadsheetApp.getActive()) {
    throw new Error('Script ini tidak menempel ke spreadsheet. Buka spreadsheet → Extensions → Apps Script, lalu paste file di sana.');
  }
  console.log('Semua file lengkap (versi ' + APP.VERSION + ').');
  return APP.VERSION;
}

// 2.6.2: setup dengan data setahun sempat 283 dtk (batas Apps Script 360). Bangun ulang laporan hanya dimulai bila
// waktu sejak setup mulai masih di bawah batas ini; yang dilewati dibangun trigger malam / Dashboard → Perbarui.
// 2.6.3: batas mulai + lama terlama yang terukur ≤ ±300 dtk (TPM dengan terjemahan sampai 113 dtk, rapikan tampilan ±40).
var SETUP_BATAS_MS_ = { laporan: 200000, tpm: 180000, kpi: 260000, tampilan: 250000 };
var SETUP_TR_MAX_ = 100;   // terjemahan TPM baru per bahasa di dalam setup (trigger malam: TPM_TR_MAX_)

function setup() {
  var t0 = Date.now(), lewat = [];
  var cukup = function (k) { if (Date.now() - t0 < SETUP_BATAS_MS_[k]) return true; lewat.push(k); return false; };
  cekFile();
  invalidateMaster_();
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(APP.TZ);

  Object.keys(APP.HEADERS).forEach(function (name) {
    var sh = findSheet_(name, ss) || ss.insertSheet(name);   // tab pengaturan yang diganti nama tetap dipakai (2.6)
    var want = APP.HEADERS[name];
    var have = headers_(sh, name);
    if (have.length === 0) {
      sh.getRange(1, 1, 1, want.length).setValues([want]);
    } else {
      var missing = want.filter(function (h) { return have.indexOf(h) === -1; });
      if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    }
    forgetHeaders_(name);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
  });
  registerMasterSheets_(ss);   // catat sheetId: setelah ini admin bebas mengganti nama tab pengaturan
  // 2.6.5: tab data tanpa kolom kosong di kanan (Log 26 → 5 kolom = ±800 ribu sel kosong per 40 ribu baris)
  ss.getSheets().forEach(function (sh) {
    if ([APP.SHEETS.MAINT, APP.SHEETS.LOG, APP.SHEETS.PEMAKAIAN].indexOf(sh.getName()) !== -1 || /^Arsip( Log| Sparepart)? \d{4}$/.test(sh.getName())) trimSheet_(sh);
  });

  Object.keys(APP.DATE_COLUMNS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var h = headers_(sh);
    APP.DATE_COLUMNS[name].forEach(function (col) {
      var c = h.indexOf(col) + 1;
      if (c > 0) sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat(DATE_FMT_);
    });
  });

  // Log & Maintenance hanya boleh ditulis kode. Proteksi "warning only": editor manual
  // mendapat peringatan (user tetap perlu akses Editor karena web app berjalan sebagai user).
  [APP.SHEETS.MAINT, APP.SHEETS.LOG, APP.SHEETS.PEMAKAIAN, APP.SHEETS.SARAN, APP.SHEETS.KPI_DATA].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      sh.protect().setDescription('Ditulis oleh aplikasi MTTR. Jangan diedit manual.').setWarningOnly(true);
    }
  });

  var cfg = readTable_(APP.SHEETS.CONFIG);
  Object.keys(APP.CONFIG_DEFAULTS).forEach(function (key) {
    if (!cfg.some(function (r) { return String(r['Key']).trim() === key; })) {
      appendObj_(APP.SHEETS.CONFIG, { 'Key': key, 'Value': APP.CONFIG_DEFAULTS[key].value, 'Keterangan': APP.CONFIG_DEFAULTS[key].description });
    }
  });

  var opts = readTable_(APP.SHEETS.OPTIONS);
  Object.keys(APP.OPTION_DEFAULTS).forEach(function (jenis) {
    if (opts.some(function (r) { return String(r['Jenis']).trim() === jenis; })) return;
    APP.OPTION_DEFAULTS[jenis].forEach(function (v, i) {
      appendObj_(APP.SHEETS.OPTIONS, { 'Jenis': jenis, 'Nilai': v, 'Urutan': i + 1, 'Aktif': 'Ya' });
    });
  });
  migrateDiscipline_();   // 2.5.2: Jenis kerusakan Operasional / Produk / MES + kolom Discipline (tab TPM)
  var notes = migrate26_(ss);   // 2.6: field mesin, Preventive, review Pending
  notes = notes.concat(migrateTr261_());   // 2.6.1: terjemahan Inggris lama yang salah dibuat ulang
  notes = notes.concat(migrateCancel261_());   // 2.6.1: Cancel tanpa review → antrian lama dibersihkan

  if (readTable_(APP.SHEETS.FACTORY).length === 0) {
    APP.FACTORY_DEFAULTS.forEach(function (f) {
      appendObj_(APP.SHEETS.FACTORY, { 'Factory ID': f[0], 'Nama': f[1], 'Lokasi': f[2], 'Aktif': 'Ya' });
    });
  }
  if (readTable_(APP.SHEETS.PROJECTS).length === 0) {
    APP.PROJECT_DEFAULTS.forEach(function (p) {
      appendObj_(APP.SHEETS.PROJECTS, { 'Factory ID': p[0], 'Baterai': p[1], 'Fase': '', 'Aktif': 'Ya' });
    });
  }

  // Form: isi default jika kosong; kembalikan field sistem yang terhapus (tanpa menimpa yang sudah diubah).
  var formRows = readTable_(APP.SHEETS.FORM);
  APP.FORM_DEFAULTS.forEach(function (d) {
    var key = d[0] + '.' + d[1];
    var exists = formRows.some(function (r) { return String(r['Form']).trim() + '.' + String(r['Field']).trim() === key; });
    var mustExist = formRows.length === 0 || APP.LOCKED_FIELDS.indexOf(key) !== -1 || APP.FORM_MIGRATE.indexOf(key) !== -1;
    if (!exists && mustExist) {
      appendObj_(APP.SHEETS.FORM, { 'Form': d[0], 'Field': d[1], 'Label': d[2], 'Tipe': d[3], 'Sumber': d[4],
        'Wajib': d[5], 'Lainnya isi sendiri': d[6], 'Urutan': d[7], 'Aktif': 'Ya' });
    }
  });

  if (readTable_(APP.SHEETS.SPAREPART).length === 0) {
    APP.SPAREPART_DEFAULTS.forEach(function (p, i) {
      appendObj_(APP.SHEETS.SPAREPART, { 'Jenis Sparepart': p[0], 'Nama Sparepart': p[1], 'Model': p[2], 'Satuan': p[3], 'Urutan': i + 1, 'Aktif': 'Ya' });
    });
  }
  if (readTable_(APP.SHEETS.FORMAT).length === 0) {
    APP.REPORT_DEFAULTS.forEach(function (d, i) {
      appendObj_(APP.SHEETS.FORMAT, { 'Kolom': d[0], 'Sumber': d[1], 'Urutan': i + 1, 'Aktif': d[2] });
    });
  }
  if (readTable_(APP.SHEETS.RENCANA).length === 0) {
    APP.RENCANA_DEFAULTS.forEach(function (r, i) {
      appendObj_(APP.SHEETS.RENCANA, { 'Judul': r[0], 'Isi': r[1], 'Status': r[2], 'Target': r[3], 'Urutan': i + 1, 'Aktif': 'Ya' });
    });
  }
  isiTerjemahanMaster_(false);   // label 中文/English bawaan untuk isi awal (tanpa Google Translate)

  if (readTable_(APP.SHEETS.PANDUAN).length === 0) {
    appendObj_(APP.SHEETS.PANDUAN, { 'Untuk': 'Teknisi', 'Judul': 'Contoh catatan', 'Urutan': 1, 'Aktif': 'Tidak',
      'Isi': 'Ubah Aktif menjadi Ya untuk menampilkan catatan ini di Panduan aplikasi. Contoh: masalah PLC hubungi Bang X (ext 123).' });
  }

  invalidateMaster_();
  ensureMaintColumns_(customColumns_(masterData_()));

  if (readTable_(APP.SHEETS.USERS).length === 0) {
    var me = currentEmail_();
    if (me) appendObj_(APP.SHEETS.USERS, { 'Email': me, 'Nama': me.split('@')[0], 'Peran': APP.ROLES.ADMIN, 'Aktif': 'Ya' });
  }

  notes = notes.concat(masterData_().warnings.filter(function (w) { return /^Users: /.test(w); }));

  buildDerivedSheets_(ss);
  ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR); // "Lama pending" pakai NOW()

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkTimeouts'; });
  if (!hasTrigger) ScriptApp.newTrigger('checkTimeouts').timeBased().everyMinutes(APP.TRIGGER_MINUTES).create();
  // Laporan & Rekap diperbarui langsung tiap aksi; trigger malam = bangun ulang penuh. Trigger lama selalu diganti,
  // supaya jadwal versi sebelumnya (2.2.1 = tiap jam) tidak tertinggal.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshRekap') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshRekap').timeBased().everyDays(1).atHour(APP.REKAP_HOUR).create();
  // 2.6.6: tab backup mingguan / bulanan, tiap hari 03:00 (diganti tiap setup supaya tidak dobel)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupTerjadwal') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupTerjadwal').timeBased().everyDays(1).atHour(BACKUP_JAM_).create();
  var hasChange = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onMasterChange'; });
  if (!hasChange) ScriptApp.newTrigger('onMasterChange').forSpreadsheet(ss).onChange().create(); // hapus/sisip baris → cache dihapus
  // Lock: setup boleh dijalankan saat teknisi sedang bekerja tanpa bentrok dengan sinkron laporan per aksi.
  if (cukup('laporan')) withLock_(function () { buildRekap_(yearOf_(new Date())); buildLaporan_(yearOf_(new Date()), { forceBaterai: true }); });
  // Di luar lock (terjemahan baru disimpan dengan lock sendiri). Gagal di sini tidak menggagalkan setup.
  var tpmErr = '';
  if (cukup('tpm')) { try { buildTpm_({ trMax: SETUP_TR_MAX_ }); } catch (e) { tpmErr = 'TPM: ' + (e && e.message || e); console.warn(tpmErr); } }
  if (cukup('kpi')) {
    try { var kpi = buildKpi_(); if (kpi.warn) notes.push(kpi.warn); } catch (e) { tpmErr += (tpmErr ? ' · ' : '') + 'KPI: ' + (e && e.message || e); console.warn('KPI: ' + e); }
  }

  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  invalidateMaster_();
  // Tab Ringkasan & Baca Saya, warna, belang, filter, dropdown, urutan & sembunyikan tab. Gagal di sini tidak menggagalkan setup.
  var p = cukup('tampilan') ? rapikanTampilan_({ full: true }) : [];
  if (tpmErr) p.push(tpmErr);
  if (lewat.length) {
    var label = { laporan: 'Laporan & Rekap', tpm: 'tab TPM', kpi: 'tab KPI', tampilan: 'rapikan tampilan' };
    notes.push('Waktu hampir habis (batas Apps Script 6 menit, ' + Math.round((Date.now() - t0) / 1000) + ' dtk): ' +
      lewat.map(function (k) { return label[k]; }).join(', ') + ' dilewati. Dibangun trigger malam nanti, atau sekarang lewat ' +
      'Dashboard → Perbarui' + (lewat.indexOf('tampilan') !== -1 ? ' dan menu Rapikan tampilan spreadsheet' : '') + '.');
  }
  return 'Setup selesai.' + (notes.length ? ' Catatan: ' + notes.join(' ') : '') + (p.length ? ' Tampilan belum lengkap: ' + p.join(' · ') : '');
}

/**
 * Upgrade ke 2.6, aman dijalankan berulang: baris Form yang tidak dipakai lagi (pilih mesin) dimatikan; pilihan di
 * OPTION_RETIRE_ONCE (Preventive) dimatikan SEKALI (admin boleh menyalakannya lagi); Pending lama keluar dari antrean
 * review (fungsi Cek dihapus). Data pekerjaan lama tidak diubah.
 * @return {string[]} catatan untuk admin (mis. sheet Mesin lama masih berisi data)
 */
function migrate26_(ss) {
  var notes = [];
  var off = function (name, pred) {
    var sh = sheet_(name), vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
    var ca = h.indexOf('Aktif');
    if (ca < 0) return;
    for (var i = 1; i < vals.length; i++) {
      if (isActiveRow_(vals[i][ca]) && String(vals[i][0]).trim() && pred(vals[i], h)) sh.getRange(i + 1, ca + 1).setValue(APP.NO);
    }
  };
  off(APP.SHEETS.FORM, function (row, h) {
    return APP.FORM_RETIRE.indexOf(String(row[h.indexOf('Form')]).trim() + '.' + String(row[h.indexOf('Field')]).trim()) !== -1;
  });
  var props = PropertiesService.getDocumentProperties();
  if (!props.getProperty('MTTR_2_6_OPTIONS')) {
    off(APP.SHEETS.OPTIONS, function (row, h) {
      return (APP.OPTION_RETIRE_ONCE[String(row[h.indexOf('Jenis')]).trim()] || []).indexOf(String(row[h.indexOf('Nilai')]).trim()) !== -1;
    });
    props.setProperty('MTTR_2_6_OPTIONS', new Date().toISOString());
  }
  var msh = sheet_(APP.SHEETS.MAINT), mh = headers_(msh), cr = mh.indexOf('Status review') + 1;
  if (cr > 0) {
    readTable_(APP.SHEETS.MAINT).forEach(function (r) {
      if (r['Status'] === APP.STATUS.PENDING && r['Status review'] === APP.REVIEW.NEEDED) msh.getRange(r._row, cr).setValue('');
    });
  }
  var mesin = findSheet_(APP.SHEETS.MESIN, ss);
  if (mesin && mesin.getLastRow() > 1) {
    notes.push('Sheet Mesin (' + (mesin.getLastRow() - 1) + ' baris) tidak dipakai lagi: sejak 2.6 satu baris Lines = satu unit = satu QR. ' +
      'Jika sebuah mesin perlu dicatat sendiri, tambahkan barisnya di Lines (mis. "Line Pack 1 - EOL Test") lalu cetak QR-nya.');
  }
  return notes;
}

/**
 * 2.6.1, sekali: hasil Google Translate ke Inggris untuk teks non-中文 dikosongkan. Sebelum 2.6.1 teks Indonesia dan 中文
 * dikirim dalam satu panggilan → Google menganggap semuanya 中文 dan teks Indonesia kembali utuh / rusak. Koreksi admin
 * (Sumber bukan Google) dan arah lain (中文, Indonesia) tidak disentuh. Pembangunan TPM berikutnya menerjemahkan ulang.
 * @return {string[]} catatan untuk admin
 */
function migrateTr261_() {
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('MTTR_TR_EN_261')) return [];
  var sh = sheet_(APP.SHEETS.TERJEMAHAN), vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var ce = h.indexOf('en'), cs = h.indexOf('Sumber'), cl = h.indexOf('Bahasa asal'), n = 0;
  var filled = function (r) { return ['id', 'zh', 'en'].some(function (l) { return h.indexOf(l) >= 0 && String(r[h.indexOf(l)]).trim() !== ''; }); };
  if (ce >= 0 && cs >= 0 && vals.length > 1) {
    vals.slice(1).forEach(function (r) {
      if (String(r[ce]).trim() === '' || String(r[cs]).trim() !== 'Google' || String(cl >= 0 ? r[cl] : '').trim() === 'zh') return;
      r[ce] = ''; n++;
    });
    // baris yang kini kosong (dulu baris khusus Inggris) dibuang; baris lain tetap di tempatnya
    if (n) rewriteKeeping_(sh, vals, function (r) { return filled(r) || String(r[cs]).trim() !== 'Google'; });
  }
  TR_MEMO_ = null;
  props.setProperty('MTTR_TR_EN_261', new Date().toISOString());
  return n ? [n + ' terjemahan Inggris lama (tab Terjemahan) dikosongkan karena sering salah sebelum 2.6.1; tab TPM menerjemahkan ulang otomatis.'] : [];
}

/**
 * 2.6.1: review Cancel dihapus (satu-satunya keputusan dulu "Setujui"; Cancelled tidak pernah masuk MTTR). Cancelled yang
 * masih "Perlu review" ditandai Direview oleh SYSTEM, sekaligus per kolom. Aman dijalankan berulang.
 * @return {string[]} catatan untuk admin
 */
function migrateCancel261_() {
  var sh = sheet_(APP.SHEETS.MAINT), v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var c = function (n) { return h.indexOf(n); }, cs = c('Status'), cr = c('Status review'), cb = c('Direview oleh'), ct = c('Direview pada'), cn = c('Catatan review');
  if (cs < 0 || cr < 0 || v.length < 2) return [];
  var now = new Date(), n = 0;
  v.slice(1).forEach(function (r) {
    if (r[cs] !== APP.STATUS.CANCELLED || r[cr] !== APP.REVIEW.NEEDED) return;
    r[cr] = APP.REVIEW.DONE; n++;
    if (cb >= 0) r[cb] = APP.SYSTEM_USER;
    if (ct >= 0) r[ct] = now;
    if (cn >= 0) r[cn] = '2.6.1: review Cancel dihapus (otomatis)';
  });
  if (!n) return [];
  [cr, cb, ct, cn].filter(function (k) { return k >= 0; }).forEach(function (k) {
    sh.getRange(2, k + 1, v.length - 1, 1).setValues(v.slice(1).map(function (r) { return [r[k]]; }));
  });
  return [n + ' pekerjaan Cancelled keluar dari antrian review (sejak 2.6.1 Cancel tidak perlu review).'];
}

/**
 * Tab turunan hanya berisi rumus -> kode tidak pernah menambah/menghapus baris di sana.
 * Rumus dibangun dari posisi header saat ini, jadi jalankan setup() lagi jika kolom Maintenance digeser.
 */
function buildDerivedSheets_(ss) {
  var mh = headers_(ss.getSheetByName(APP.SHEETS.MAINT));
  var col = function (name) { return colLetter_(mh.indexOf(name) + 1); };
  var src = "'" + APP.SHEETS.MAINT + "'!";

  // Tab "Maintenance <baterai>" sejak 2.6.1 = Laporan per project, dibangun bersama Laporan (buildLaporanBaterai_).
  var pw = prepDerived_(ss, APP.SHEETS.PENDING);
  var head = ['Maintenance ID', 'Line', 'Baterai', 'Yang tertunda', 'Tenggat', 'Teknisi terakhir', 'Lama pending (jam)'];
  pw.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  var parts = ['Maintenance ID', 'Line', 'Baterai', 'Yang tertunda', 'Tenggat', 'Teknisi terakhir'].map(function (h) {
    return src + col(h) + '2:' + col(h);
  });
  parts.push('ROUND((NOW()-' + src + col('Status sejak') + '2:' + col('Status sejak') + ')*24,1)');
  pw.getRange('A2').setFormula(fx_('=IFERROR(SORT(FILTER({' + parts.join(', ') + '}, ' + src + col('Status') + '2:' + col('Status') + '="' +
    APP.STATUS.PENDING + '"), 7, FALSE), "")'));
  pw.getRange(2, 5, pw.getMaxRows() - 1, 1).setNumberFormat(DATE_FMT_);
}

function prepDerived_(ss, name) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  forgetHeaders_(name);
  sh.setFrozenRows(1);
  return sh;
}
