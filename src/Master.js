/**
 * Master data yang diedit user di Google Sheet: Factory, Projects, Lines, Mesin, Pilihan, Form.
 * Dibaca sekali per request (memo direset di requireUser_), jadi perubahan di sheet langsung
 * terlihat di request berikutnya tanpa deploy ulang.
 *
 * Nilai sheet yang tidak valid TIDAK membuat app error: dilewati, diganti default, dan dicatat
 * di md.warnings (tampil di Dashboard Admin).
 */

var MD_MEMO_ = null;

function resetMaster_() { MD_MEMO_ = null; }

function readOptional_(name) {
  return SpreadsheetApp.getActive().getSheetByName(name) ? readTable_(name) : [];
}

function masterData_() {
  if (MD_MEMO_) return MD_MEMO_;
  var warnings = [];
  var md = { warnings: warnings };

  // ---- Factory ----
  md.factories = readOptional_(APP.SHEETS.FACTORY).filter(function (f) { return isActiveRow_(f['Aktif']); }).map(function (f) {
    return { id: normLine_(f['Factory ID']), name: String(f['Nama'] || f['Factory ID']), lokasi: String(f['Lokasi'] || '') };
  });
  md.factoryMap = {};
  md.factories.forEach(function (f) { md.factoryMap[f.id] = f; });

  // ---- Projects (baterai per factory) ----
  md.projects = readOptional_(APP.SHEETS.PROJECTS).filter(function (p) {
    return isActiveRow_(p['Aktif']) && String(p['Baterai'] || '').trim();
  }).map(function (p) {
    var t = Number(p['Target MTTR (menit)']);
    return {
      factory: normLine_(p['Factory ID']), battery: String(p['Baterai']).trim(), fase: String(p['Fase'] || ''),
      target: (isFinite(t) && t > 0) ? t : null, catatan: String(p['Catatan'] || '')
    };
  });
  md.projects.forEach(function (p) {
    if (p.factory && !md.factoryMap[p.factory]) warnings.push('Projects: Factory "' + p.factory + '" untuk ' + p.battery + ' tidak ada di sheet Factory.');
  });
  md.allBatteries = uniq_(md.projects.map(function (p) { return p.battery; }));

  // ---- Lines ----
  md.lines = {};
  readTable_(APP.SHEETS.LINES).forEach(function (l) {
    var id = normLine_(l['Line ID']);
    if (!id) return;
    if (!/^[A-Z0-9_.-]{1,50}$/.test(id)) { warnings.push('Lines: Line ID "' + id + '" hanya boleh huruf, angka, - _ . (dilewati).'); return; }
    var factory = normLine_(l['Factory ID']);
    var own = splitList_(l['Baterai']);
    var fromFactory = md.projects.filter(function (p) { return p.factory === factory; }).map(function (p) { return p.battery; });
    var batteries = own.length ? own : (fromFactory.length ? fromFactory : md.allBatteries);
    own.forEach(function (b) {
      if (md.allBatteries.indexOf(b) === -1) warnings.push('Lines: baterai "' + b + '" di line ' + id + ' tidak ada di sheet Projects.');
    });
    if (factory && !md.factoryMap[factory]) warnings.push('Lines: Factory "' + factory + '" di line ' + id + ' tidak ada di sheet Factory.');
    md.lines[id] = {
      id: id, name: String(l['Nama Line'] || ''), factory: factory, batteries: uniq_(batteries),
      grup: normLine_(l['Grup']), area: String(l['Area'] || ''), active: isActiveRow_(l['Aktif'])
    };
  });

  // ---- Mesin ----
  md.machines = readOptional_(APP.SHEETS.MESIN).filter(function (m) {
    return isActiveRow_(m['Aktif']) && String(m['Mesin ID'] || '').trim();
  }).map(function (m) {
    return { id: normLine_(m['Mesin ID']), name: String(m['Nama Mesin'] || m['Mesin ID']), line: normLine_(m['Line ID']) };
  });

  // ---- Pilihan ----
  var opts = {}, order = {};
  readOptional_(APP.SHEETS.OPTIONS).forEach(function (r, i) {
    var jenis = String(r['Jenis'] || '').trim(), nilai = String(r['Nilai'] || '').trim();
    if (!jenis || !nilai || !isActiveRow_(r['Aktif'])) return;
    if (!opts[jenis]) opts[jenis] = [];
    if (opts[jenis].indexOf(nilai) !== -1) return;
    var u = Number(r['Urutan']);
    order[jenis + '|' + nilai] = (r['Urutan'] !== '' && isFinite(u)) ? u : 100000 + i;
    opts[jenis].push(nilai);
  });
  Object.keys(opts).forEach(function (j) {
    opts[j].sort(function (a, b) { return order[j + '|' + a] - order[j + '|' + b]; });
  });
  Object.keys(APP.OPTION_DEFAULTS).forEach(function (j) { if (!opts[j] || !opts[j].length) opts[j] = APP.OPTION_DEFAULTS[j].slice(); });
  md.options = opts;

  // ---- Form ----
  md.forms = readForms_(warnings, opts);

  MD_MEMO_ = md;
  return md;
}

function uniq_(list) {
  var out = [];
  list.forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
  return out;
}

function defaultFormDef_(d, i) {
  return {
    form: d[0], field: d[1], label: d[2], type: d[3], source: d[4], required: d[5] === 'Ya',
    other: d[6] === 'Ya', order: Number(d[7]) || i, locked: APP.LOCKED_FIELDS.indexOf(d[0] + '.' + d[1]) !== -1
  };
}

function readForms_(warnings, opts) {
  var forms = {};
  APP.FORMS.forEach(function (f) { forms[f] = []; });
  var rows = readOptional_(APP.SHEETS.FORM);
  var defaults = APP.FORM_DEFAULTS.map(defaultFormDef_);
  var seen = {};

  if (!rows.length) {
    defaults.forEach(function (d) { forms[d.form].push(d); });
  } else {
    rows.forEach(function (r, i) {
      var form = String(r['Form'] || '').trim(), field = String(r['Field'] || '').trim();
      if (!form && !field) return;
      if (!forms[form]) { warnings.push('Form: nama form "' + form + '" tidak dikenal (pilih: ' + APP.FORMS.join(', ') + ').'); return; }
      if (!field) return;
      var key = form + '.' + field;
      if (seen[key]) { warnings.push('Form: field "' + key + '" ditulis dua kali (yang kedua diabaikan).'); return; }
      var def = defaults.filter(function (d) { return d.form === form && d.field === field; })[0];
      var type = String(r['Tipe'] || '').trim().toLowerCase() || (def ? def.type : 'teks');
      var locked = APP.LOCKED_FIELDS.indexOf(key) !== -1;
      if (!locked && !isActiveRow_(r['Aktif'])) { seen[key] = true; return; }
      if (def && def.type === 'sistem') type = 'sistem';
      if (type === 'sistem' && !def) { warnings.push('Form: "' + key + '" bertipe sistem tapi bukan field sistem (dilewati).'); return; }
      if (['pilihan', 'teks', 'angka', 'sistem'].indexOf(type) === -1) { warnings.push('Form: tipe "' + type + '" di ' + key + ' tidak dikenal (pilih: pilihan, teks, angka).'); return; }
      if (!def && APP.RESERVED_FIELDS.indexOf(field) !== -1) { warnings.push('Form: "' + field + '" adalah kolom sistem, tidak bisa dipakai sebagai field tambahan.'); return; }
      var source = String(r['Sumber'] || '').trim() || (def ? def.source : '');
      if (type === 'pilihan' && !source) { warnings.push('Form: field pilihan "' + key + '" belum diisi Sumber (jenis di sheet Pilihan).'); return; }
      if (type === 'pilihan' && !(opts[source] || []).length && !isYes_(r['Lainnya isi sendiri'])) {
        warnings.push('Form: sumber "' + source + '" untuk ' + key + ' belum punya isi di sheet Pilihan.');
      }
      var u = Number(r['Urutan']);
      seen[key] = true;
      forms[form].push({
        form: form, field: field, label: String(r['Label'] || '').trim() || (def ? def.label : field),
        type: type, source: source,
        required: (def && (field === 'Tipe' || field === 'Baterai' || field === 'Tenggat')) ? true : isYes_(r['Wajib']),
        other: r['Lainnya isi sendiri'] === '' && def ? def.other : isYes_(r['Lainnya isi sendiri']),
        order: (r['Urutan'] !== '' && isFinite(u)) ? u : 1000 + i, locked: locked
      });
    });
    // Field sistem yang terhapus dari sheet dikembalikan (logika app membutuhkannya).
    defaults.forEach(function (d) {
      if (d.locked && !seen[d.form + '.' + d.field]) {
        warnings.push('Form: field sistem "' + d.form + '.' + d.field + '" hilang dari sheet, memakai default. Jalankan setup() untuk mengembalikan barisnya.');
        forms[d.form].push(d);
      }
    });
  }
  Object.keys(forms).forEach(function (f) { forms[f].sort(function (a, b) { return a.order - b.order; }); });
  return forms;
}

/** Pilihan untuk sebuah field (+ "Lainnya" otomatis jika diizinkan isi sendiri). */
function fieldOptions_(md, def) {
  var list = (md.options[def.source] || []).slice();
  if (def.other && list.indexOf(APP.OTHER) === -1) list.push(APP.OTHER);
  return list;
}

function fieldDef_(md, form, field) {
  return (md.forms[form] || []).filter(function (d) { return d.field === field; })[0] || null;
}

/**
 * Validasi satu nilai pilihan dengan aturan "Lainnya" → teks wajib.
 * @return {string} nilai yang disimpan ("Lainnya: <teks>" jika isi sendiri), '' jika kosong & tidak wajib.
 */
function choiceValue_(md, def, value, otherText, allowed) {
  var v = cleanText_(value, 200);
  var list = allowed || fieldOptions_(md, def);
  if (!v) {
    if (def.required) throw new Error(def.label + ' wajib dipilih.');
    return '';
  }
  if (v === APP.OTHER && def.other) {
    var t = cleanText_(otherText, 300);
    if (!t) throw new Error(def.label + ': pilih "Lainnya" → wajib diisi keterangannya.');
    return APP.OTHER_PREFIX + t;
  }
  if (list.indexOf(v) === -1) throw new Error(def.label + ' "' + v + '" tidak ada di daftar pilihan.');
  return v;
}

/**
 * Validasi semua field non-sistem sebuah form.
 * @param {{values?:Object, other?:Object}} input  values[field] & other[field] (teks "Lainnya").
 * @return {{values:Object, summary:string[]}} values[field] = nilai yang disimpan.
 */
function validateForm_(md, form, input) {
  input = input || {};
  var values = input.values || {}, other = input.other || {};
  var out = {}, summary = [];
  (md.forms[form] || []).forEach(function (def) {
    if (def.type === 'sistem') return;
    var v;
    if (def.type === 'pilihan') {
      v = choiceValue_(md, def, values[def.field], other[def.field]);
    } else if (def.type === 'angka') {
      var raw = values[def.field];
      if (raw === '' || raw == null) {
        if (def.required) throw new Error(def.label + ' wajib diisi.');
        v = '';
      } else {
        v = Number(raw);
        if (!isFinite(v)) throw new Error(def.label + ' harus berupa angka.');
      }
    } else {
      v = cleanText_(values[def.field], 1000);
      if (!v && def.required) throw new Error(def.label + ' wajib diisi.');
    }
    out[def.field] = v;
    if (v !== '') summary.push(def.label + ': ' + v);
  });
  return { values: out, summary: summary };
}

/** Pastikan kolom field tambahan ada di sheet Maintenance (dipanggil di dalam lock sebelum menulis). */
function ensureMaintColumns_(fields) {
  var sh = sheet_(APP.SHEETS.MAINT);
  var have = headers_(sh);
  var missing = fields.filter(function (f) { return f && have.indexOf(f) === -1; });
  if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
}

/** Field tambahan (non-sistem) dari semua form yang disimpan sebagai kolom Maintenance. Pause hanya di Log. */
function customColumns_(md) {
  var cols = [];
  ['Mulai', 'Pending', 'Selesai', 'Cancel'].forEach(function (f) {
    (md.forms[f] || []).forEach(function (d) {
      if (d.type !== 'sistem' && cols.indexOf(d.field) === -1) cols.push(d.field);
    });
  });
  return cols;
}

// ---------- Line, mesin, baterai ----------

function lineOf_(md, lineId) {
  return md.lines[normLine_(lineId)] || null;
}

function machinesForLine_(md, line) {
  if (!line) return [];
  return md.machines.filter(function (m) { return m.line === line.id || (line.grup && m.line === line.grup); });
}

function findMachine_(md, line, mesinId) {
  var id = normLine_(mesinId);
  return machinesForLine_(md, line).filter(function (m) { return m.id === id; })[0] || null;
}

/** Factory sebuah record: kolom Factory (2.1) atau factory line-nya (data 2.0). */
function factoryOfRecord_(md, r) {
  if (r['Factory']) return normLine_(r['Factory']);
  var l = lineOf_(md, r['Line']);
  return l ? l.factory : '';
}

/**
 * Filter umum (Beranda, Pending, Review, Riwayat, Dashboard).
 * @param {{factory?:string, baterai?:string, line?:string, q?:string}} f  line boleh Line ID atau Grup.
 */
function matchFilter_(md, r, f, names) {
  if (!f) return true;
  if (f.factory && factoryOfRecord_(md, r) !== normLine_(f.factory)) return false;
  if (f.baterai && String(r['Baterai']) !== String(f.baterai)) return false;
  if (f.line) {
    var key = normLine_(f.line), l = lineOf_(md, r['Line']);
    if (normLine_(r['Line']) !== key && !(l && l.grup === key)) return false;
  }
  if (f.q) {
    var q = String(f.q).toLowerCase();
    var l2 = lineOf_(md, r['Line']);
    var hay = [r['Maintenance ID'], r['Line'], l2 ? l2.name : '', r['Nama Mesin'], r['Mesin ID'], r['Masalah'], r['Penyebab'],
      r['Yang tertunda'], r['Part'], names ? names[String(r['Teknisi terakhir']).toLowerCase()] : '', r['Teknisi terakhir']].join(' ').toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

/** Ringkasan master untuk client (dropdown, filter, form). */
function clientMaster_(md) {
  var forms = {};
  Object.keys(md.forms).forEach(function (f) {
    forms[f] = md.forms[f].map(function (d) {
      return { field: d.field, label: d.label, type: d.type, required: d.required, other: d.other,
        options: d.type === 'pilihan' || d.field === 'Tipe' ? fieldOptions_(md, d) : [] };
    });
  });
  return {
    factories: md.factories,
    projects: md.projects,
    lines: Object.keys(md.lines).map(function (k) { return md.lines[k]; })
      .filter(function (l) { return l.active; }).sort(function (a, b) { return a.id.localeCompare(b.id); }),
    forms: forms,
    partOptions: md.options['Part'] || []
  };
}
