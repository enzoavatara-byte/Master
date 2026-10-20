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
  return t.evaluate()
    .setTitle(appName_())
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
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
    .addItem('Arsipkan data tahun lalu…', 'menuArsipkanTahun')
    .addItem('Hapus data testing…', 'menuHapusDataTesting')
    .addSeparator()
    .addItem('Isi terjemahan otomatis (中文 / English)…', 'menuIsiTerjemahan')
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
  try { name = e && e.range ? e.range.getSheet().getName() : ''; } catch (err) { /* abaikan */ }
  if (name === APP.SHEETS.TERJEMAHAN) {   // admin mengoreksi terjemahan → cache teks itu dibuang
    try {
      var sh = e.range.getSheet(), h = headers_(sh), c = h.indexOf('Teks') + 1;
      if (c > 0) sh.getRange(e.range.getRow(), c, e.range.getNumRows(), 1).getValues().forEach(function (r) { forgetTranslation_(r[0]); });
    } catch (err) { /* abaikan */ }
    return;
  }
  if ([APP.SHEETS.MAINT, APP.SHEETS.LOG, APP.SHEETS.PEMAKAIAN, APP.SHEETS.SARAN].indexOf(name) !== -1) return; // bukan master
  invalidateMaster_();
}

/** Trigger terpasang (setup): perubahan struktur (hapus/sisip baris, tab baru) juga menghapus cache. */
function onMasterChange() {
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
    Maintenance: typeof apiStart, Api: typeof apiBootstrap, Rekap: typeof buildLaporan_, Translate: typeof translate_ };
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

function setup() {
  cekFile();
  invalidateMaster_();
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(APP.TZ);

  Object.keys(APP.HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var want = APP.HEADERS[name];
    var have = headers_(sh);
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

  Object.keys(APP.DATE_COLUMNS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var h = headers_(sh);
    APP.DATE_COLUMNS[name].forEach(function (col) {
      var c = h.indexOf(col) + 1;
      if (c > 0) sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    });
  });

  // Log & Maintenance hanya boleh ditulis kode. Proteksi "warning only": editor manual
  // mendapat peringatan (user tetap perlu akses Editor karena web app berjalan sebagai user).
  [APP.SHEETS.MAINT, APP.SHEETS.LOG, APP.SHEETS.PEMAKAIAN, APP.SHEETS.SARAN].forEach(function (name) {
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

  buildDerivedSheets_(ss);
  ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR); // "Lama pending" pakai NOW()

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkTimeouts'; });
  if (!hasTrigger) ScriptApp.newTrigger('checkTimeouts').timeBased().everyMinutes(APP.TRIGGER_MINUTES).create();
  // Laporan & Rekap diperbarui langsung tiap aksi; trigger malam = bangun ulang penuh. Trigger lama selalu diganti,
  // supaya jadwal versi sebelumnya (2.2.1 = tiap jam) tidak tertinggal.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshRekap') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshRekap').timeBased().everyDays(1).atHour(APP.REKAP_HOUR).create();
  var hasChange = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onMasterChange'; });
  if (!hasChange) ScriptApp.newTrigger('onMasterChange').forSpreadsheet(ss).onChange().create(); // hapus/sisip baris → cache dihapus
  // Lock: setup boleh dijalankan saat teknisi sedang bekerja tanpa bentrok dengan sinkron laporan per aksi.
  withLock_(function () { buildRekap_(yearOf_(new Date())); buildLaporan_(yearOf_(new Date())); });

  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  invalidateMaster_();
  return 'Setup selesai.';
}

/**
 * Tab turunan hanya berisi rumus -> kode tidak pernah menambah/menghapus baris di sana.
 * Rumus dibangun dari posisi header saat ini, jadi jalankan setup() lagi jika kolom Maintenance digeser.
 */
function buildDerivedSheets_(ss) {
  var mh = headers_(ss.getSheetByName(APP.SHEETS.MAINT));
  var col = function (name) { return colLetter_(mh.indexOf(name) + 1); };
  var lastCol = colLetter_(mh.length);
  var src = "'" + APP.SHEETS.MAINT + "'!";

  var md = masterData_();
  var batteries = md.allBatteries.length ? md.allBatteries : APP.PROJECT_DEFAULTS.map(function (p) { return p[1]; });
  batteries.forEach(function (bat) {
    var sh = prepDerived_(ss, APP.SHEETS.MAINT + ' ' + bat);
    var c = col('Baterai');
    sh.getRange('A1').setFormula('=FILTER(' + src + 'A:' + lastCol + ', (ROW(' + src + 'A:A)=1)+(' + src + c + ':' + c + '="' + bat.replace(/"/g, '') + '"))');
    APP.DATE_COLUMNS.Maintenance.forEach(function (h) {
      var i = mh.indexOf(h) + 1;
      if (i > 0) sh.getRange(2, i, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    });
  });

  var pw = prepDerived_(ss, APP.SHEETS.PENDING);
  var head = ['Maintenance ID', 'Line', 'Baterai', 'Yang tertunda', 'Tenggat', 'Teknisi terakhir', 'Lama pending (jam)'];
  pw.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  var parts = ['Maintenance ID', 'Line', 'Baterai', 'Yang tertunda', 'Tenggat', 'Teknisi terakhir'].map(function (h) {
    return src + col(h) + '2:' + col(h);
  });
  parts.push('ROUND((NOW()-' + src + col('Status sejak') + '2:' + col('Status sejak') + ')*24,1)');
  pw.getRange('A2').setFormula('=IFERROR(SORT(FILTER({' + parts.join(', ') + '}, ' + src + col('Status') + '2:' + col('Status') + '="' +
    APP.STATUS.PENDING + '"), 7, FALSE), "")');
  pw.getRange(2, 5, pw.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}

function prepDerived_(ss, name) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  forgetHeaders_(name);
  sh.setFrozenRows(1);
  return sh;
}
