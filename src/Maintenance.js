/**
 * State machine Maintenance 2.0.
 *
 *   start -> Aktif <-> Pause
 *            Aktif / Pause -> Pending -> (lanjut, user mana pun) -> Aktif
 *            Aktif         -> Completed
 *            Aktif / Pause -> Cancelled                     (alasan wajib, review admin)
 *            Aktif / Pause -> Abandoned                     (trigger, peringatan tidak dijawab)
 *
 * Waktu: setiap record menyimpan 'Status sejak'. Pada setiap perpindahan status, selisih
 * (sekarang - Status sejak) ditambahkan ke total milik status lama (aktif / pause / pending).
 * Hanya Total aktif yang masuk MTTR. Semua timestamp dibuat di server.
 *
 * Fungsi tanpa underscore = dipanggil dari client via google.script.run.
 */

function isOpen_(r) {
  return r['Status'] === APP.STATUS.ACTIVE || r['Status'] === APP.STATUS.PAUSE;
}

/** Tambahkan waktu yang berjalan sejak 'Status sejak' ke bucket status saat ini. */
function accrue_(r, now) {
  var since = r['Status sejak'];
  var col = APP.BUCKET[r['Status']];
  if (col && since instanceof Date) {
    var add = Math.max(0, (now.getTime() - since.getTime()) / 60000);
    r[col] = round2_(Number(r[col] || 0) + add);
  }
  r['Status sejak'] = now;
}

function transition_(r, to, now) {
  accrue_(r, now);
  r['Status'] = to;
}

function log_(now, id, event, user, detail) {
  appendObj_(APP.SHEETS.LOG, {
    'Timestamp': now, 'Maintenance ID': id, 'Kejadian': event,
    'User': user, 'Detail': cleanText_(detail, 1000)
  });
}

function addInvolved_(r, email) {
  var list = String(r['Teknisi terlibat'] || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (list.indexOf(email) === -1) list.push(email);
  r['Teknisi terlibat'] = list.join(', ');
}

function isInvolved_(r, email) {
  return String(r['Teknisi terlibat'] || '').split(',').some(function (s) { return s.trim().toLowerCase() === email; }) ||
    String(r['Teknisi awal']).toLowerCase() === email || String(r['Teknisi terakhir']).toLowerCase() === email;
}

function openForUser_(rows, email) {
  for (var i = 0; i < rows.length; i++) {
    if (isOpen_(rows[i]) && String(rows[i]['Teknisi terakhir']).toLowerCase() === email) return rows[i];
  }
  return null;
}

function openForLine_(rows, lineId) {
  var key = normLine_(lineId);
  for (var i = 0; i < rows.length; i++) {
    if (isOpen_(rows[i]) && normLine_(rows[i]['Line']) === key) return rows[i];
  }
  return null;
}

function findLine_(lineId) {
  var key = normLine_(lineId);
  if (!key) return null;
  var rows = readTable_(APP.SHEETS.LINES);
  for (var i = 0; i < rows.length; i++) {
    if (normLine_(rows[i]['Line ID']) === key) return rows[i];
  }
  return null;
}

/** Format ID: <LINE>-<yyMMdd>-<NN>, nomor urut per line per hari. Dipanggil di dalam lock. */
function newMaintenanceId_(rows, lineId, now) {
  var prefix = normLine_(lineId) + '-' + Utilities.formatDate(now, APP.TZ, 'yyMMdd') + '-';
  var max = 0;
  rows.forEach(function (r) {
    var id = String(r['Maintenance ID']);
    if (id.indexOf(prefix) === 0) {
      var n = parseInt(id.slice(prefix.length), 10);
      if (n > max) max = n;
    }
  });
  var next = max + 1;
  return prefix + (next < 10 ? '0' : '') + next;
}

/** Baterai terakhir yang dipakai di line ini (default pilihan saat Mulai). */
function lastBattery_(rows, lineId) {
  var key = normLine_(lineId), best = null;
  rows.forEach(function (r) {
    if (normLine_(r['Line']) !== key || !r['Baterai']) return;
    if (!best || (r['Mulai'] instanceof Date && r['Mulai'] > best['Mulai'])) best = r;
  });
  return best ? String(best['Baterai']) : '';
}

function requireOption_(opts, jenis, value, label) {
  var v = cleanText_(value, 200);
  if (!v) throw new Error(label + ' wajib dipilih.');
  if ((opts[jenis] || []).indexOf(v) === -1) throw new Error(label + ' "' + v + '" tidak ada di daftar pilihan.');
  return v;
}

/** Aksi kerja hanya oleh teknisi yang sedang memegang record. */
function assertOwner_(r, user, allowedStatuses) {
  if (!r) throw new Error('Maintenance tidak ditemukan.');
  if (allowedStatuses.indexOf(r['Status']) === -1) {
    throw new Error('Maintenance ' + r['Maintenance ID'] + ' berstatus ' + r['Status'] + '; aksi ini tidak bisa dilakukan.');
  }
  if (String(r['Teknisi terakhir']).toLowerCase() !== user.email) {
    throw new Error('Maintenance ini sedang dipegang teknisi lain.');
  }
}

/** Hanya satu 'Lainnya' yang wajib disertai catatan: supaya data tetap bisa dianalisis. */
function requireNoteForOther_(values, note) {
  if (values.indexOf(APP.OTHER) !== -1 && !note) throw new Error('Pilihan "Lainnya" wajib disertai catatan.');
}

// ---------- Tenggat pending ----------

function wibDayStart_(d, addDays) {
  var s = Utilities.formatDate(new Date(d.getTime() + (addDays || 0) * 86400000), APP.TZ, 'yyyy-MM-dd');
  return Utilities.parseDate(s + ' 00:00:00', APP.TZ, 'yyyy-MM-dd HH:mm:ss');
}

function endOfDay_(d, addDays) {
  return new Date(wibDayStart_(d, addDays).getTime() + 86400000 - 1000);
}

/** Akhir shift berikutnya = jam mulai shift sesudah shift berikutnya. */
function endOfNextShift_(now) {
  var mins = String(getConfig_('SHIFT_MULAI') || '').split(',').map(function (s) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }).filter(function (v) { return v !== null && v < 1440; });
  if (!mins.length) mins = [420, 900, 1380];
  var starts = [];
  for (var day = 0; day < 3; day++) {
    var base = wibDayStart_(now, day).getTime();
    mins.forEach(function (m) { starts.push(base + m * 60000); });
  }
  starts.sort(function (a, b) { return a - b; });
  var future = starts.filter(function (t) { return t > now.getTime(); });
  return new Date(future[1] || future[0]);
}

function computeDeadline_(kind, dateStr, now) {
  switch (kind) {
    case 'HARI_INI': return endOfDay_(now, 0);
    case 'SHIFT': return endOfNextShift_(now);
    case 'BESOK': return endOfDay_(now, 1);
    case 'TANGGAL':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) throw new Error('Tanggal tenggat tidak valid.');
      var d = new Date(Utilities.parseDate(dateStr + ' 00:00:00', APP.TZ, 'yyyy-MM-dd HH:mm:ss').getTime() + 86400000 - 1000);
      if (d < now) throw new Error('Tanggal tenggat tidak boleh di masa lalu.');
      return d;
    default: throw new Error('Tenggat wajib dipilih.');
  }
}

// ---------- Aksi teknisi ----------

/** Mulai: timer aktif berjalan + Maintenance ID dibuat pada saat yang sama. */
function apiStart(lineId, battery) {
  var user = requireUser_();
  var line = findLine_(lineId);
  if (!line) throw new Error('Line "' + lineId + '" tidak ditemukan.');
  if (!isYes_(line['Aktif'])) throw new Error('Line ' + line['Line ID'] + ' nonaktif.');
  var bat = requireOption_(getOptions_(), 'Baterai', battery, 'Baterai');

  withLock_(function () {
    var rows = readTable_(APP.SHEETS.MAINT);
    var mine = openForUser_(rows, user.email);
    if (mine) throw new Error('Anda masih punya maintenance ' + mine['Status'] + ' (' + mine['Maintenance ID'] + '). Selesaikan, pending, atau cancel dulu.');
    var other = openForLine_(rows, line['Line ID']);
    if (other) throw new Error('Line ' + line['Line ID'] + ' sedang dikerjakan (' + other['Maintenance ID'] + ').');

    var now = new Date();
    var r = {};
    r['Maintenance ID'] = newMaintenanceId_(rows, line['Line ID'], now);
    r['Line'] = normLine_(line['Line ID']);
    r['Baterai'] = bat;
    r['Status'] = APP.STATUS.ACTIVE;
    r['Teknisi awal'] = user.email;
    r['Teknisi terakhir'] = user.email;
    r['Teknisi terlibat'] = user.email;
    r['Mulai'] = now;
    r['Total aktif (menit)'] = 0;
    r['Total pause (menit)'] = 0;
    r['Total pending (menit)'] = 0;
    r['Status sejak'] = now;
    r['Konfirmasi terakhir'] = now;
    appendObj_(APP.SHEETS.MAINT, r);
    log_(now, r['Maintenance ID'], APP.EVENTS.START, user.email, 'Line ' + r['Line'] + ', baterai ' + bat);
  });
  return apiGetLine(line['Line ID']);
}

function apiPause(id, reason) {
  var user = requireUser_();
  var why = cleanText_(reason, 200);
  if (why && getOptions_()['Alasan Pause'].indexOf(why) === -1) throw new Error('Alasan pause tidak dikenal.');
  return mutate_(id, user, [APP.STATUS.ACTIVE], function (r, now) {
    transition_(r, APP.STATUS.PAUSE, now);
    r['Konfirmasi terakhir'] = now;
    r['Peringatan pada'] = '';
    return [APP.EVENTS.PAUSE, why ? 'Alasan: ' + why : ''];
  });
}

function apiResume(id) {
  var user = requireUser_();
  return mutate_(id, user, [APP.STATUS.PAUSE], function (r, now) {
    transition_(r, APP.STATUS.ACTIVE, now);
    r['Konfirmasi terakhir'] = now;
    r['Peringatan pada'] = '';
    return [APP.EVENTS.RESUME, ''];
  });
}

/** Jawaban "Masih lanjut" atas peringatan 3 jam. Timer TIDAK direset. */
function apiConfirmStillWorking(id) {
  var user = requireUser_();
  return mutate_(id, user, [APP.STATUS.ACTIVE, APP.STATUS.PAUSE], function (r, now) {
    r['Konfirmasi terakhir'] = now;
    r['Peringatan pada'] = '';
    return [APP.EVENTS.CONFIRM, 'Status ' + r['Status']];
  });
}

/**
 * @param {{dikerjakan:string, tertunda:string, tenggat:'HARI_INI'|'SHIFT'|'BESOK'|'TANGGAL', tanggal?:string, catatan?:string}} f
 */
function apiPending(id, f) {
  var user = requireUser_();
  f = f || {};
  var opts = getOptions_();
  var done = cleanText_(f.dikerjakan, 1000);
  if (!done) throw new Error('Pekerjaan yang sudah dilakukan wajib diisi.');
  var what = requireOption_(opts, 'Yang Tertunda', f.tertunda, 'Yang tertunda');
  var note = cleanText_(f.catatan, 500);
  requireNoteForOther_([what], note);

  return mutate_(id, user, [APP.STATUS.ACTIVE, APP.STATUS.PAUSE], function (r, now) {
    var deadline = computeDeadline_(f.tenggat, f.tanggal, now);
    transition_(r, APP.STATUS.PENDING, now);
    var stamp = '[' + Utilities.formatDate(now, APP.TZ, 'dd/MM HH:mm') + ' ' + user.name + '] ';
    r['Pekerjaan dilakukan'] = (r['Pekerjaan dilakukan'] ? r['Pekerjaan dilakukan'] + '\n' : '') + stamp + done;
    r['Yang tertunda'] = what;
    r['Tenggat'] = deadline;
    if (note) r['Catatan'] = (r['Catatan'] ? r['Catatan'] + '\n' : '') + stamp + note;
    r['Peringatan pada'] = '';
    r['Status review'] = APP.REVIEW.NEEDED;
    return [APP.EVENTS.PENDING, what + ' · tenggat ' + fmtDate_(deadline) + ' · ' + done + (note ? ' · ' + note : '')];
  });
}

/**
 * Lanjutkan pending (user mana pun). Wajib konfirmasi QR: scannedLineId harus sama dengan line record.
 * Timer pending berhenti, timer aktif lanjut dengan Maintenance ID yang sama.
 */
function apiContinue(id, scannedLineId) {
  var user = requireUser_();
  var lineId = withLock_(function () {
    var rows = readTable_(APP.SHEETS.MAINT);
    var r = findById_(rows, id);
    if (!r) throw new Error('Maintenance tidak ditemukan.');
    if (r['Status'] !== APP.STATUS.PENDING) throw new Error('Maintenance ' + id + ' tidak lagi Pending (status ' + r['Status'] + ').');
    if (normLine_(scannedLineId) !== normLine_(r['Line'])) {
      throw new Error('QR yang di-scan (' + (scannedLineId || '-') + ') bukan line ' + r['Line'] + '. Scan QR di line yang benar.');
    }
    var mine = openForUser_(rows, user.email);
    if (mine) throw new Error('Anda masih punya maintenance ' + mine['Status'] + ' (' + mine['Maintenance ID'] + ').');
    var other = openForLine_(rows, r['Line']);
    if (other) throw new Error('Line ' + r['Line'] + ' sedang dikerjakan (' + other['Maintenance ID'] + '). Tunggu selesai dulu.');

    var now = new Date();
    transition_(r, APP.STATUS.ACTIVE, now);
    r['Teknisi terakhir'] = user.email;
    addInvolved_(r, user.email);
    r['Konfirmasi terakhir'] = now;
    r['Peringatan pada'] = '';
    r['Status review'] = '';
    writeObj_(APP.SHEETS.MAINT, r);
    log_(now, r['Maintenance ID'], APP.EVENTS.CONTINUE, user.email, 'Konfirmasi QR ' + r['Line']);
    return r['Line'];
  });
  return apiGetLine(lineId);
}

/**
 * @param {{masalah:string, penyebab:string, penanganan:string, tanpaPart:boolean,
 *          parts:{nama:string, jumlah:number}[], catatan?:string}} f
 */
function apiComplete(id, f) {
  var user = requireUser_();
  f = f || {};
  var opts = getOptions_();
  var masalah = requireOption_(opts, 'Masalah', f.masalah, 'Masalah');
  var penyebab = requireOption_(opts, 'Penyebab', f.penyebab, 'Penyebab');
  var penanganan = requireOption_(opts, 'Penanganan', f.penanganan, 'Penanganan');
  var note = cleanText_(f.catatan, 500);
  requireNoteForOther_([masalah, penyebab, penanganan], note);

  var part;
  if (f.tanpaPart) {
    part = APP.NO_PART;
  } else {
    var list = (f.parts || []).map(function (p) {
      var name = requireOption_(opts, 'Part', p && p.nama, 'Part');
      var qty = Math.floor(Number(p.jumlah));
      if (!(qty >= 1 && qty <= 999)) throw new Error('Jumlah part "' + name + '" harus 1–999.');
      return name + ' x' + qty;
    });
    if (!list.length) throw new Error('Pilih part yang diganti, atau "Tidak ada".');
    part = list.join('; ');
  }

  return mutate_(id, user, [APP.STATUS.ACTIVE], function (r, now) {
    transition_(r, APP.STATUS.COMPLETED, now);
    r['Selesai'] = now;
    r['Masalah'] = masalah;
    r['Penyebab'] = penyebab;
    r['Penanganan'] = penanganan;
    r['Part'] = part;
    if (note) r['Catatan'] = (r['Catatan'] ? r['Catatan'] + '\n' : '') + note;
    r['Masuk MTTR'] = APP.MTTR.YES;
    r['Status review'] = '';
    r['Peringatan pada'] = '';
    return [APP.EVENTS.COMPLETE, masalah + ' / ' + penyebab + ' / ' + penanganan + ' / ' + part];
  });
}

/** Cancel: alasan wajib. Pemilik record, atau Admin untuk membersihkan record yang macet. */
function apiCancel(id, reason, catatan) {
  var user = requireUser_();
  var why = requireOption_(getOptions_(), 'Alasan Cancel', reason, 'Alasan cancel');
  var note = cleanText_(catatan, 500);
  requireNoteForOther_([why], note);

  var lineId = withLock_(function () {
    var rows = readTable_(APP.SHEETS.MAINT);
    var r = findById_(rows, id);
    if (!r) throw new Error('Maintenance tidak ditemukan.');
    if (!isOpen_(r)) throw new Error('Maintenance ' + id + ' berstatus ' + r['Status'] + '; tidak bisa di-cancel.');
    var owner = String(r['Teknisi terakhir']).toLowerCase() === user.email;
    if (!owner && !isAdmin_(user)) throw new Error('Hanya teknisi yang memegang (atau Admin) yang boleh cancel.');
    var now = new Date();
    transition_(r, APP.STATUS.CANCELLED, now);
    r['Alasan cancel'] = why + (note ? ': ' + note : '');
    r['Masuk MTTR'] = APP.MTTR.NO;
    r['Status review'] = APP.REVIEW.NEEDED;
    r['Peringatan pada'] = '';
    writeObj_(APP.SHEETS.MAINT, r);
    log_(now, r['Maintenance ID'], APP.EVENTS.CANCEL, user.email, r['Alasan cancel'] + (owner ? '' : ' (oleh Admin)'));
    return r['Line'];
  });
  return apiGetLine(lineId);
}

/** Pola umum: lock -> baca -> cek pemilik & status -> ubah -> tulis -> log. */
function mutate_(id, user, allowed, fn) {
  var lineId = withLock_(function () {
    var r = findById_(readTable_(APP.SHEETS.MAINT), id);
    assertOwner_(r, user, allowed);
    var now = new Date();
    var ev = fn(r, now);
    writeObj_(APP.SHEETS.MAINT, r);
    log_(now, r['Maintenance ID'], ev[0], user.email, ev[1]);
    return r['Line'];
  });
  return apiGetLine(lineId);
}

// ---------- Trigger: peringatan & Abandoned ----------

/**
 * Dijalankan time-driven trigger tiap 15 menit.
 * Acuan = Konfirmasi terakhir (diperbarui saat mulai, lanjut, pause, resume, "Masih lanjut").
 *  - >= WARN_HOURS dan belum diperingatkan -> Peringatan pada = now, email ke teknisi (jika diizinkan).
 *  - Sudah diperingatkan, >= ABANDON_HOURS dari acuan, dan sudah diberi waktu >= (ABANDON-WARN) sejak
 *    peringatan -> Abandoned. Syarat kedua mencegah Abandoned tanpa sempat diperingatkan bila trigger telat.
 */
function checkTimeouts() {
  var lim = getLimits_();
  var graceMs = (lim.abandonHours - lim.warnHours) * 3600000;
  var emails = [];
  var result = { warned: 0, abandoned: 0 };

  withLock_(function () {
    var now = new Date();
    readTable_(APP.SHEETS.MAINT).forEach(function (r) {
      if (!isOpen_(r)) return;
      var ref = r['Konfirmasi terakhir'] instanceof Date ? r['Konfirmasi terakhir'] : r['Mulai'];
      if (!(ref instanceof Date)) return;
      var age = now.getTime() - ref.getTime();
      var warned = r['Peringatan pada'] instanceof Date ? r['Peringatan pada'] : null;

      if (!warned && age >= lim.warnHours * 3600000) {
        r['Peringatan pada'] = now;
        writeObj_(APP.SHEETS.MAINT, r);
        log_(now, r['Maintenance ID'], APP.EVENTS.WARN, APP.SYSTEM_USER, '> ' + lim.warnHours + ' jam tanpa konfirmasi (' + r['Status'] + ')');
        emails.push(r);
        result.warned++;
      } else if (warned && age >= lim.abandonHours * 3600000 && now.getTime() - warned.getTime() >= graceMs) {
        transition_(r, APP.STATUS.ABANDONED, now);
        r['Masuk MTTR'] = APP.MTTR.WAITING;
        r['Status review'] = APP.REVIEW.NEEDED;
        writeObj_(APP.SHEETS.MAINT, r);
        log_(now, r['Maintenance ID'], APP.EVENTS.ABANDON, APP.SYSTEM_USER, 'Peringatan tidak dijawab');
        result.abandoned++;
      }
    });
  });

  if (emails.length && isYes_(getConfig_('EMAIL_PERINGATAN'))) {
    var url = ScriptApp.getService().getUrl();
    emails.forEach(function (r) {
      try {
        MailApp.sendEmail({
          to: String(r['Teknisi terakhir']),
          subject: '[MTTR] ' + r['Maintenance ID'] + ' sudah > ' + lim.warnHours + ' jam',
          body: 'Maintenance ' + r['Maintenance ID'] + ' di line ' + r['Line'] + ' berstatus ' + r['Status'] +
            ' lebih dari ' + lim.warnHours + ' jam tanpa konfirmasi.\n\n' +
            'Buka aplikasi dan pilih: Masih lanjut, Pending, atau Cancel.\n' +
            'Jika tidak dijawab sampai ' + lim.abandonHours + ' jam, status otomatis menjadi Abandoned.\n\n' + url
        });
      } catch (e) {
        console.warn('Email peringatan gagal untuk ' + r['Maintenance ID'] + ': ' + e);
      }
    });
  }
  if (result.warned || result.abandoned) console.log('checkTimeouts: ' + JSON.stringify(result));
  return result;
}
