/**
 * Logika inti state machine Maintenance.
 *
 *   START  -> IN_PROGRESS -> COMPLETED   (Testing OK atau NG, tanpa loop-back)
 *                         -> CANCELLED
 *                         -> ABANDONED   (otomatis oleh trigger, lalu direview Supervisor/Admin)
 *
 * Semua timestamp dibuat di server (new Date() di sini), bukan dari device.
 * Fungsi tanpa underscore = bisa dipanggil dari client via google.script.run.
 */

// ---------- Serialisasi (Date tidak boleh dikirim lewat google.script.run) ----------

function serializeRecord_(r, lineMap) {
  var start = r['Start Time'] instanceof Date ? r['Start Time'] : null;
  var finish = r['Finish Time'] instanceof Date ? r['Finish Time'] : null;
  var line = lineMap ? lineMap[String(r['Line ID']).toUpperCase()] : null;
  return {
    id: String(r['Maintenance ID']),
    lineId: String(r['Line ID']),
    lineName: line ? String(line['Line Name']) : '',
    userEmail: String(r['User Email']),
    startIso: start ? start.toISOString() : '',
    startText: fmtDate_(start),
    finishIso: finish ? finish.toISOString() : '',
    finishText: fmtDate_(finish),
    status: String(r['Status']),
    problem: String(r['Problem'] || ''),
    actionTaken: String(r['Action Taken'] || ''),
    partReplaced: String(r['Part Replaced'] || ''),
    testingResult: String(r['Testing Result'] || ''),
    durationMin: r['Duration (min)'] === '' ? null : Number(r['Duration (min)']),
    closedBy: String(r['Closed By'] || ''),
    note: String(r['Note'] || ''),
    reviewedBy: String(r['Reviewed By'] || ''),
    reviewedAtText: fmtDate_(r['Reviewed At'])
  };
}

function serializeLine_(l) {
  return {
    lineId: String(l['Line ID']),
    lineName: String(l['Line Name'] || ''),
    machine: String(l['Machine'] || ''),
    department: String(l['Department'] || ''),
    location: String(l['Location'] || ''),
    active: isActiveStatus_(l['Status'])
  };
}

function lineMap_() {
  var map = {};
  readTable_(APP.SHEETS.LINES).forEach(function (l) { map[String(l['Line ID']).toUpperCase()] = l; });
  return map;
}

function userNameMap_() {
  var map = {};
  readTable_(APP.SHEETS.USERS).forEach(function (u) { map[String(u['Email']).toLowerCase()] = String(u['Name'] || u['Email']); });
  return map;
}

function activeForLine_(rows, lineId) {
  var key = String(lineId).toUpperCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Line ID']).toUpperCase() === key && rows[i]['Status'] === APP.STATUS.IN_PROGRESS) return rows[i];
  }
  return null;
}

function cleanText_(v, max) {
  return String(v == null ? '' : v).replace(/\s+$/g, '').slice(0, max || 1000);
}

// ---------- API: dipanggil dari client ----------

/** Data awal saat halaman dibuka. lineId dari parameter QR (?line=...). */
function apiBootstrap(lineId) {
  var user = requireUser_();
  var rows = readTable_(APP.SHEETS.MAINT);
  var lines = lineMap_();
  var names = userNameMap_();
  var mine = rows.filter(function (r) {
    return r['Status'] === APP.STATUS.IN_PROGRESS && String(r['User Email']).toLowerCase() === user.email;
  }).map(function (r) { return serializeRecord_(r, lines); });

  var abandonedCount = isReviewer_(user)
    ? rows.filter(function (r) { return r['Status'] === APP.STATUS.ABANDONED && !r['Reviewed By']; }).length
    : 0;

  return {
    user: user,
    serverNowIso: new Date().toISOString(),
    abandonHours: getAbandonHours_(),
    myActive: mine,
    abandonedCount: abandonedCount,
    lineView: lineId ? lineView_(lineId, rows, lines, names, user) : null,
    lines: Object.keys(lines).map(function (k) { return serializeLine_(lines[k]); })
      .filter(function (l) { return l.active; })
  };
}

/** Status sebuah line: info line + maintenance aktif (jika ada). */
function apiGetLine(lineId) {
  var user = requireUser_();
  return lineView_(lineId, readTable_(APP.SHEETS.MAINT), lineMap_(), userNameMap_(), user);
}

function lineView_(lineId, rows, lines, names, user) {
  var line = lines[String(lineId || '').trim().toUpperCase()];
  if (!line) return { found: false, lineId: String(lineId), serverNowIso: new Date().toISOString() };
  var active = activeForLine_(rows, line['Line ID']);
  var rec = active ? serializeRecord_(active, lines) : null;
  if (rec) rec.userName = names[rec.userEmail.toLowerCase()] || rec.userEmail;
  return {
    found: true,
    line: serializeLine_(line),
    active: rec,
    canAct: rec ? (rec.userEmail.toLowerCase() === user.email || isReviewer_(user)) : false,
    serverNowIso: new Date().toISOString()
  };
}

/** START: satu Line ID hanya boleh punya satu IN_PROGRESS (dijaga LockService). */
function apiStart(lineId) {
  var user = requireUser_();
  var line = findLine_(lineId);
  if (!line) throw new Error('Line ID "' + lineId + '" tidak ditemukan.');
  if (!isActiveStatus_(line['Status'])) throw new Error('Line ' + line['Line ID'] + ' berstatus nonaktif.');

  withLock_(function () {
    var rows = readTable_(APP.SHEETS.MAINT);
    var existing = activeForLine_(rows, line['Line ID']);
    if (existing) {
      throw new Error('Line ' + line['Line ID'] + ' sudah punya maintenance IN_PROGRESS (' +
        existing['Maintenance ID'] + ' oleh ' + existing['User Email'] + ').');
    }
    var now = new Date();
    var rec = {};
    rec['Maintenance ID'] = newMaintenanceId_(now);
    rec['Line ID'] = String(line['Line ID']);
    rec['User Email'] = user.email;
    rec['Start Time'] = now;
    rec['Status'] = APP.STATUS.IN_PROGRESS;
    appendObj_(APP.SHEETS.MAINT, rec);
  });
  return apiGetLine(line['Line ID']);
}

/** COMPLETE: isi form, Finish Time server-side, Duration dihitung. NG tetap COMPLETED. */
function apiComplete(id, form) {
  var user = requireUser_();
  form = form || {};
  var problem = cleanText_(form.problem);
  var action = cleanText_(form.actionTaken);
  var part = cleanText_(form.partReplaced) || '-';
  var testing = String(form.testingResult || '').toUpperCase();
  if (!problem.trim()) throw new Error('Problem wajib diisi.');
  if (!action.trim()) throw new Error('Action Taken wajib diisi.');
  if (APP.TESTING.indexOf(testing) === -1) throw new Error('Testing Result harus OK atau NG.');

  var lineId = withLock_(function () {
    var r = findMaintenance_(id);
    assertCanClose_(r, user);
    var now = new Date();
    r['Finish Time'] = now;
    r['Status'] = APP.STATUS.COMPLETED;
    r['Problem'] = problem;
    r['Action Taken'] = action;
    r['Part Replaced'] = part;
    r['Testing Result'] = testing;
    r['Duration (min)'] = durationMinutes_(r['Start Time'], now);
    r['Closed By'] = user.email;
    writeObj_(APP.SHEETS.MAINT, r);
    return r['Line ID'];
  });
  return apiGetLine(lineId);
}

/** CANCEL: tidak ada Finish Time / Duration — record ini bukan data repair valid. */
function apiCancel(id, reason) {
  var user = requireUser_();
  var why = cleanText_(reason, 500);
  if (!why.trim()) throw new Error('Alasan cancel wajib diisi.');
  var lineId = withLock_(function () {
    var r = findMaintenance_(id);
    assertCanClose_(r, user);
    r['Status'] = APP.STATUS.CANCELLED;
    r['Closed By'] = user.email;
    r['Note'] = 'CANCEL: ' + why;
    writeObj_(APP.SHEETS.MAINT, r);
    return r['Line ID'];
  });
  return apiGetLine(lineId);
}

function assertCanClose_(r, user) {
  if (!r) throw new Error('Maintenance tidak ditemukan.');
  if (r['Status'] === APP.STATUS.ABANDONED) {
    throw new Error('Maintenance ini sudah ABANDONED (> ' + getAbandonHours_() + ' jam). Hubungi Supervisor/Admin untuk review.');
  }
  if (r['Status'] !== APP.STATUS.IN_PROGRESS) throw new Error('Maintenance sudah berstatus ' + r['Status'] + '.');
  var owner = String(r['User Email']).toLowerCase() === user.email;
  if (!owner && !isReviewer_(user)) throw new Error('Hanya ME yang memulai (atau Supervisor/Admin) yang boleh menutup maintenance ini.');
}

/**
 * Riwayat mentah. ME hanya melihat record miliknya; Supervisor/Admin melihat semua.
 * @param {{status?:string, lineId?:string, from?:string, to?:string}} filter tanggal format yyyy-MM-dd (WIB)
 */
function apiListRecords(filter) {
  var user = requireUser_();
  filter = filter || {};
  var from = filter.from ? Utilities.parseDate(filter.from + ' 00:00:00', APP.TZ, 'yyyy-MM-dd HH:mm:ss') : null;
  var to = filter.to ? Utilities.parseDate(filter.to + ' 23:59:59', APP.TZ, 'yyyy-MM-dd HH:mm:ss') : null;
  var lineKey = String(filter.lineId || '').trim().toUpperCase();
  var lines = lineMap_();

  var rows = readTable_(APP.SHEETS.MAINT).filter(function (r) {
    if (!isReviewer_(user) && String(r['User Email']).toLowerCase() !== user.email) return false;
    if (filter.status && r['Status'] !== filter.status) return false;
    if (lineKey && String(r['Line ID']).toUpperCase() !== lineKey) return false;
    var st = r['Start Time'];
    if (from && (!(st instanceof Date) || st < from)) return false;
    if (to && (!(st instanceof Date) || st > to)) return false;
    return true;
  });
  rows.sort(function (a, b) { return (b['Start Time'] || 0) - (a['Start Time'] || 0); });
  var truncated = rows.length > 1000;
  return {
    records: rows.slice(0, 1000).map(function (r) { return serializeRecord_(r, lines); }),
    total: rows.length,
    truncated: truncated,
    spreadsheetUrl: isReviewer_(user) ? SpreadsheetApp.getActive().getUrl() : ''
  };
}

/** Antrian review: ABANDONED yang belum direview. */
function apiListAbandoned() {
  requireUser_([APP.ROLES.SUPERVISOR, APP.ROLES.ADMIN]);
  var lines = lineMap_();
  var names = userNameMap_();
  return readTable_(APP.SHEETS.MAINT)
    .filter(function (r) { return r['Status'] === APP.STATUS.ABANDONED && !r['Reviewed By']; })
    .map(function (r) {
      var s = serializeRecord_(r, lines);
      s.userName = names[s.userEmail.toLowerCase()] || s.userEmail;
      return s;
    });
}

/**
 * Keputusan reviewer atas record ABANDONED.
 * @param {{decision:'COMPLETE'|'CANCEL', finishTime?:string, problem?:string, actionTaken?:string,
 *          partReplaced?:string, testingResult?:string, note:string}} p
 *   finishTime format yyyy-MM-ddTHH:mm (WIB, dari input datetime-local).
 *
 * Finish Time di sini BUKAN server timestamp — ini keputusan manusia. Karena itu Reviewed By,
 * Reviewed At, dan Note wajib terisi supaya bisa dibedakan dari data asli saat analisis.
 */
function apiResolveAbandoned(id, p) {
  var user = requireUser_([APP.ROLES.SUPERVISOR, APP.ROLES.ADMIN]);
  p = p || {};
  var note = cleanText_(p.note, 500);
  if (!note.trim()) throw new Error('Catatan review wajib diisi.');

  withLock_(function () {
    var r = findMaintenance_(id);
    if (!r) throw new Error('Maintenance tidak ditemukan.');
    if (r['Status'] !== APP.STATUS.ABANDONED || r['Reviewed By']) throw new Error('Record ini tidak ada di antrian review.');
    var now = new Date();

    if (p.decision === 'COMPLETE') {
      if (!p.finishTime) throw new Error('Finish Time wajib diisi.');
      var finish = Utilities.parseDate(String(p.finishTime), APP.TZ, "yyyy-MM-dd'T'HH:mm");
      if (!(finish instanceof Date) || isNaN(finish.getTime())) throw new Error('Format Finish Time tidak valid.');
      if (finish <= r['Start Time']) throw new Error('Finish Time harus setelah Start Time.');
      if (finish > now) throw new Error('Finish Time tidak boleh di masa depan.');
      var testing = String(p.testingResult || '').toUpperCase();
      if (testing && APP.TESTING.indexOf(testing) === -1) throw new Error('Testing Result harus OK atau NG.');
      r['Finish Time'] = finish;
      r['Status'] = APP.STATUS.COMPLETED;
      r['Duration (min)'] = durationMinutes_(r['Start Time'], finish);
      r['Problem'] = cleanText_(p.problem);
      r['Action Taken'] = cleanText_(p.actionTaken);
      r['Part Replaced'] = cleanText_(p.partReplaced);
      r['Testing Result'] = testing;
      r['Note'] = 'REVIEW (finish manual): ' + note;
    } else if (p.decision === 'CANCEL') {
      r['Status'] = APP.STATUS.CANCELLED;
      r['Note'] = 'REVIEW (cancel): ' + note;
    } else {
      throw new Error('Keputusan review tidak dikenal.');
    }
    r['Closed By'] = user.email;
    r['Reviewed By'] = user.email;
    r['Reviewed At'] = now;
    writeObj_(APP.SHEETS.MAINT, r);
  });
  return apiListAbandoned();
}

/** Daftar semua line + URL QR (Admin). */
function apiListLinesForQr() {
  requireUser_([APP.ROLES.ADMIN]);
  return {
    baseUrl: ScriptApp.getService().getUrl(),
    lines: readTable_(APP.SHEETS.LINES).map(serializeLine_)
  };
}
