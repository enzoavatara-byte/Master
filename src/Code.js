/**
 * Entry point web app + setup + trigger ABANDONED.
 */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var user;
  try {
    user = getCurrentUser_();
  } catch (err) {
    return renderMessage_('Konfigurasi belum lengkap', String(err.message || err));
  }
  if (!user.authorized) {
    return renderMessage_('Access Denied',
      'Email <b>' + escapeHtml_(user.email || '(tidak terdeteksi)') + '</b> tidak terdaftar atau nonaktif di sistem. ' +
      'Hubungi Admin untuk didaftarkan.');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  // Whitelist karakter: nilai ini ditanam ke <script> di Index.html.
  t.lineId = String(params.line || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 50);
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

// ---------- Trigger: ABANDONED ----------

/**
 * Dijalankan time-driven trigger tiap 15 menit.
 * IN_PROGRESS yang Start Time-nya lebih lama dari ABANDON_HOURS -> ABANDONED.
 * Finish Time TIDAK diisi; record masuk antrian review Supervisor/Admin.
 */
function markAbandoned() {
  var hours = getAbandonHours_();
  var cutoff = new Date(Date.now() - hours * 3600 * 1000);
  var changed = 0;
  withLock_(function () {
    readTable_(APP.SHEETS.MAINT).forEach(function (r) {
      if (r['Status'] !== APP.STATUS.IN_PROGRESS) return;
      if (!(r['Start Time'] instanceof Date) || r['Start Time'] > cutoff) return;
      r['Status'] = APP.STATUS.ABANDONED;
      r['Note'] = 'AUTO: IN_PROGRESS > ' + hours + ' jam tanpa update (' + fmtDate_(new Date()) + ')';
      writeObj_(APP.SHEETS.MAINT, r);
      changed++;
    });
  });
  if (changed) console.log('markAbandoned: ' + changed + ' record jadi ABANDONED');
  return changed;
}

// ---------- Setup (jalankan sekali oleh pemilik spreadsheet) ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MTTR')
    .addItem('Setup / perbaiki sheet & trigger', 'setup')
    .addItem('Jalankan cek ABANDONED sekarang', 'markAbandoned')
    .addToUi();
}

/**
 * Idempotent: aman dijalankan berulang kali.
 * - Membuat sheet + header yang belum ada (tidak menghapus data).
 * - Set timezone spreadsheet ke Asia/Jakarta.
 * - Mengisi Config default.
 * - Mendaftarkan pemanggil sebagai Admin jika sheet Users masih kosong.
 * - Memasang trigger markAbandoned (tanpa duplikat).
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
      // Tambahkan header yang hilang di kanan, jangan ubah yang sudah ada.
      var missing = want.filter(function (h) { return have.indexOf(h) === -1; });
      if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
  });

  var maint = ss.getSheetByName(APP.SHEETS.MAINT);
  var mh = headers_(maint);
  ['Start Time', 'Finish Time', 'Reviewed At'].forEach(function (h) {
    var c = mh.indexOf(h) + 1;
    if (c > 0) maint.getRange(2, c, maint.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  });

  var cfgRows = readTable_(APP.SHEETS.CONFIG);
  Object.keys(APP.CONFIG_DEFAULTS).forEach(function (key) {
    var exists = cfgRows.some(function (r) { return String(r['Key']).trim() === key; });
    if (!exists) {
      appendObj_(APP.SHEETS.CONFIG, { 'Key': key, 'Value': APP.CONFIG_DEFAULTS[key].value, 'Description': APP.CONFIG_DEFAULTS[key].description });
    }
  });

  if (readTable_(APP.SHEETS.USERS).length === 0) {
    var me = currentEmail_();
    if (me) appendObj_(APP.SHEETS.USERS, { 'Email': me, 'Name': me.split('@')[0], 'Role': APP.ROLES.ADMIN, 'Department': '', 'Status': 'Active' });
  }

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'markAbandoned'; });
  if (!hasTrigger) ScriptApp.newTrigger('markAbandoned').timeBased().everyMinutes(APP.TRIGGER_MINUTES).create();

  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  return 'Setup selesai.';
}
