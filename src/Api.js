/**
 * API baca (dashboard, halaman line, pending, riwayat, review, QR) + keputusan review.
 * Date tidak boleh dikirim lewat google.script.run, jadi semua tanggal dikirim sebagai ISO string.
 */

function ctx_() {
  var lines = {};
  readTable_(APP.SHEETS.LINES).forEach(function (l) { lines[normLine_(l['Line ID'])] = l; });
  return { lines: lines, names: userNameMap_(), now: new Date() };
}

function nameOf_(c, email) {
  var e = String(email || '').toLowerCase();
  if (!e) return '';
  if (e === APP.SYSTEM_USER.toLowerCase()) return 'Sistem';
  return c.names[e] || e;
}

function serialize_(r, c) {
  var line = c.lines[normLine_(r['Line'])];
  var tenggat = r['Tenggat'] instanceof Date ? r['Tenggat'] : null;
  return {
    id: String(r['Maintenance ID']),
    line: String(r['Line']),
    lineName: line ? String(line['Nama Line'] || '') : '',
    battery: String(r['Baterai'] || ''),
    status: String(r['Status']),
    techFirst: String(r['Teknisi awal'] || ''),
    techFirstName: nameOf_(c, r['Teknisi awal']),
    techLast: String(r['Teknisi terakhir'] || ''),
    techLastName: nameOf_(c, r['Teknisi terakhir']),
    startIso: iso_(r['Mulai']),
    startText: fmtDate_(r['Mulai']),
    finishIso: iso_(r['Selesai']),
    finishText: fmtDate_(r['Selesai']),
    sinceIso: iso_(r['Status sejak']),
    activeMin: Number(r['Total aktif (menit)'] || 0),
    pauseMin: Number(r['Total pause (menit)'] || 0),
    pendingMin: Number(r['Total pending (menit)'] || 0),
    masalah: String(r['Masalah'] || ''),
    penyebab: String(r['Penyebab'] || ''),
    penanganan: String(r['Penanganan'] || ''),
    part: String(r['Part'] || ''),
    tertunda: String(r['Yang tertunda'] || ''),
    tenggatIso: iso_(tenggat),
    tenggatText: fmtDate_(tenggat),
    overdue: !!(tenggat && r['Status'] === APP.STATUS.PENDING && tenggat < c.now),
    cancelReason: String(r['Alasan cancel'] || ''),
    review: String(r['Status review'] || ''),
    mttr: String(r['Masuk MTTR'] || ''),
    confirmIso: iso_(r['Konfirmasi terakhir']),
    warnedIso: iso_(r['Peringatan pada']),
    dikerjakan: String(r['Pekerjaan dilakukan'] || ''),
    catatan: String(r['Catatan'] || ''),
    reviewedByName: nameOf_(c, r['Direview oleh']),
    reviewedText: fmtDate_(r['Direview pada']),
    reviewNote: String(r['Catatan review'] || '')
  };
}

function serializeLine_(l) {
  return {
    id: normLine_(l['Line ID']),
    name: String(l['Nama Line'] || ''),
    area: String(l['Area'] || ''),
    active: isYes_(l['Aktif'])
  };
}

function sortPending_(list) {
  return list.sort(function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return String(a.sinceIso).localeCompare(String(b.sinceIso)); // paling lama dulu
  });
}

function reviewVisible_(r, user) {
  if (r['Status review'] !== APP.REVIEW.NEEDED) return false;
  return isAdmin_(user) || isInvolved_(r, user.email);
}

/** Item review boleh diputuskan oleh user ini? Pending: admin + teknisi terkait. Lainnya: admin. */
function canDecide_(r, user) {
  if (isAdmin_(user)) return true;
  return r['Status'] === APP.STATUS.PENDING && isInvolved_(r, user.email);
}

// ---------- Bootstrap & dashboard ----------

function apiBootstrap(lineId) {
  var user = requireUser_();
  var rows = readTable_(APP.SHEETS.MAINT);
  var c = ctx_();
  var mine = openForUser_(rows, user.email);
  return {
    user: user,
    serverNowIso: c.now.toISOString(),
    limits: getLimits_(),
    options: getOptions_(),
    lines: Object.keys(c.lines).map(function (k) { return serializeLine_(c.lines[k]); })
      .filter(function (l) { return l.active; })
      .sort(function (a, b) { return a.id.localeCompare(b.id); }),
    myOpen: mine ? serialize_(mine, c) : null,
    counts: counts_(rows, user),
    stats: stats_(rows, c),
    recent: recent_(rows, c),
    lineView: lineId ? lineView_(lineId, rows, c, user) : null
  };
}

/** Ringan: dipanggil ulang saat app kembali dibuka / tiap menit, tanpa daftar line & pilihan. */
function apiRefresh() {
  var user = requireUser_();
  var rows = readTable_(APP.SHEETS.MAINT);
  var c = ctx_();
  var mine = openForUser_(rows, user.email);
  return {
    serverNowIso: c.now.toISOString(),
    myOpen: mine ? serialize_(mine, c) : null,
    counts: counts_(rows, user),
    stats: stats_(rows, c),
    recent: recent_(rows, c)
  };
}

function counts_(rows, user) {
  var pending = 0, review = 0;
  rows.forEach(function (r) {
    if (r['Status'] === APP.STATUS.PENDING) pending++;
    if (reviewVisible_(r, user) || (isAdmin_(user) && isOpen_(r) && r['Peringatan pada'] instanceof Date)) review++;
  });
  return { pending: pending, review: review };
}

/** 7 hari terakhir (WIB): jumlah maintenance selesai per hari + MTTR (hanya Masuk MTTR = Ya). */
function stats_(rows, c) {
  var days = [], idx = {};
  var names = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(c.now.getTime() - i * 86400000);
    var key = Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd');
    var dow = Number(Utilities.formatDate(d, APP.TZ, 'u')) % 7; // 1=Senin..7=Minggu -> 0=Minggu
    idx[key] = days.length;
    days.push({ key: key, label: i === 0 ? 'Hari ini' : names[dow], count: 0 });
  }
  var sum = 0, n = 0;
  rows.forEach(function (r) {
    if (r['Masuk MTTR'] !== APP.MTTR.YES) return;
    var when = r['Selesai'] instanceof Date ? r['Selesai'] : r['Status sejak'];
    if (!(when instanceof Date)) return;
    var k = Utilities.formatDate(when, APP.TZ, 'yyyy-MM-dd');
    if (!idx.hasOwnProperty(k)) return;
    days[idx[k]].count++;
    sum += Number(r['Total aktif (menit)'] || 0);
    n++;
  });
  return { days: days, mttrMin: n ? round2_(sum / n) : null, mttrN: n };
}

function recent_(rows, c) {
  var byId = {};
  rows.forEach(function (r) { byId[String(r['Maintenance ID'])] = r; });
  return readTail_(APP.SHEETS.LOG, 40).reverse().slice(0, 8).map(function (e) {
    var r = byId[String(e['Maintenance ID'])];
    return {
      whenIso: iso_(e['Timestamp']),
      event: String(e['Kejadian']),
      userName: nameOf_(c, e['User']),
      id: String(e['Maintenance ID']),
      line: r ? String(r['Line']) : '',
      battery: r ? String(r['Baterai'] || '') : '',
      detail: String(e['Detail'] || '')
    };
  });
}

// ---------- Halaman line ----------

function apiGetLine(lineId) {
  var user = requireUser_();
  return lineView_(lineId, readTable_(APP.SHEETS.MAINT), ctx_(), user);
}

function lineView_(lineId, rows, c, user) {
  var line = c.lines[normLine_(lineId)];
  var mine = openForUser_(rows, user.email);
  if (!line) return { found: false, lineId: normLine_(lineId), serverNowIso: c.now.toISOString() };
  var open = openForLine_(rows, line['Line ID']);
  var key = normLine_(line['Line ID']);
  var pendings = rows.filter(function (r) {
    return r['Status'] === APP.STATUS.PENDING && normLine_(r['Line']) === key;
  }).map(function (r) { return serialize_(r, c); });
  return {
    found: true,
    line: serializeLine_(line),
    open: open ? serialize_(open, c) : null,
    openIsMine: !!(open && String(open['Teknisi terakhir']).toLowerCase() === user.email),
    myOpenElsewhere: (mine && normLine_(mine['Line']) !== key) ? serialize_(mine, c) : null,
    pendings: sortPending_(pendings),
    lastBattery: lastBattery_(rows, line['Line ID']),
    serverNowIso: c.now.toISOString()
  };
}

// ---------- Pending ----------

function apiListPending() {
  requireUser_();
  var c = ctx_();
  var list = readTable_(APP.SHEETS.MAINT)
    .filter(function (r) { return r['Status'] === APP.STATUS.PENDING; })
    .map(function (r) { return serialize_(r, c); });
  return { serverNowIso: c.now.toISOString(), items: sortPending_(list) };
}

/** Detail + riwayat kejadian (dari Log) untuk satu Maintenance ID. */
function apiGetDetail(id) {
  var user = requireUser_();
  var c = ctx_();
  var r = findById_(readTable_(APP.SHEETS.MAINT), id);
  if (!r) throw new Error('Maintenance tidak ditemukan.');
  var events = readTable_(APP.SHEETS.LOG)
    .filter(function (e) { return String(e['Maintenance ID']) === String(id); })
    .map(function (e) {
      return { whenIso: iso_(e['Timestamp']), whenText: fmtDate_(e['Timestamp']), event: String(e['Kejadian']), userName: nameOf_(c, e['User']), detail: String(e['Detail'] || '') };
    });
  var rec = serialize_(r, c);
  rec.canDecide = rec.review === APP.REVIEW.NEEDED && canDecide_(r, user);
  return { serverNowIso: c.now.toISOString(), record: rec, events: events };
}

// ---------- Riwayat ----------

/** @param {{scope?:'mine'|'all', status?:string, battery?:string}} f  scope 'all' hanya untuk Admin. */
function apiHistory(f) {
  var user = requireUser_();
  f = f || {};
  var all = f.scope === 'all' && isAdmin_(user);
  var c = ctx_();
  var rows = readTable_(APP.SHEETS.MAINT).filter(function (r) {
    if (!all && !isInvolved_(r, user.email)) return false;
    if (f.status && r['Status'] !== f.status) return false;
    if (f.battery && r['Baterai'] !== f.battery) return false;
    return true;
  });
  rows.sort(function (a, b) { return (b['Mulai'] || 0) - (a['Mulai'] || 0); });
  return {
    serverNowIso: c.now.toISOString(),
    total: rows.length,
    truncated: rows.length > APP.HISTORY_LIMIT,
    items: rows.slice(0, APP.HISTORY_LIMIT).map(function (r) { return serialize_(r, c); }),
    spreadsheetUrl: isAdmin_(user) ? SpreadsheetApp.getActive().getUrl() : ''
  };
}

// ---------- Review ----------

function apiListReview() {
  var user = requireUser_();
  var c = ctx_();
  var rows = readTable_(APP.SHEETS.MAINT);
  var items = rows.filter(function (r) { return reviewVisible_(r, user); }).map(function (r) {
    var s = serialize_(r, c);
    s.canDecide = canDecide_(r, user);
    return s;
  });
  var order = {};
  order[APP.STATUS.ABANDONED] = 0; order[APP.STATUS.PENDING] = 1; order[APP.STATUS.CANCELLED] = 2;
  items.sort(function (a, b) { return (order[a.status] - order[b.status]) || String(b.sinceIso).localeCompare(String(a.sinceIso)); });
  var warnings = isAdmin_(user)
    ? rows.filter(function (r) { return isOpen_(r) && r['Peringatan pada'] instanceof Date; }).map(function (r) { return serialize_(r, c); })
    : [];
  return { serverNowIso: c.now.toISOString(), items: items, warnings: warnings };
}

/**
 * Keputusan review.
 * @param {{action:'CEK'|'SETUJU'|'HITUNG'|'KELUARKAN', note?:string, activeMin?:number}} p
 *   CEK      : Pending sudah dicek (Admin atau teknisi terkait). Pending tetap di daftar Pending.
 *   SETUJU   : Cancelled disetujui (Admin).
 *   HITUNG   : Abandoned dihitung ke MTTR dengan menit aktif hasil koreksi Admin.
 *   KELUARKAN: Abandoned dikeluarkan dari MTTR.
 */
function apiReview(id, p) {
  var user = requireUser_();
  p = p || {};
  var note = cleanText_(p.note, 500);
  withLock_(function () {
    var r = findById_(readTable_(APP.SHEETS.MAINT), id);
    if (!r) throw new Error('Maintenance tidak ditemukan.');
    if (r['Status review'] !== APP.REVIEW.NEEDED) throw new Error('Record ini tidak ada di antrian review.');
    if (!canDecide_(r, user)) throw new Error('Anda tidak berwenang mereview record ini.');
    var st = r['Status'], detail;
    var now = new Date();

    if (st === APP.STATUS.PENDING && p.action === 'CEK') {
      detail = 'Pending dicek';
    } else if (st === APP.STATUS.CANCELLED && p.action === 'SETUJU') {
      detail = 'Cancel disetujui';
    } else if (st === APP.STATUS.ABANDONED && (p.action === 'HITUNG' || p.action === 'KELUARKAN')) {
      if (!note) throw new Error('Catatan review wajib diisi untuk Abandoned.');
      if (p.action === 'HITUNG') {
        var min = Number(p.activeMin);
        var maxMin = (now.getTime() - r['Mulai'].getTime()) / 60000;
        if (!(isFinite(min) && min > 0 && min <= maxMin)) throw new Error('Menit aktif harus > 0 dan tidak lebih dari waktu sejak Mulai (' + Math.floor(maxMin) + ' menit).');
        detail = 'Dihitung ke MTTR: aktif ' + r['Total aktif (menit)'] + ' -> ' + round2_(min) + ' menit';
        r['Total aktif (menit)'] = round2_(min);
        r['Masuk MTTR'] = APP.MTTR.YES;
      } else {
        detail = 'Dikeluarkan dari MTTR';
        r['Masuk MTTR'] = APP.MTTR.NO;
      }
    } else {
      throw new Error('Keputusan review tidak valid untuk status ' + st + '.');
    }
    r['Status review'] = APP.REVIEW.DONE;
    r['Direview oleh'] = user.email;
    r['Direview pada'] = now;
    r['Catatan review'] = note;
    writeObj_(APP.SHEETS.MAINT, r);
    log_(now, r['Maintenance ID'], APP.EVENTS.REVIEW, user.email, detail + (note ? ' · ' + note : ''));
  });
  return apiListReview();
}

// ---------- QR ----------

function apiListLinesForQr() {
  requireUser_([APP.ROLES.ADMIN]);
  return {
    baseUrl: ScriptApp.getService().getUrl(),
    lines: readTable_(APP.SHEETS.LINES).map(serializeLine_)
  };
}
