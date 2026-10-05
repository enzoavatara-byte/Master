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
      'Hubungi Admin untuk didaftarkan.');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  // Whitelist karakter: nilai ini ditanam ke <script> di Index.html.
  t.lineId = String(params.line || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 50);
  t.mesinId = String(params.mesin || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 50);
  return t.evaluate()
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function renderMessage_(title, htmlBody) {
  var t = HtmlService.createTemplateFromFile('Message');
  t.title = title;
  t.body = htmlBody;
  return t.evaluate().setTitle(APP.NAME + ' - ' + title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu(APP.NAME)
    .addItem('Setup / perbaiki sheet & trigger', 'setup')
    .addItem('Jalankan cek 3/4 jam sekarang', 'checkTimeouts')
    .addToUi();
}

/**
 * Idempotent: aman dijalankan berulang kali.
 * - Membuat sheet + header yang belum ada (tidak menghapus data).
 * - Mengisi Config dan Pilihan default (hanya jenis yang masih kosong).
 * - Membuat ulang tab turunan (FILTER): Maintenance <Baterai> dan Pending Work.
 * - Mendaftarkan pemanggil sebagai Admin jika sheet Users masih kosong.
 * - Memasang trigger checkTimeouts (tanpa duplikat).
 */
function setup() {
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
  [APP.SHEETS.MAINT, APP.SHEETS.LOG].forEach(function (name) {
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
    var mustExist = formRows.length === 0 || APP.LOCKED_FIELDS.indexOf(key) !== -1;
    if (!exists && mustExist) {
      appendObj_(APP.SHEETS.FORM, { 'Form': d[0], 'Field': d[1], 'Label': d[2], 'Tipe': d[3], 'Sumber': d[4],
        'Wajib': d[5], 'Lainnya isi sendiri': d[6], 'Urutan': d[7], 'Aktif': 'Ya' });
    }
  });

  resetMaster_();
  ensureMaintColumns_(customColumns_(masterData_()));

  if (readTable_(APP.SHEETS.USERS).length === 0) {
    var me = currentEmail_();
    if (me) appendObj_(APP.SHEETS.USERS, { 'Email': me, 'Nama': me.split('@')[0], 'Peran': APP.ROLES.ADMIN, 'Aktif': 'Ya' });
  }

  buildDerivedSheets_(ss);
  ss.setRecalculationInterval(SpreadsheetApp.RecalculationInterval.HOUR); // "Lama pending" pakai NOW()

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkTimeouts'; });
  if (!hasTrigger) ScriptApp.newTrigger('checkTimeouts').timeBased().everyMinutes(APP.TRIGGER_MINUTES).create();

  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

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
  sh.setFrozenRows(1);
  return sh;
}
