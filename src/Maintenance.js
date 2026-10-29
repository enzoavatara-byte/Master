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
    'User': user, 'Detail': cleanText_(detail, 3000)   // 2.6.4: 15 PIC + 20 sparepart tidak terpotong
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


/** Kunci mesin pekerjaan lama (sebelum 2.6): Mesin ID / "Lainnya: <nama>". Pekerjaan 2.6 = '' (seluruh line = unit). */
function machineKey_(r) {
  return normLine_(r['Mesin ID']) || String(r['Nama Mesin'] || '').trim().toUpperCase();
}

/**
 * Pekerjaan terbuka yang bentrok di line yang sama. Sejak 2.6 key selalu '' → satu pekerjaan terbuka per line;
 * pekerjaan lama ber-mesin (pending dari versi sebelumnya) hanya bentrok dengan mesin yang sama atau pekerjaan seluruh line.
 */
function openConflict_(rows, lineId, key, exceptId) {
  var line = normLine_(lineId);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!isOpen_(r) || normLine_(r['Line']) !== line || String(r['Maintenance ID']) === String(exceptId || '')) continue;
    var k = machineKey_(r);
    if (!key || !k || k === key) return r;
  }
  return null;
}

function conflictMsg_(r, names) {
  var who = (names && names[String(r['Teknisi terakhir']).toLowerCase()]) || r['Teknisi terakhir'];
  return (r['Nama Mesin'] ? 'Mesin ' + r['Nama Mesin'] : 'Line ' + r['Line']) + ' sedang dikerjakan ' + who + ' (' + r['Maintenance ID'] + ').';
}

/** Format ID: <LINE>-<yyMMdd>-<NN>, nomor urut per line per hari. Dipanggil di dalam lock. */
/**
 * ID baru = line + tanggal + urutan. `rows` = ekor tab (readHot_) atau seluruh tab (`full`, Input Manual).
 * 2.6.9: tab yang diurutkan / disaring admin bisa membuat ID hari ini tidak ada di ekor → ID calon dicek ke server
 * (TextFinder kolom ID, ±0,1 dtk, masih sebelum tulisan pertama → tidak ada kirim-terpaksa) dan dinaikkan sampai belum dipakai.
 */
function newMaintenanceId_(rows, lineId, now, full) {
  var prefix = normLine_(lineId) + '-' + fmtTz_(now, 'yyMMdd') + '-';
  var max = 0;
  rows.forEach(function (r) {
    var id = String(r['Maintenance ID']);
    if (id.indexOf(prefix) === 0) {
      var n = parseInt(id.slice(prefix.length), 10);
      if (n > max) max = n;
    }
  });
  var make = function (n) { return prefix + (n < 10 ? '0' : '') + n; };
  var next = max + 1;
  if (!full) {
    var used = idTerpakai_(make(next));
    if (used) {   // ekor tidak lengkap: lompat ke jumlah ID berawalan sama, lalu cari yang kosong
      next = Math.max(next, idTerpakai_('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d+$', true) + 1);
      for (var guard = 0; guard < 200 && idTerpakai_(make(next)); guard++) next++;
    }
  }
  return make(next);
}

/** Jumlah sel kolom Maintenance ID yang persis `text` (atau cocok regex). Gagal membaca → 0 (perilaku lama). */
function idTerpakai_(text, regex) {
  try {
    var sh = sheet_(APP.SHEETS.MAINT), last = sh.getLastRow();
    if (last < 2) return 0;
    var c = headers_(sh, APP.SHEETS.MAINT).indexOf('Maintenance ID');
    if (c < 0) return 0;
    var f = sh.getRange(2, c + 1, last - 1, 1).createTextFinder(text).matchEntireCell(true);
    if (regex) f = f.useRegularExpression(true);
    return f.findAll().length;
  } catch (e) { return 0; }
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

// ---------- Tenggat pending ----------

function wibDayStart_(d, addDays) {
  var s = fmtTz_(new Date(d.getTime() + (addDays || 0) * 86400000), 'yyyy-MM-dd');
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

/** Input form dari client: {values:{field:nilai}, other:{field:teks Lainnya}, ...}. String = nilai field pertama (kompatibel 2.0). */
function formInput_(input, firstField) {
  if (input == null || typeof input !== 'object') {
    var o = { values: {}, other: {} };
    if (input) o.values[firstField] = input;
    return o;
  }
  input.values = input.values || {};
  input.other = input.other || {};
  return input;
}

/** Nama teknisi (dari sheet Users) ikut ditulis di samping email: hasil akhir menampilkan nama, email tetap jadi ID. */
function setNames_(r) {
  var names = userNameMap_();
  var nm = function (e) { e = String(e || '').trim().toLowerCase(); return names[e] || e; };
  r['Nama PIC'] = nm(r['Teknisi terakhir']);
  r['Nama teknisi awal'] = nm(r['Teknisi awal']);
  r['Nama teknisi terlibat'] = String(r['Teknisi terlibat'] || '').split(',').map(function (e) { return e.trim(); })
    .filter(String).map(nm).join(', ');
}

/** Stop line: Ya/Tidak dari form; kosong → otomatis Ya untuk tipe di Config STOP_LINE_DEFAULT (default Corrective). */
function stopLineValue_(md, value, tipe) {
  if (!fieldDef_(md, 'Mulai', 'Stop line')) return '';
  var v = cleanText_(value, 10);
  if (v === APP.YES || v === APP.NO) return v;
  if (v) throw new Error('Stop line harus "Ya" atau "Tidak".');
  var types = splitList_(getConfig_('STOP_LINE_DEFAULT')).map(function (t) { return t.toLowerCase(); });
  return types.indexOf(String(tipe).toLowerCase()) !== -1 ? APP.YES : APP.NO;
}

function appendStamped_(r, col, text, now, user) {
  if (!text) return;
  var stamp = '[' + fmtTz_(now, 'dd/MM HH:mm') + ' ' + user.name + '] ';
  r[col] = (r[col] ? r[col] + '\n' : '') + stamp + text;
}

/** Simpan field form ke record. Pekerjaan dilakukan & Catatan ditambahkan (riwayat), sisanya ditimpa. */
function applyFormValues_(r, values, now, user) {
  Object.keys(values).forEach(function (f) {
    if (f === 'Pekerjaan dilakukan' || f === 'Catatan') appendStamped_(r, f, values[f], now, user);
    else r[f] = values[f];
  });
}

/**
 * Mulai: timer aktif berjalan + Maintenance ID dibuat pada saat yang sama.
 * @param {{tipe?:string, baterai:string, stopLine?:string, values?:Object, other?:Object}|string} p
 *   string = baterai (kompatibel 2.0). Sejak 2.6 tidak ada pilihan mesin (line = unit); `mesin` dari klien lama diabaikan.
 */
function apiStart(lineId, p) {
  var user = requireUser_();
  if (typeof p !== 'object' || p === null) p = { baterai: p };
  var md = masterData_();
  var line = lineOf_(md, lineId);
  if (!line) throw new Error('Line "' + lineId + '" tidak ditemukan.');
  if (!line.active) throw new Error('Line ' + line.id + ' nonaktif.');

  var bat = cleanText_(p.baterai, 50);
  if (!bat) throw new Error('Baterai wajib dipilih.');
  if (line.batteries.indexOf(bat) === -1) {
    throw new Error('Baterai "' + bat + '" tidak ada di daftar pilihan untuk line ' + line.id + ' (' + line.batteries.join(', ') + ').');
  }

  var tipeDef = fieldDef_(md, 'Mulai', 'Tipe');
  var tipes = md.options[tipeDef.source] || ['Corrective'];
  var tipe = cleanText_(p.tipe, 50) || tipes[0];
  if (tipes.indexOf(tipe) === -1) throw new Error('Tipe maintenance "' + tipe + '" tidak ada di daftar pilihan.');

  var custom = validateForm_(md, 'Mulai', p);
  var stop = stopLineValue_(md, p.stopLine, tipe);

  var rows = withLock_(function () {
    var rows = readHot_();   // 2.6.3: ekor + pekerjaan terbuka/pending (pekerjaan saya, bentrok line, ID hari ini ada di sini)
    var mine = openForUser_(rows, user.email);
    if (mine) throw new Error('Anda masih punya maintenance ' + mine['Status'] + ' (' + mine['Maintenance ID'] + '). Selesaikan, pending, atau cancel dulu.');
    var other = openConflict_(rows, line.id, '');
    if (other) throw new Error(conflictMsg_(other, userNameMap_()));

    var now = new Date();
    var r = {};
    r['Maintenance ID'] = newMaintenanceId_(rows, line.id, now);
    r['Line'] = line.id;
    r['Factory'] = line.factory;
    r['Proses'] = line.proses;
    r['Stop line'] = stop;
    r['Baterai'] = bat;
    r['Tipe'] = tipe;
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
    ensureMaintColumns_(Object.keys(custom.values));
    applyFormValues_(r, custom.values, now, user);
    setNames_(r);
    var plan = planWrites_(r, [APP.SHEETS.MAINT, APP.SHEETS.LOG], true);   // 2.6.8 K8: baca dulu, tulis sekali
    try {
      appendObj_(APP.SHEETS.MAINT, r);
      log_(now, r['Maintenance ID'], APP.EVENTS.START, user.email,
        [tipe, 'Line ' + r['Line'], 'baterai ' + bat, stop ? 'stop line ' + stop : ''].concat(custom.summary).filter(String).join(', '));
      rows.push(r);
      syncReports_(r, rows, null, plan.lap);
    } finally { endWrites_(); }
    return rows;
  });
  return lineView_(line.id, rows, ctx_(), user);
}

/** Pause: field form Pause hanya dicatat di Log (pause bisa terjadi berkali-kali). */
function apiPause(id, input) {
  var user = requireUser_();
  var md = masterData_();
  var f = validateForm_(md, 'Pause', formInput_(input, 'Alasan pause'));
  return mutate_(id, user, [APP.STATUS.ACTIVE], function (r, now) {
    transition_(r, APP.STATUS.PAUSE, now);
    r['Konfirmasi terakhir'] = now;
    r['Peringatan pada'] = '';
    return [APP.EVENTS.PAUSE, f.summary.join(' · ')];
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
 * @param {{values:Object, other?:Object, tenggat:'HARI_INI'|'SHIFT'|'BESOK'|'TANGGAL', tanggal?:string}} input
 */
function apiPending(id, input) {
  var user = requireUser_();
  var md = masterData_();
  input = formInput_(input, 'Pekerjaan dilakukan');
  var f = validateForm_(md, 'Pending', input);

  return mutate_(id, user, [APP.STATUS.ACTIVE, APP.STATUS.PAUSE], function (r, now) {
    var deadline = computeDeadline_(input.tenggat, input.tanggal, now);
    ensureMaintColumns_(Object.keys(f.values));
    transition_(r, APP.STATUS.PENDING, now);
    applyFormValues_(r, f.values, now, user);
    r['Tenggat'] = deadline;
    r['Peringatan pada'] = '';
    return [APP.EVENTS.PENDING, ['Tenggat ' + fmtDate_(deadline)].concat(f.summary).join(' · ')];
  });
}

/**
 * Lanjutkan pending (user mana pun). Wajib konfirmasi QR: scannedLineId harus sama dengan line record.
 * Timer pending berhenti, timer aktif lanjut dengan Maintenance ID yang sama.
 */
function apiContinue(id, scannedLineId) {
  var user = requireUser_();
  var res = withLock_(function () {
    var rows = readHot_();
    var r = findHot_(rows, id);
    if (!r) throw new Error('Maintenance tidak ditemukan.');
    if (r['Status'] !== APP.STATUS.PENDING) throw new Error('Maintenance ' + id + ' tidak lagi Pending (status ' + r['Status'] + ').');
    if (normLine_(scannedLineId) !== normLine_(r['Line'])) {
      throw new Error('QR yang di-scan (' + (scannedLineId || '-') + ') bukan line ' + r['Line'] + '. Scan QR di line yang benar.');
    }
    var mine = openForUser_(rows, user.email);
    if (mine) throw new Error('Anda masih punya maintenance ' + mine['Status'] + ' (' + mine['Maintenance ID'] + ').');
    var other = openConflict_(rows, r['Line'], machineKey_(r), r['Maintenance ID']);
    if (other) throw new Error(conflictMsg_(other, userNameMap_()) + ' Tunggu selesai dulu.');

    var now = new Date();
    transition_(r, APP.STATUS.ACTIVE, now);
    r['Teknisi terakhir'] = user.email;
    addInvolved_(r, user.email);
    setNames_(r);
    r['Konfirmasi terakhir'] = now;
    r['Peringatan pada'] = '';
    r['Status review'] = '';
    var plan = planWrites_(r, [APP.SHEETS.LOG]);   // 2.6.8 K8: baca dulu, tulis sekali
    try {
      writeObj_(APP.SHEETS.MAINT, r);
      log_(now, r['Maintenance ID'], APP.EVENTS.CONTINUE, user.email, 'Konfirmasi QR ' + r['Line']);
      syncReports_(r, rows, null, plan.lap);
    } finally { endWrites_(); }
    return { line: r['Line'], rows: rows };
  });
  return lineView_(res.line, res.rows, ctx_(), user);
}

/** Corrective (atau tipe lain di Config MTTR_TIPE) masuk MTTR; data 2.0 tanpa Tipe dianggap Corrective. */
function countsForMttr_(r) {
  var t = String(r['Tipe'] || '').trim().toLowerCase();
  return !t || mttrTypes_().indexOf(t) !== -1;
}

/**
 * Validasi daftar sparepart dari form Selesai.
 * @param {{id?:string, manual?:boolean, jenis?:string, nama?:string, model?:string, qty:number}[]} parts
 * @return {{jenis, nama, model, satuan, qty, manual}[]}
 */
function validateParts_(md, parts) {
  var byId = {};
  md.spareparts.forEach(function (p) { byId[p.id] = p; });
  var jenisOk = uniq_((md.options['Jenis Kerusakan'] || []).concat(md.spareparts.map(function (p) { return p.jenis; })));
  var out = (parts || []).map(function (p) {
    p = p || {};
    var qty = Math.floor(Number(p.qty));
    var item;
    if (p.manual) {
      var nama = cleanText_(p.nama, 120), jenis = cleanText_(p.jenis, 60);
      if (!nama) throw new Error('Sparepart manual: nama sparepart wajib diisi.');
      if (jenisOk.indexOf(jenis) === -1) throw new Error('Sparepart manual "' + nama + '": pilih jenis sparepart.');
      item = { jenis: jenis, nama: nama, model: cleanText_(p.model, 120), satuan: '', manual: true };
    } else {
      var c = byId[String(p.id || '')];
      if (!c) throw new Error('Sparepart tidak ditemukan di katalog (mungkin baru diubah admin). Muat ulang aplikasi lalu pilih lagi.');
      item = { jenis: c.jenis, nama: c.nama, model: c.model, satuan: c.satuan, manual: false };
    }
    if (!(qty >= 1 && qty <= 999)) throw new Error('Jumlah "' + item.nama + '" harus 1–999.');
    item.qty = qty;
    return item;
  });
  // Part yang sama dipilih dua kali → digabung.
  var merged = [], idx = {};
  out.forEach(function (p) {
    var k = (p.manual ? 'm|' : 'c|') + partId_(p.jenis, p.nama, p.model);
    if (idx.hasOwnProperty(k)) merged[idx[k]].qty += p.qty;
    else { idx[k] = merged.length; merged.push(p); }
  });
  if (merged.length > APP.PART_MAX) throw new Error('Sparepart maksimal ' + APP.PART_MAX + ' jenis per pekerjaan.');
  return merged;
}

/** Satu part per baris (bukan dipisah ";"), mis. "Motor Listrik ABB M2QA ×1". */
function partText_(parts) {
  if (!parts.length) return APP.NO_PART;
  return parts.map(function (p) {
    return p.nama + (p.model ? ' ' + p.model : '') + ' ×' + p.qty + (p.manual ? ' (manual)' : '');
  }).join('\n');
}

/** Tulis baris Pemakaian Sparepart sekaligus (satu panggilan). Dipanggil di dalam lock. */
function appendUsage_(r, parts, now) {
  if (!parts.length) return;
  var sh = sheet_(APP.SHEETS.PEMAKAIAN);
  var rows = usageRows_(headers_(sh, APP.SHEETS.PEMAKAIAN), r, parts, now);
  var at = rowsAt_(sh, APP.SHEETS.PEMAKAIAN, rows.length);
  sh.getRange(at, 1, rows.length, rows[0].length).setValues(rows);
}

/** Baris Pemakaian Sparepart untuk satu pekerjaan (juga dipakai Input Manual untuk tulisan sekaligus). */
function usageRows_(h, r, parts, now) {
  return parts.map(function (p) {
    return objToRow_(h, {
      'Tanggal': now, 'Maintenance ID': r['Maintenance ID'], 'Factory': r['Factory'], 'Line': r['Line'], 'Proses': r['Proses'],
      'Mesin': String(r['Nama Mesin'] || '').replace(APP.OTHER_PREFIX, ''), 'Baterai': r['Baterai'], 'Jenis kerusakan': r['Jenis kerusakan'],
      'Jenis Sparepart': p.jenis, 'Nama Sparepart': p.nama, 'Model': p.model, 'Jumlah': p.qty, 'Satuan': p.satuan,
      'Manual': p.manual ? APP.YES : APP.NO, 'PIC': r['Nama PIC'], 'Email PIC': r['Teknisi terakhir']
    }, true);
  });
}

/**
 * PIC tambahan saat Selesai (2.6): email dari sheet Users yang aktif, tanpa diri sendiri, tanpa dobel, maks APP.PIC_MAX (2.6.4: 15).
 * @return {string[]} email (huruf kecil)
 */
function validatePics_(md, pics, user) {
  var active = {};
  md.users.forEach(function (u) { if (u.email && isActiveRow_(u.aktif)) active[u.email] = true; });
  var out = [];
  (Array.isArray(pics) ? pics : []).forEach(function (e) {
    e = String(e || '').trim().toLowerCase();
    if (!e || e === user.email || out.indexOf(e) !== -1) return;
    if (!active[e]) throw new Error('PIC "' + e + '" tidak terdaftar / nonaktif di sheet Users.');
    out.push(e);
  });
  if (out.length > APP.PIC_MAX) throw new Error('PIC tambahan maksimal ' + APP.PIC_MAX + ' orang.');
  return out;
}

/**
 * @param {{values:Object, other?:Object, tanpaPart:boolean, parts:Object[], pics?:string[]}} input
 *   parts lihat validateParts_; pics = email PIC tambahan (ikut dihitung sebagai teknisi terlibat).
 */
function apiComplete(id, input) {
  var user = requireUser_();
  var md = masterData_();
  input = formInput_(input, 'Masalah');
  var f = validateForm_(md, 'Selesai', input);
  var pics = fieldDef_(md, 'Selesai', 'PIC tambahan') ? validatePics_(md, input.pics, user) : [];
  var names = pics.length ? userNameMap_() : {};
  var parts = [];
  if (!input.tanpaPart) {
    parts = validateParts_(md, input.parts);
    if (!parts.length) throw new Error('Pilih sparepart yang diganti, atau "' + APP.NO_PART + '".');
  }
  var part = partText_(parts);

  return mutate_(id, user, [APP.STATUS.ACTIVE], function (r, now) {
    ensureMaintColumns_(Object.keys(f.values));
    transition_(r, APP.STATUS.COMPLETED, now);
    r['Selesai'] = now;
    applyFormValues_(r, f.values, now, user);
    r['Part'] = part;
    r['Masuk MTTR'] = countsForMttr_(r) ? APP.MTTR.YES : APP.MTTR.NO;
    r['Status review'] = '';
    r['Peringatan pada'] = '';
    pics.forEach(function (e) { addInvolved_(r, e); });
    setNames_(r);
    appendUsage_(r, parts, now);
    var extra = pics.length ? ['PIC tambahan: ' + pics.map(function (e) { return names[e] || e; }).join(', ')] : [];
    return [APP.EVENTS.COMPLETE, f.summary.concat(['Sparepart: ' + part.replace(/\n/g, '; ')], extra).join(' · '), parts];
  });
}

/**
 * Cancel: alasan wajib. Pemilik record, atau Admin untuk membersihkan record yang macet.
 * @param {{values:Object, other?:Object}|string} input  string = alasan (kompatibel 2.0), catatan = argumen ke-3.
 */
function apiCancel(id, input, catatan) {
  var user = requireUser_();
  var md = masterData_();
  input = formInput_(input, 'Alasan cancel');
  if (catatan && !input.values['Catatan']) input.values['Catatan'] = catatan;
  if (catatan && input.values['Alasan cancel'] === APP.OTHER && !input.other['Alasan cancel']) input.other['Alasan cancel'] = catatan;
  var f = validateForm_(md, 'Cancel', input);

  var res = withLock_(function () {
    var rows = readHot_();
    var r = findHot_(rows, id);
    if (!r) throw new Error('Maintenance tidak ditemukan.');
    if (!isOpen_(r)) throw new Error('Maintenance ' + id + ' berstatus ' + r['Status'] + '; tidak bisa di-cancel.');
    var owner = String(r['Teknisi terakhir']).toLowerCase() === user.email;
    if (!owner && !isAdmin_(user)) throw new Error('Hanya teknisi yang memegang (atau Admin) yang boleh cancel.');
    var now = new Date();
    ensureMaintColumns_(Object.keys(f.values));
    transition_(r, APP.STATUS.CANCELLED, now);
    applyFormValues_(r, f.values, now, user);
    r['Masuk MTTR'] = APP.MTTR.NO;
    r['Status review'] = '';   // 2.6.1: Cancel tanpa review (satu-satunya keputusan dulu "Setujui"); alasan tercatat di Log
    r['Peringatan pada'] = '';
    var plan = planWrites_(r, [APP.SHEETS.LOG]);   // 2.6.8 K8: baca dulu, tulis sekali
    try {
      writeObj_(APP.SHEETS.MAINT, r);
      log_(now, r['Maintenance ID'], APP.EVENTS.CANCEL, user.email, f.summary.join(' · ') + (owner ? '' : ' (oleh Admin)'));
      syncReports_(r, rows, null, plan.lap);
    } finally { endWrites_(); }
    return { line: r['Line'], rows: rows };
  });
  return lineView_(res.line, res.rows, ctx_(), user);
}

/** Pola umum: lock -> baca -> cek pemilik & status -> ubah -> tulis -> log. */
function mutate_(id, user, allowed, fn) {
  var res = withLock_(function () {
    var rows = readHot_();
    var r = findHot_(rows, id);
    assertOwner_(r, user, allowed);
    var now = new Date();
    // 2.6.8 K8: semua baca sebelum tulisan pertama → satu kali kirim. Pemakaian dibaca di fn (Selesai), juga sebelum tulisan.
    var plan = planWrites_(r, [APP.SHEETS.LOG]);
    pastikanBaris_(r);   // 2.6.11: sebelum tulisan pertama (Selesai menulis Pemakaian dulu di fn)
    try {
      var ev = fn(r, now);    // [kejadian, detail log, sparepart (khusus Selesai)]
      setNames_(r);
      writeObj_(APP.SHEETS.MAINT, r);
      log_(now, r['Maintenance ID'], ev[0], user.email, ev[1]);
      syncReports_(r, rows, ev[2], plan.lap);
    } finally { endWrites_(); }
    return { line: r['Line'], rows: rows };
  });
  // Tampilan dihitung dari data yang sudah ada di memori (r ikut berubah di dalam rows) → tanpa baca ulang.
  return lineView_(res.line, res.rows, ctx_(), user);
}

// ---------- Ketuk ulang tanpa dobel (2.6.4) ----------

var RID_TTL_ = 21600;      // detik: rid yang sukses diingat 6 jam (batas CacheService)
var RID_RUN_ = '…';        // nilai rid selama aksinya berjalan (kedaluwarsa sendiri bila eksekusi mati)
var RID_WAIT_MS_ = 15000;  // ketukan ulang menunggu aksi pertama yang masih berjalan, paling lama sekian

/**
 * Aksi teknisi dengan ID permintaan (rid) dari HP. Sinyal putus SESUDAH server menyimpan → HP tidak menerima jawaban →
 * teknisi mengetuk lagi dengan rid yang sama → aksi tidak diulang (tidak ada pekerjaan / Log dobel, tidak ada error
 * "berstatus Completed"); halaman line terbaru dikembalikan dengan `ulang: true`.
 * rid di CacheService: RID_RUN_ selama aksi berjalan, Line ID bila sukses; dihapus bila aksi gagal (ketuk ulang = coba lagi).
 * Tanpa rid (klien lama) = langsung menjalankan aksinya.
 */
function apiAct(fn, args, rid) {
  var impl = { apiStart: apiStart, apiPause: apiPause, apiResume: apiResume, apiPending: apiPending, apiContinue: apiContinue,
    apiComplete: apiComplete, apiCancel: apiCancel, apiConfirmStillWorking: apiConfirmStillWorking }[fn];
  if (!impl) throw new Error('Aksi tidak dikenal: ' + fn);
  args = Array.isArray(args) ? args : [];
  var id = String(rid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64), c = id ? scriptCache_() : null, key = c ? 'mttr-rid:' + id : '';
  // CacheService hanya pelengkap: bila Google sedang gangguan, aksi tetap jalan (tanpa perlindungan dobel), tidak pernah gagal karenanya
  var get = function () { try { return c.get(key); } catch (e) { return null; } };
  var put = function (v, ttl) { try { c.put(key, v, ttl); } catch (e) { /* lihat di atas */ } };
  if (key) {
    var seen = get();
    for (var t0 = Date.now(); seen === RID_RUN_ && Date.now() - t0 < RID_WAIT_MS_; seen = get()) Utilities.sleep(500);
    if (seen === RID_RUN_) throw new Error('Ketukan sebelumnya masih diproses. Tunggu sebentar, lalu buka ulang line ini.');
    if (seen) { var again = apiGetLine(seen); again.ulang = true; return again; }
    put(RID_RUN_, 120);
  }
  var v;
  try { v = impl.apply(null, args); } catch (e) {
    if (key) { try { c.remove(key); } catch (e2) { /* kedaluwarsa sendiri */ } }
    throw e;
  }
  if (key) put(v && v.line ? v.line.id : String(args[0] || ''), RID_TTL_);
  return v;
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
  try { var res = checkTimeoutsJalan_(); sehatCatat_('timeout', { at: new Date().toISOString(), gagal: '' }); return res; }
  catch (e) { sehatCatat_('timeout', { at: new Date().toISOString(), gagal: String(e && e.message || e) }); throw e; }
}

function checkTimeoutsJalan_() {
  resetMaster_();
  var lim = getLimits_();
  var graceMs = (lim.abandonHours - lim.warnHours) * 3600000;
  var emails = [];
  var result = { warned: 0, abandoned: 0 };

  withLock_(function () {
    var now = new Date();
    var rows = readHot_();   // hanya pekerjaan terbuka yang diperiksa: semuanya ada di baris panas
    rows.forEach(function (r) {
      if (!isOpen_(r)) return;
      var ref = r['Konfirmasi terakhir'] instanceof Date ? r['Konfirmasi terakhir'] : r['Mulai'];
      if (!(ref instanceof Date)) return;
      var age = now.getTime() - ref.getTime();
      var warned = r['Peringatan pada'] instanceof Date ? r['Peringatan pada'] : null;

      if (!warned && age >= lim.warnHours * 3600000) {
        r['Peringatan pada'] = now;
        writeObj_(APP.SHEETS.MAINT, r);
        log_(now, r['Maintenance ID'], APP.EVENTS.WARN, APP.SYSTEM_USER, '> ' + lim.warnHours + ' jam tanpa konfirmasi (' + r['Status'] + ')');
        syncReports_(r, rows);
        emails.push(r);
        result.warned++;
      } else if (warned && age >= lim.abandonHours * 3600000 && now.getTime() - warned.getTime() >= graceMs) {
        transition_(r, APP.STATUS.ABANDONED, now);
        r['Masuk MTTR'] = APP.MTTR.WAITING;
        r['Status review'] = APP.REVIEW.NEEDED;
        writeObj_(APP.SHEETS.MAINT, r);
        log_(now, r['Maintenance ID'], APP.EVENTS.ABANDON, APP.SYSTEM_USER, 'Peringatan tidak dijawab');
        syncReports_(r, rows);
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
