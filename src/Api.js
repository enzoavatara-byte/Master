/**
 * API baca (beranda, halaman line, pending, riwayat, review, dashboard, QR) + keputusan review.
 * Date tidak boleh dikirim lewat google.script.run, jadi semua tanggal dikirim sebagai ISO string.
 */

function ctx_() {
  return { md: masterData_(), names: userNameMap_(), now: new Date() };
}

function nameOf_(c, email) {
  var e = String(email || '').toLowerCase();
  if (!e) return '';
  if (e === APP.SYSTEM_USER.toLowerCase()) return 'Sistem';
  return c.names[e] || e;
}

function serialize_(r, c) {
  var line = lineOf_(c.md, r['Line']);
  var tenggat = r['Tenggat'] instanceof Date ? r['Tenggat'] : null;
  var factory = factoryOfRecord_(c.md, r);
  return {
    id: String(r['Maintenance ID']),
    line: String(r['Line']),
    lineName: line ? line.name : '',
    grup: line ? line.grup : '',
    factory: factory,
    factoryName: c.md.factoryMap[factory] ? c.md.factoryMap[factory].name : factory,
    battery: String(r['Baterai'] || ''),
    tipe: String(r['Tipe'] || ''),
    mesinId: String(r['Mesin ID'] || ''),
    mesin: String(r['Nama Mesin'] || ''),
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
    reviewNote: String(r['Catatan review'] || ''),
    extra: extraFields_(r, c)
  };
}

/** Field tambahan (dibuat admin di sheet Form) untuk ditampilkan di Detail. */
function extraFields_(r, c) {
  var out = [];
  var system = ['Masalah', 'Penyebab', 'Penanganan', 'Yang tertunda', 'Alasan cancel', 'Catatan', 'Pekerjaan dilakukan'];
  APP.FORMS.forEach(function (f) {
    (c.md.forms[f] || []).forEach(function (d) {
      if (d.type === 'sistem' || system.indexOf(d.field) !== -1) return;
      if (r[d.field] !== undefined && r[d.field] !== '' && !out.some(function (o) { return o.label === d.label; })) {
        out.push({ label: d.label, value: String(r[d.field]) });
      }
    });
  });
  return out;
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

// ---------- Bootstrap & beranda ----------

/**
 * @param {string} lineId  dari QR (?line=)
 * @param {string} mesinId dari QR mesin (?mesin=)
 * @param {Object} filter  filter Beranda yang tersimpan di HP
 */
function apiBootstrap(lineId, mesinId, filter) {
  var user = requireUser_();
  var rows = readTable_(APP.SHEETS.MAINT);
  var c = ctx_();
  var mine = openForUser_(rows, user.email);
  if (!lineId && mesinId) lineId = lineOfMachine_(c.md, mesinId);
  return {
    user: user,
    serverNowIso: c.now.toISOString(),
    limits: getLimits_(),
    master: clientMaster_(c.md),
    myOpen: mine ? serialize_(mine, c) : null,
    counts: counts_(rows, user),
    stats: stats_(rows, c, filter),
    recent: recent_(rows, c, filter),
    lineView: lineId ? lineView_(lineId, rows, c, user, mesinId) : null
  };
}

/** Ringan: dipanggil ulang saat app kembali dibuka / tiap menit. */
function apiRefresh(filter) {
  var user = requireUser_();
  var rows = readTable_(APP.SHEETS.MAINT);
  var c = ctx_();
  var mine = openForUser_(rows, user.email);
  return {
    serverNowIso: c.now.toISOString(),
    myOpen: mine ? serialize_(mine, c) : null,
    counts: counts_(rows, user),
    stats: stats_(rows, c, filter),
    recent: recent_(rows, c, filter)
  };
}

/** QR mesin tanpa ?line=: cari line-nya (hanya jika mesin terdaftar di satu Line ID, bukan Grup). */
function lineOfMachine_(md, mesinId) {
  var id = normLine_(mesinId);
  var m = md.machines.filter(function (x) { return x.id === id; })[0];
  if (!m) return '';
  if (md.lines[m.line]) return m.line;
  var subs = Object.keys(md.lines).filter(function (k) { return md.lines[k].grup === m.line; });
  return subs.length === 1 ? subs[0] : '';
}

function counts_(rows, user) {
  var pending = 0, review = 0;
  rows.forEach(function (r) {
    if (r['Status'] === APP.STATUS.PENDING) pending++;
    if (reviewVisible_(r, user) || (isAdmin_(user) && isOpen_(r) && r['Peringatan pada'] instanceof Date)) review++;
  });
  return { pending: pending, review: review };
}

/** 7 hari terakhir (WIB): jumlah maintenance selesai per hari (semua tipe) + MTTR (hanya Masuk MTTR = Ya). */
function stats_(rows, c, filter) {
  var days = [], idx = {};
  var names = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(c.now.getTime() - i * 86400000);
    var key = Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd');
    var dow = Number(Utilities.formatDate(d, APP.TZ, 'u')) % 7; // 1=Senin..7=Minggu -> 0=Minggu
    idx[key] = days.length;
    days.push({ key: key, label: i === 0 ? 'Hari ini' : names[dow], count: 0 });
  }
  var sum = 0, n = 0, prev = 0;
  rows.forEach(function (r) {
    if (r['Status'] !== APP.STATUS.COMPLETED && r['Masuk MTTR'] !== APP.MTTR.YES) return;
    if (!matchFilter_(c.md, r, filter, c.names)) return;
    var when = r['Selesai'] instanceof Date ? r['Selesai'] : r['Status sejak'];
    if (!(when instanceof Date)) return;
    var k = Utilities.formatDate(when, APP.TZ, 'yyyy-MM-dd');
    if (!idx.hasOwnProperty(k)) return;
    days[idx[k]].count++;
    if (r['Masuk MTTR'] === APP.MTTR.YES) { sum += Number(r['Total aktif (menit)'] || 0); n++; }
    else prev++;
  });
  return { days: days, mttrMin: n ? round2_(sum / n) : null, mttrN: n, otherN: prev };
}

function recent_(rows, c, filter) {
  var byId = {};
  rows.forEach(function (r) { byId[String(r['Maintenance ID'])] = r; });
  return readTail_(APP.SHEETS.LOG, 80).reverse().filter(function (e) {
    var r = byId[String(e['Maintenance ID'])];
    return !filter || !r || matchFilter_(c.md, r, { factory: filter.factory, baterai: filter.baterai, line: filter.line }, c.names);
  }).slice(0, 8).map(function (e) {
    var r = byId[String(e['Maintenance ID'])];
    return {
      whenIso: iso_(e['Timestamp']),
      event: String(e['Kejadian']),
      userName: nameOf_(c, e['User']),
      id: String(e['Maintenance ID']),
      line: r ? String(r['Line']) : '',
      mesin: r ? String(r['Nama Mesin'] || '') : '',
      battery: r ? String(r['Baterai'] || '') : '',
      detail: String(e['Detail'] || '')
    };
  });
}

// ---------- Halaman line ----------

function apiGetLine(lineId, mesinId) {
  var user = requireUser_();
  return lineView_(lineId, readTable_(APP.SHEETS.MAINT), ctx_(), user, mesinId);
}

function lineView_(lineId, rows, c, user, mesinId) {
  var md = c.md;
  var line = lineOf_(md, lineId);
  if (!line) return { found: false, lineId: normLine_(lineId), serverNowIso: c.now.toISOString() };
  var mineRow = openForUser_(rows, user.email);
  var key = line.id;
  var opens = rows.filter(function (r) { return isOpen_(r) && normLine_(r['Line']) === key; });
  var mineHere = mineRow && normLine_(mineRow['Line']) === key ? mineRow : null;
  var others = opens.filter(function (r) { return r !== mineHere; });

  var busy = {};
  opens.forEach(function (r) { var k = machineKey_(r); busy[k || '*'] = r; });
  var lineBusy = busy['*'] || null;  // pekerjaan "seluruh line" mengunci semua mesin
  var machines = machinesForLine_(md, line).map(function (m) {
    var b = busy[m.id] || lineBusy;
    return { id: m.id, name: m.name, busyBy: b ? nameOf_(c, b['Teknisi terakhir']) : '', busyId: b ? String(b['Maintenance ID']) : '' };
  });

  var pendings = rows.filter(function (r) {
    return r['Status'] === APP.STATUS.PENDING && normLine_(r['Line']) === key;
  }).map(function (r) { return serialize_(r, c); });

  var last = lastBattery_(rows, key);
  var pre = normLine_(mesinId);
  var preMachine = pre ? machines.filter(function (m) { return m.id === pre; })[0] : null;
  var first = mineHere || others[0] || null;

  return {
    found: true,
    line: {
      id: line.id, name: line.name, factory: line.factory,
      factoryName: md.factoryMap[line.factory] ? md.factoryMap[line.factory].name : line.factory,
      batteries: line.batteries, grup: line.grup, area: line.area, active: line.active
    },
    open: first ? serialize_(first, c) : null,
    openIsMine: !!(first && first === mineHere),
    others: others.map(function (r) { return serialize_(r, c); }),
    lineLocked: !!lineBusy && lineBusy !== mineHere,
    machines: machines,
    preselectMesin: preMachine ? preMachine.id : '',
    unknownMesin: pre && !preMachine ? pre : '',
    myOpenElsewhere: (mineRow && !mineHere) ? serialize_(mineRow, c) : null,
    pendings: sortPending_(pendings),
    lastBattery: line.batteries.indexOf(last) !== -1 ? last : (line.batteries[0] || ''),
    bom: bomForLine_(key),
    serverNowIso: c.now.toISOString()
  };
}

// ---------- BOM ----------

/** BOM aktif untuk satu line: baris Line ID = line, Grup-nya, atau '*'. Sheet BOM belum ada -> []. */
function bomForLine_(lineId) {
  if (!SpreadsheetApp.getActive().getSheetByName(APP.SHEETS.BOM)) return [];
  var md = masterData_();
  var line = lineOf_(md, lineId);
  var key = normLine_(lineId), grup = line ? line.grup : '';
  var machineName = {};
  md.machines.forEach(function (m) { machineName[m.id] = m.name; });
  return readTable_(APP.SHEETS.BOM).filter(function (b) {
    var l = normLine_(b['Line ID']);
    return isActiveRow_(b['Aktif']) && String(b['Nama Part'] || '').trim() && (l === key || (grup && l === grup) || l === '*');
  }).map(function (b) {
    var pn = String(b['Part Number'] || '').trim();
    var name = String(b['Nama Part']).trim();
    var mid = normLine_(b['Mesin ID']);
    return {
      pn: pn,
      name: name,
      mesinId: mid,
      mesin: mid ? (machineName[mid] || mid) : '',
      qty: b['Qty Terpasang'] === '' ? '' : String(b['Qty Terpasang']),
      unit: String(b['Satuan'] || ''),
      location: String(b['Lokasi Simpan'] || ''),
      minStock: b['Stok Minimum'] === '' ? '' : String(b['Stok Minimum']),
      common: normLine_(b['Line ID']) === '*',
      value: pn ? pn + ' ' + name : name
    };
  }).sort(function (a, b) { return (a.common - b.common) || a.mesin.localeCompare(b.mesin) || a.name.localeCompare(b.name); });
}

function apiGetBom(lineId) {
  requireUser_();
  return bomForLine_(lineId);
}

// ---------- Pending ----------

function apiListPending(filter) {
  requireUser_();
  var c = ctx_();
  var list = readTable_(APP.SHEETS.MAINT)
    .filter(function (r) { return r['Status'] === APP.STATUS.PENDING && matchFilter_(c.md, r, filter, c.names); })
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

/** @param {{scope?:'mine'|'all', status?:string, tipe?:string, factory?, baterai?, battery?, line?, q?}} f  scope 'all' hanya Admin. */
function apiHistory(f) {
  var user = requireUser_();
  f = f || {};
  if (f.battery && !f.baterai) f.baterai = f.battery;
  var all = f.scope === 'all' && isAdmin_(user);
  var c = ctx_();
  var rows = readTable_(APP.SHEETS.MAINT).filter(function (r) {
    if (!all && !isInvolved_(r, user.email)) return false;
    if (f.status && r['Status'] !== f.status) return false;
    if (f.tipe && String(r['Tipe'] || '') !== f.tipe) return false;
    return matchFilter_(c.md, r, f, c.names);
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

function apiListReview(filter) {
  var user = requireUser_();
  var c = ctx_();
  var rows = readTable_(APP.SHEETS.MAINT).filter(function (r) { return matchFilter_(c.md, r, filter, c.names); });
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
 *   HITUNG   : Abandoned dihitung dengan menit aktif hasil koreksi Admin (masuk MTTR hanya jika tipenya dihitung).
 *   KELUARKAN: Abandoned dikeluarkan dari MTTR.
 */
function apiReview(id, p, filter) {
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
        detail = 'Dihitung: aktif ' + r['Total aktif (menit)'] + ' -> ' + round2_(min) + ' menit';
        r['Total aktif (menit)'] = round2_(min);
        r['Masuk MTTR'] = countsForMttr_(r) ? APP.MTTR.YES : APP.MTTR.NO;
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
  return apiListReview(filter);
}

// ---------- Dashboard ----------

function inc_(map, key, minutes, mttr) {
  if (!map[key]) map[key] = { key: key, count: 0, minutes: 0, mttrSum: 0, mttrN: 0 };
  var o = map[key];
  o.count++;
  o.minutes += minutes;
  if (mttr) { o.mttrSum += minutes; o.mttrN++; }
  return o;
}

function topList_(map, n, extra) {
  return Object.keys(map).map(function (k) {
    var o = map[k];
    var out = { key: o.key, count: o.count, minutes: round2_(o.minutes), mttr: o.mttrN ? round2_(o.mttrSum / o.mttrN) : null };
    if (extra) extra(out, o);
    return out;
  }).sort(function (a, b) { return (b.count - a.count) || (b.minutes - a.minutes); }).slice(0, n);
}

/**
 * Agregasi untuk Dashboard. Dihitung di server supaya HP tidak menerima ribuan baris.
 * @param {{periode?:number, factory?, baterai?, line?}} f  periode = hari ke belakang (default 30), berdasarkan Mulai.
 */
function apiDashboard(f) {
  var user = requireUser_();
  f = f || {};
  var c = ctx_();
  var md = c.md;
  var days = [7, 30, 90, 365].indexOf(Number(f.periode)) !== -1 ? Number(f.periode) : 30;
  var from = new Date(c.now.getTime() - days * 86400000);
  var filt = { factory: f.factory, baterai: f.baterai, line: f.line };
  var all = readTable_(APP.SHEETS.MAINT).filter(function (r) { return matchFilter_(md, r, filt, c.names); });
  var inPeriod = all.filter(function (r) { return r['Mulai'] instanceof Date && r['Mulai'] >= from; });

  var kpi = { mttr: null, mttrN: 0, corrective: 0, preventive: 0, activeMin: 0, cancelled: 0, abandoned: 0,
    openNow: 0, pendingNow: 0, overdueNow: 0 };
  var sum = 0;
  var byMachine = {}, byLine = {}, byTech = {}, byProblem = {}, byOther = {};
  var mttrTypes = mttrTypes_();

  inPeriod.forEach(function (r) {
    var st = r['Status'];
    var min = Number(r['Total aktif (menit)'] || 0);
    var counted = r['Masuk MTTR'] === APP.MTTR.YES;
    var tipe = String(r['Tipe'] || '');
    if (st === APP.STATUS.CANCELLED) { kpi.cancelled++; return; }
    if (st === APP.STATUS.ABANDONED) kpi.abandoned++;
    if (st === APP.STATUS.COMPLETED) {
      if (!tipe || mttrTypes.indexOf(tipe.toLowerCase()) !== -1) kpi.corrective++; else kpi.preventive++;
      kpi.activeMin += min;
    }
    if (counted) { sum += min; kpi.mttrN++; }
    // Frekuensi: semua pekerjaan non-cancel (termasuk yang masih berjalan/pending) = seberapa sering mesin bermasalah.
    var mKey = r['Nama Mesin'] ? String(r['Nama Mesin']) : '(tanpa mesin)';
    inc_(byMachine, mKey + ' · ' + r['Line'], min, counted).line = String(r['Line']);
    inc_(byLine, String(r['Line']), min, counted);
    if (st === APP.STATUS.COMPLETED || counted) inc_(byTech, nameOf_(c, r['Teknisi terakhir']), min, counted);
    if (r['Masalah']) inc_(byProblem, String(r['Masalah']), min, counted);
    ['Nama Mesin', 'Masalah', 'Penyebab', 'Penanganan', 'Yang tertunda', 'Alasan cancel'].forEach(function (col) {
      var v = String(r[col] || '');
      if (v.indexOf(APP.OTHER_PREFIX) === 0) inc_(byOther, col + ' → ' + v.slice(APP.OTHER_PREFIX.length).trim().toLowerCase(), 0, false);
    });
  });
  kpi.mttr = kpi.mttrN ? round2_(sum / kpi.mttrN) : null;
  kpi.activeMin = round2_(kpi.activeMin);
  all.forEach(function (r) {
    if (isOpen_(r)) kpi.openNow++;
    if (r['Status'] === APP.STATUS.PENDING) {
      kpi.pendingNow++;
      if (r['Tenggat'] instanceof Date && r['Tenggat'] < c.now) kpi.overdueNow++;
    }
  });

  // Tren 12 minggu (tidak tergantung periode).
  var weeks = [];
  var weekMs = 7 * 86400000;
  for (var w = 11; w >= 0; w--) {
    var end = new Date(c.now.getTime() - w * weekMs);
    weeks.push({ startMs: end.getTime() - weekMs, endMs: end.getTime(), label: Utilities.formatDate(new Date(end.getTime() - weekMs + 86400000), APP.TZ, 'dd/MM'), count: 0, sum: 0, n: 0 });
  }
  all.forEach(function (r) {
    if (r['Status'] !== APP.STATUS.COMPLETED && r['Masuk MTTR'] !== APP.MTTR.YES) return;
    var t = (r['Selesai'] instanceof Date ? r['Selesai'] : r['Status sejak']);
    if (!(t instanceof Date)) return;
    for (var i = 0; i < weeks.length; i++) {
      if (t.getTime() > weeks[i].startMs && t.getTime() <= weeks[i].endMs) {
        weeks[i].count++;
        if (r['Masuk MTTR'] === APP.MTTR.YES) { weeks[i].sum += Number(r['Total aktif (menit)'] || 0); weeks[i].n++; }
        break;
      }
    }
  });

  // Project: fase & target dari sheet Projects + angka otomatis.
  var projects = md.projects.filter(function (p) {
    return (!f.factory || p.factory === normLine_(f.factory)) && (!f.baterai || p.battery === f.baterai);
  }).map(function (p) {
    var rowsP = all.filter(function (r) { return String(r['Baterai']) === p.battery && (!p.factory || factoryOfRecord_(md, r) === p.factory); });
    var per = rowsP.filter(function (r) { return r['Mulai'] instanceof Date && r['Mulai'] >= from && r['Masuk MTTR'] === APP.MTTR.YES; });
    var s = per.reduce(function (a, r) { return a + Number(r['Total aktif (menit)'] || 0); }, 0);
    var mttr = per.length ? round2_(s / per.length) : null;
    var pend = rowsP.filter(function (r) { return r['Status'] === APP.STATUS.PENDING; });
    return {
      factory: p.factory, factoryName: md.factoryMap[p.factory] ? md.factoryMap[p.factory].name : p.factory,
      battery: p.battery, fase: p.fase, catatan: p.catatan, target: p.target,
      mttr: mttr, n: per.length,
      openNow: rowsP.filter(isOpen_).length,
      pendingNow: pend.length,
      overdueNow: pend.filter(function (r) { return r['Tenggat'] instanceof Date && r['Tenggat'] < c.now; }).length,
      health: (p.target && mttr !== null) ? (mttr <= p.target ? 'ok' : 'over') : ''
    };
  });

  return {
    serverNowIso: c.now.toISOString(),
    periode: days,
    kpi: kpi,
    weeks: weeks.map(function (x) { return { label: x.label, count: x.count, mttr: x.n ? round2_(x.sum / x.n) : null }; }),
    machines: topList_(byMachine, 10, function (out, o) { out.line = o.line; }),
    lines: topList_(byLine, 10),
    techs: topList_(byTech, 10),
    problems: topList_(byProblem, 8),
    others: topList_(byOther, 10),
    projects: projects,
    warnings: isAdmin_(user) ? md.warnings.slice(0, 30) : [],
    mttrTypes: String(getConfig_('MTTR_TIPE'))
  };
}

// ---------- QR ----------

function apiListLinesForQr() {
  requireUser_([APP.ROLES.ADMIN]);
  var md = masterData_();
  var lines = Object.keys(md.lines).map(function (k) { return md.lines[k]; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
  return {
    baseUrl: ScriptApp.getService().getUrl(),
    lines: lines.map(function (l) {
      return {
        id: l.id, name: l.name, area: l.area, active: l.active, grup: l.grup,
        factoryName: md.factoryMap[l.factory] ? md.factoryMap[l.factory].name : l.factory,
        machines: machinesForLine_(md, l).map(function (m) { return { id: m.id, name: m.name }; })
      };
    })
  };
}
