/**
 * Input Manual (2.6.1): admin mengetik pekerjaan yang tidak tercatat lewat aplikasi (riwayat WeChat, HP mati, lupa scan)
 * di tab "Input Manual", lalu menu spreadsheet → Masukkan Input Manual. Tiap baris diperiksa dengan aturan yang sama
 * dengan aplikasi (pilihan, sparepart, PIC), admin mengonfirmasi, baru ditulis sebagai pekerjaan Completed + Log
 * "input manual" + kolom Maintenance "Input manual oleh". Hasil per baris di kolom Hasil (✓ ID / ✗ alasan).
 * Tanggal & jam dibaca sebagai teks (format @) supaya "05/10/2026" dan "07.30" tidak ditafsirkan sesuai locale.
 */

var MANUAL_MAX_ = 200;   // baris per jalan (batas waktu Apps Script); sisanya jalan berikutnya
var MANUAL_DETAIL_ = { 'Masalah': 'Detail masalah', 'Penyebab': 'Detail penyebab', 'Penanganan': 'Detail penanganan' };

function menuInputManual() {
  var ui = SpreadsheetApp.getUi();
  var chk = apiInputManual({ periksa: true });
  if (!chk.ok) { ui.alert('Input Manual', chk.summary, ui.ButtonSet.OK); return; }
  var ask = ui.alert('Input Manual', chk.summary + '\n\nMasukkan ' + chk.ok + ' pekerjaan ke data sekarang?', ui.ButtonSet.YES_NO);
  if (ask !== ui.Button.YES) return;
  ui.alert('Input Manual', apiInputManual({}).summary, ui.ButtonSet.OK);
}

/**
 * @param {{periksa?: boolean}} opts periksa = hanya cek (baris salah diberi ✗), tanpa menulis data
 * @return {{ok:number, bad:number, more:number, ids:string[], closed:string[], summary:string}}
 */
function apiInputManual(opts) {
  var user = requireUser_([APP.ROLES.ADMIN]);
  opts = opts || {};
  var sh = findSheet_(APP.SHEETS.MANUAL);
  if (!sh) throw new Error('Tab "' + APP.SHEETS.MANUAL + '" belum ada. Jalankan setup.');
  var md = masterData_();
  var res = withLock_(function () {
    var plan = manualPlan_(md, sh, readTable_(APP.SHEETS.MAINT), user);
    if (!opts.periksa && plan.items.length) manualWrite_(md, plan, user);
    manualHasil_(sh, plan, !opts.periksa);
    return plan;
  });
  var closed = [];
  if (!opts.periksa && res.items.length) {
    var idx = kpiClosed_(), years = {};
    res.items.forEach(function (it) {
      years[yearOf_(it.r['Mulai'])] = true; years[yearOf_(it.r['Selesai'])] = true;
      var ym = ymOf_(it.r['Selesai']);
      if (idx[ym] && closed.indexOf(ym) === -1) closed.push(ym);
    });
    // Laporan & Rekap di dalam lock, KPI di luar. 2.6.2: TPM (menerjemahkan teks baru) tidak di sini — 1 baris sempat 99 dtk
    // dengan data setahun; tab TPM diperbarui trigger malam / Dashboard → Perbarui.
    Object.keys(years).forEach(function (y) { y = Number(y); withLock_(function () { buildRekap_(y); buildLaporan_(y); }); });
    Object.keys(years).forEach(function (y) { try { buildKpi_(Number(y)); } catch (e) { console.warn('KPI: ' + e); } });
  }
  var ok = res.items.length, bad = res.errors.length;
  var summary = opts.periksa
    ? (ok || bad ? ok + ' baris benar' + (bad ? ', ' + bad + ' salah (alasan di kolom Hasil)' : '') : 'Tidak ada baris baru di tab ' + APP.SHEETS.MANUAL + '.')
    : ok + ' pekerjaan dimasukkan' + (bad ? ', ' + bad + ' baris salah tidak dimasukkan (alasan di kolom Hasil)' : '') + '. Laporan, Rekap & KPI sudah diperbarui; tab TPM menyusul malam ini (atau Dashboard → Perbarui).';
  if (res.more) summary += ' · ' + res.more + ' baris lagi menunggu jalan berikutnya (maks ' + MANUAL_MAX_ + ' per jalan).';
  if (closed.length) summary += '\n⚠ Bulan KPI ' + closed.map(ymLabel_).join(', ') + ' sudah ditutup: tutup ulang supaya pekerjaan ini ikut dihitung.';
  return { ok: ok, bad: bad, more: res.more, ids: res.items.map(function (it) { return it.r['Maintenance ID']; }), closed: closed, summary: summary };
}

/** Baca tab Input Manual → {items:[{row, r, parts, detail}], errors:[{row, msg}], more}. Dipanggil di dalam lock. */
function manualPlan_(md, sh, mrows, user) {
  var last = sh.getLastRow(), h = headers_(sh, APP.SHEETS.MANUAL);
  var out = { items: [], errors: [], more: 0, h: h, last: last };
  if (last < 2) return out;
  var vals = sh.getRange(2, 1, last - 1, h.length).getValues(), disp = sh.getRange(2, 1, last - 1, h.length).getDisplayValues();
  var col = function (n) { return h.indexOf(n); }, hasil = col('Hasil');
  var all = mrows.slice(), now = new Date(), done = 0;
  vals.forEach(function (row, i) {
    var o = {}, d = {};
    h.forEach(function (k, j) { o[k] = row[j]; d[k] = String(disp[i][j] == null ? '' : disp[i][j]).trim(); });
    var main = ['Tanggal', 'Jam mulai', 'Jam selesai', 'Line', 'Masalah', 'PIC'];
    if (!main.some(function (k) { return d[k]; })) return;                       // baris kosong
    if (hasil >= 0 && /^✓/.test(d['Hasil'])) return;                           // sudah dimasukkan
    if (done >= MANUAL_MAX_) { out.more++; return; }
    done++;
    try {
      var it = manualRow_(md, o, d, all, user, now);
      it.row = i + 2;
      all.push(it.r);
      out.items.push(it);
    } catch (e) {
      out.errors.push({ row: i + 2, msg: String(e && e.message || e).replace(/^Error: /, '') });
    }
  });
  return out;
}

/** Satu baris → pekerjaan Completed (belum ditulis). Error = alasan untuk kolom Hasil. */
function manualRow_(md, o, d, all, user, now) {
  var ymd = manualDate_(o['Tanggal'], d['Tanggal']);
  if (!ymd) throw new Error('Tanggal "' + d['Tanggal'] + '" tidak terbaca (contoh: 22/10/2026).');
  var t1 = manualTime_(d['Jam mulai']), t2 = manualTime_(d['Jam selesai']);
  if (!t1) throw new Error('Jam mulai "' + d['Jam mulai'] + '" tidak terbaca (contoh: 07:30).');
  if (!t2) throw new Error('Jam selesai "' + d['Jam selesai'] + '" tidak terbaca (contoh: 08:15).');
  var mulai = Utilities.parseDate(ymd + ' ' + t1, APP.TZ, 'yyyy-MM-dd HH:mm');
  var selesai = Utilities.parseDate(ymd + ' ' + t2, APP.TZ, 'yyyy-MM-dd HH:mm');
  if (selesai <= mulai) selesai = new Date(selesai.getTime() + 86400000);        // lewat tengah malam
  if (selesai > now) throw new Error('Jam selesai di masa depan.');
  if (selesai - mulai > 86400000) throw new Error('Lebih dari 24 jam: pisahkan per hari.');

  var lineTxt = d['Line'], line = lineOf_(md, lineTxt) || lineOf_(md, lineTxt.split(/[\s·]/)[0]);
  if (!line) throw new Error('Line "' + lineTxt + '" tidak ada di tab Lines.');
  var bat = d['Baterai'];
  if (!bat) {
    if (line.batteries.length !== 1) throw new Error('Baterai wajib untuk line ' + line.id + ' (' + line.batteries.join(' / ') + ').');
    bat = line.batteries[0];
  } else {
    var b = line.batteries.filter(function (x) { return x.toLowerCase() === bat.toLowerCase(); })[0];
    if (!b) throw new Error('Baterai "' + bat + '" tidak ada untuk line ' + line.id + ' (' + line.batteries.join(' / ') + ').');
    bat = b;
  }
  var dup = all.filter(function (r) {
    return normLine_(r['Line']) === line.id && r['Mulai'] instanceof Date && Math.abs(r['Mulai'] - mulai) < 60000;
  })[0];
  if (dup) throw new Error('Sudah ada: ' + dup['Maintenance ID'] + ' (line & jam mulai sama).');

  var tipeDef = fieldDef_(md, 'Mulai', 'Tipe'), tipe = ((tipeDef && md.options[tipeDef.source]) || ['Corrective'])[0];
  var sl = d['Stop line'].toLowerCase();
  var stop = stopLineValue_(md, /^(ya|y|yes|1)$/.test(sl) ? APP.YES : (/^(tidak|t|no|0)$/.test(sl) ? APP.NO : d['Stop line']), tipe);

  var pic = manualUser_(md, d['PIC']);
  if (!pic) throw new Error(d['PIC'] ? 'PIC "' + d['PIC'] + '" tidak ada / nonaktif di Users.' : 'PIC wajib diisi.');
  var more = String(d['PIC tambahan'] || '').split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(String).map(function (x) {
    var u = manualUser_(md, x);
    if (!u) throw new Error('PIC tambahan "' + x + '" tidak ada / nonaktif di Users.');
    return u.email;
  });
  var pics = validatePics_(md, more, { email: pic.email });

  var input = { values: {}, other: {} };
  ['Jenis kerusakan', 'Masalah', 'Penyebab', 'Penanganan'].forEach(function (f) { manualChoice_(md, f, d[f], input); });
  (md.forms['Selesai'] || []).concat(md.forms['Mulai'] || []).forEach(function (def) {   // field buatan admin: kolom bernama sama
    if (def.type !== 'sistem' && input.values[def.field] === undefined && o.hasOwnProperty(def.field)) input.values[def.field] = d[def.field];
  });
  if (d['Catatan']) input.values['Catatan'] = d['Catatan'];
  var fs = validateForm_(md, 'Selesai', input), fm = validateForm_(md, 'Mulai', input);
  var parts = validateParts_(md, manualParts_(md, d['Sparepart'], stripOther_(fs.values['Jenis kerusakan'])));

  var r = {
    'Maintenance ID': newMaintenanceId_(all, line.id, mulai), 'Line': line.id, 'Factory': line.factory, 'Proses': line.proses,
    'Stop line': stop, 'Baterai': bat, 'Tipe': tipe, 'Status': APP.STATUS.COMPLETED,
    'Teknisi awal': pic.email, 'Teknisi terakhir': pic.email, 'Teknisi terlibat': [pic.email].concat(pics).join(', '),
    'Mulai': mulai, 'Selesai': selesai, 'Total aktif (menit)': round2_((selesai - mulai) / 60000),
    'Total pause (menit)': 0, 'Total pending (menit)': 0, 'Status sejak': selesai, 'Konfirmasi terakhir': selesai,
    'Part': partText_(parts), 'Status review': '', 'Input manual oleh': user.email
  };
  var who = { email: pic.email, name: pic.name || pic.email };   // cap catatan = jam selesai + nama PIC (seperti di aplikasi)
  applyFormValues_(r, fm.values, selesai, who);
  applyFormValues_(r, fs.values, selesai, who);
  r['Masuk MTTR'] = countsForMttr_(r) ? APP.MTTR.YES : APP.MTTR.NO;
  setNames_(r);
  return { r: r, parts: parts, fields: Object.keys(fm.values).concat(Object.keys(fs.values)), summary: fs.summary };
}

/** Tanggal: sel tanggal asli, atau teks dd/mm/yyyy · d-m-yy · yyyy-mm-dd → "yyyy-MM-dd". */
function manualDate_(v, txt) {
  if (v instanceof Date && v.getFullYear() > 1900) return fmtTz_(v, 'yyyy-MM-dd');
  var m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(txt), y, mo, dd;
  if (m) { dd = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; }
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(txt))) { y = +m[1]; mo = +m[2]; dd = +m[3]; }
  else return '';
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return '';
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dd < 10 ? '0' : '') + dd;
}

/** Jam: "07:30", "7.30", "0730" → "07:30". */
function manualTime_(txt) {
  var m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(txt) || /^(\d{1,2})(\d{2})$/.exec(txt);
  if (!m || +m[1] > 23 || +m[2] > 59) return '';
  return (+m[1] < 10 ? '0' : '') + +m[1] + ':' + m[2];
}

/** PIC: email atau nama di Users (aktif), tanpa huruf besar/kecil. */
function manualUser_(md, txt) {
  txt = String(txt || '').trim().toLowerCase();
  if (!txt) return null;
  return md.users.filter(function (u) {
    return isActiveRow_(u.aktif) && (u.email === txt || String(u.name || '').trim().toLowerCase() === txt);
  })[0] || null;
}

/**
 * Pilihan form dari teks bebas: cocok pilihan (atau label 中文 / English) → pilihan; "Sensor error – kabel putus" →
 * pilihan + detail; tidak cocok → "Lainnya: teks" bila boleh. Hasil dimasukkan ke input.values / input.other.
 */
function manualChoice_(md, field, txt, input) {
  var def = fieldDef_(md, 'Selesai', field);
  if (!def || def.type !== 'pilihan') return;
  txt = String(txt || '').trim();
  if (!txt) return;
  var opts = md.options[def.source] || [], find = function (s) {
    s = String(s).trim().toLowerCase();
    return opts.filter(function (v) {
      return v.toLowerCase() === s || String(md.tr.zh[v] || '').toLowerCase() === s || String(md.tr.en[v] || '').toLowerCase() === s;
    })[0] || '';
  };
  var hit = find(txt);
  if (hit) { input.values[field] = hit; return; }
  var m = /^(.+?)\s*(?:\s[–-]\s|:|：)\s*(.+)$/.exec(txt), detail = MANUAL_DETAIL_[field];
  if (m && find(m[1]) && detail && fieldDef_(md, 'Selesai', detail)) { input.values[field] = find(m[1]); input.values[detail] = m[2].trim(); return; }
  if (def.other) { input.values[field] = APP.OTHER; input.other[field] = txt; return; }
  throw new Error(def.label + ' "' + txt + '" tidak ada di daftar (' + opts.slice(0, 12).join(', ') + (opts.length > 12 ? ', …' : '') + ').');
}

/** Sparepart: satu per baris atau dipisah ";", jumlah di akhir "×2" / "x2" / "*2" / "(2)" (tanpa = 1). Katalog dulu, selain itu manual. */
function manualParts_(md, txt, jenis) {
  var out = [], norm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  String(txt || '').split(/\n|;/).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^(-|tidak ada.*)$/i.test(x); })
    .forEach(function (x) {
      var m = /^(.*?)\s*(?:[×xX*]\s*(\d+)|\((\d+)\))\s*$/.exec(x), name = m ? m[1].trim() : x, qty = m ? Number(m[2] || m[3]) : 1;
      var c = md.spareparts.filter(function (p) { return norm(p.nama + ' ' + p.model) === norm(name); })[0] ||
        md.spareparts.filter(function (p) { return norm(p.nama) === norm(name); })[0];
      out.push(c ? { id: c.id, qty: qty } : { manual: true, jenis: jenis, nama: name, qty: qty });
    });
  return out;
}

/** Tulis semua pekerjaan sekaligus: Maintenance, Pemakaian Sparepart, Log (tiap sheet satu tulisan). Di dalam lock. */
function manualWrite_(md, plan, user) {
  var fields = ['Input manual oleh'];
  plan.items.forEach(function (it) { it.fields.forEach(function (f) { if (fields.indexOf(f) === -1) fields.push(f); }); });
  ensureMaintColumns_(fields);
  var now = new Date();
  var put = function (name, rows) {
    if (!rows.length) return;
    var sh = sheet_(name), at = sh.getLastRow() + 1;
    ensureRows_(sh, at + rows.length - 1, 200);
    sh.getRange(at, 1, rows.length, rows[0].length).setValues(rows);
  };
  var mh = headers_(sheet_(APP.SHEETS.MAINT), APP.SHEETS.MAINT), uh = headers_(sheet_(APP.SHEETS.PEMAKAIAN)), lh = headers_(sheet_(APP.SHEETS.LOG));
  put(APP.SHEETS.MAINT, plan.items.map(function (it) { return objToRow_(mh, it.r, true); }));
  var usage = [];
  plan.items.forEach(function (it) { usage = usage.concat(usageRows_(uh, it.r, it.parts, it.r['Selesai'])); });
  put(APP.SHEETS.PEMAKAIAN, usage);
  put(APP.SHEETS.LOG, plan.items.map(function (it) {
    var r = it.r, f = function (d, p) { return fmtTz_(d, p); };
    return objToRow_(lh, { 'Timestamp': now, 'Maintenance ID': r['Maintenance ID'], 'Kejadian': APP.EVENTS.INPUT_MANUAL, 'User': user.email,
      'Detail': cleanText_(['Mulai ' + f(r['Mulai'], 'dd/MM/yyyy HH:mm') + ', selesai ' + f(r['Selesai'], 'dd/MM HH:mm'), 'PIC ' + r['Nama teknisi terlibat'],
        'baris ' + it.row + ' tab ' + APP.SHEETS.MANUAL].concat(it.summary, ['Sparepart: ' + r['Part'].replace(/\n/g, '; ')]).join(' · '), 1000) });
  }));
}

/** Kolom Hasil: ✗ alasan untuk baris salah; ✓ ID untuk baris yang ditulis (written = false → hanya ✗). Satu tulisan. */
function manualHasil_(sh, plan, written) {
  var c = plan.h.indexOf('Hasil');
  if (c < 0 || plan.last < 2) return;
  var rg = sh.getRange(2, c + 1, plan.last - 1, 1), v = rg.getValues(), stamp = fmtTz_(new Date(), 'dd/MM HH:mm');
  var closed = written ? kpiClosed_() : {};
  plan.errors.forEach(function (e) { v[e.row - 2][0] = '✗ ' + e.msg; });
  plan.items.forEach(function (it) {
    var ym = ymOf_(it.r['Selesai']);
    v[it.row - 2][0] = written ? '✓ ' + it.r['Maintenance ID'] + ' · ' + stamp + (closed[ym] ? ' · ⚠ KPI ' + ym + ' sudah ditutup: tutup ulang' : '') : '';
  });
  rg.setNumberFormat('@').setValues(v);
}
