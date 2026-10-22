/**
 * Master data yang diedit user di Google Sheet: Users, Factory, Projects, Lines, Mesin, Sparepart, Pilihan,
 * Form, Format Laporan, Catatan Panduan, Config.
 *
 * Kecepatan: membaca 9 sheet di setiap request = puluhan panggilan ke Sheets (lambat). Karena itu master
 * disimpan di CacheService (dipakai bersama semua user) dan HANYA dibaca ulang jika:
 *  - ada yang mengedit spreadsheet secara manual (onEdit / onChange → cache dihapus), atau
 *  - cache kedaluwarsa (MD_CACHE_TTL_, pengaman jika trigger tidak jalan), atau
 *  - admin memilih menu "Muat ulang data master".
 * Perubahan di sheet tetap langsung terlihat di request berikutnya.
 *
 * Nilai sheet yang tidak valid TIDAK membuat app error: dilewati, diganti default, dan dicatat
 * di md.warnings (tampil di Dashboard Admin).
 */

var MD_MEMO_ = null;
var MD_CACHE_KEY_ = 'mttr-md-25a';   // naikkan jika struktur md berubah (cache lama otomatis diabaikan)
var MD_CACHE_TTL_ = 600;             // detik
var MD_CHUNK_ = 24000;               // karakter per potongan (batas CacheService 100 KB per nilai)

/** Lupakan data per-request (memo master & header). Cache bersama TIDAK dihapus. */
function resetMaster_() { MD_MEMO_ = null; TR_MEMO_ = null; resetHeaders_(); }

/** 'zh' / 'cn' / 'mandarin' / '中文' → 'zh'; selain itu 'id'. */
function normLang_(v) {
  var s = String(v || '').trim().toLowerCase();
  return /^(zh|cn|china|chinese|mandarin|中文|汉语|簡體|简体)/.test(s) ? 'zh' : 'id';
}

/** Label tampilan per bahasa (nilai yang disimpan tetap kanonik). */
function addTr_(md, value, zh, en) {
  value = String(value || '').trim();
  if (!value) return;
  zh = String(zh || '').trim(); en = String(en || '').trim();
  if (zh && !md.tr.zh[value]) md.tr.zh[value] = zh;
  if (en && !md.tr.en[value]) md.tr.en[value] = en;
}

function scriptCache_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

function readMasterCache_() {
  var c = scriptCache_();
  if (!c) return null;
  try {
    var n = Number(c.get(MD_CACHE_KEY_ + ':n'));
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(MD_CACHE_KEY_ + ':' + i);
    var parts = c.getAll(keys), s = '';
    for (var j = 0; j < keys.length; j++) {
      if (parts[keys[j]] == null) return null;
      s += parts[keys[j]];
    }
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function writeMasterCache_(md) {
  var c = scriptCache_();
  if (!c) return;
  try {
    var s = JSON.stringify(md), obj = {};
    var n = Math.max(1, Math.ceil(s.length / MD_CHUNK_));
    for (var i = 0; i < n; i++) obj[MD_CACHE_KEY_ + ':' + i] = s.substr(i * MD_CHUNK_, MD_CHUNK_);
    obj[MD_CACHE_KEY_ + ':n'] = String(n);
    c.putAll(obj, MD_CACHE_TTL_);
  } catch (e) {
    console.warn('Cache master gagal disimpan: ' + e);
  }
}

/** Hapus cache bersama: dipanggil saat sheet diedit manual, setup, dan menu admin. */
function invalidateMaster_() {
  var c = scriptCache_();
  if (c) { try { c.remove(MD_CACHE_KEY_ + ':n'); } catch (e) { /* abaikan */ } }
  resetMaster_();
}

function readOptional_(name) {
  return findSheet_(name) ? readTable_(name, true) : [];
}

function masterData_() {
  if (MD_MEMO_) return MD_MEMO_;
  var md = readMasterCache_();
  if (!md) {
    md = buildMaster_();
    writeMasterCache_(md);
  }
  MD_MEMO_ = md;
  return md;
}

function buildMaster_() {
  var warnings = [];
  var md = { warnings: warnings, tr: { zh: {}, en: {} } };

  // ---- Factory ----
  md.factories = readOptional_(APP.SHEETS.FACTORY).filter(function (f) {
    return isActiveRow_(f['Aktif']) && String(f['Factory ID'] || '').trim();
  }).map(function (f) {
    return { id: normLine_(f['Factory ID']), name: String(f['Nama'] || f['Factory ID']), lokasi: String(f['Lokasi'] || '') };
  });
  md.factoryMap = {};
  md.factories.forEach(function (f) { md.factoryMap[f.id] = f; });

  // ---- Projects (baterai per factory) ----
  md.projects = readOptional_(APP.SHEETS.PROJECTS).filter(function (p) {
    return isActiveRow_(p['Aktif']) && String(p['Baterai'] || '').trim();
  }).map(function (p) {
    var t = Number(p['Target MTTR (menit)']), tb = Number(String(p['Target MTBF (jam)'] == null ? '' : p['Target MTBF (jam)']).replace(',', '.'));
    return {
      factory: normLine_(p['Factory ID']), battery: String(p['Baterai']).trim(), fase: String(p['Fase'] || ''),
      target: (isFinite(t) && t > 0) ? t : null, catatan: String(p['Catatan'] || ''),
      targetMtbf: (p['Target MTBF (jam)'] !== '' && isFinite(tb) && tb > 0) ? tb : null   // 2.6: KPI MTBF (jam)
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
      area: String(l['Area'] || ''), active: isActiveRow_(l['Aktif']), proses: String(l['Proses'] || '').trim()
    };
    addTr_(md, md.lines[id].name, l['Nama (中文)'], l['Nama (English)']);
  });

  // ---- Mesin (2.6: tidak dipilih lagi; line = unit). Sheet lama hanya dibaca untuk label 中文/English data lama. ----
  md.machines = [];
  readOptional_(APP.SHEETS.MESIN).forEach(function (m) {
    addTr_(md, String(m['Nama Mesin'] || ''), m['Nama (中文)'], m['Nama (English)']);
  });

  // ---- Pilihan ----
  var opts = {}, order = {};
  md.discipline = {};
  readOptional_(APP.SHEETS.OPTIONS).forEach(function (r, i) {
    var jenis = String(r['Jenis'] || '').trim(), nilai = String(r['Nilai'] || '').trim();
    if (!jenis || !nilai || !isActiveRow_(r['Aktif'])) return;
    var def = APP.OPTION_I18N[nilai] || [];
    addTr_(md, nilai, r['Nilai (中文)'] || def[0], r['Nilai (English)'] || def[1]);
    if (jenis === 'Jenis Kerusakan' && String(r['Discipline'] || '').trim()) {
      var dsc = normDiscipline_(r['Discipline']);
      if (dsc) md.discipline[nilai] = dsc;
      else warnings.push('Pilihan: Discipline "' + r['Discipline'] + '" untuk ' + nilai + ' tidak dikenal (pakai ' + APP.TPM_DISCIPLINES.join(' / ') + ').');
    }
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

  // ---- Users (auth & nama), Config, Sparepart, Format Laporan, Catatan Panduan: ikut cache ----
  md.users = readTable_(APP.SHEETS.USERS).map(function (u) {
    return { email: String(u['Email']).trim().toLowerCase(), name: String(u['Nama'] || u['Email']), peran: String(u['Peran'] || ''), aktif: u['Aktif'],
      lang: normLang_(u['Bahasa']) };
  });
  md.config = {};
  readOptional_(APP.SHEETS.CONFIG).forEach(function (r) {
    var k = String(r['Key'] || '').trim();
    if (k) md.config[k] = r['Value'];
  });
  md.spareparts = readSpareparts_(warnings, opts);
  md.report = readReportFormat_(warnings);
  md.rencana = readOptional_(APP.SHEETS.RENCANA).filter(function (r) {
    return isActiveRow_(r['Aktif']) && String(r['Judul'] || '').trim();
  }).map(function (r) {
    var u = Number(r['Urutan']);
    return { judul: String(r['Judul']).trim(), isi: String(r['Isi'] || ''), status: String(r['Status'] || 'Rencana').trim(),
      target: String(r['Target'] || ''), order: (r['Urutan'] !== '' && isFinite(u)) ? u : 1000 + r._row };
  }).sort(function (a, b) { return a.order - b.order; });
  md.notes = readOptional_(APP.SHEETS.PANDUAN).filter(function (r) {
    return isActiveRow_(r['Aktif']) && (String(r['Judul'] || '').trim() || String(r['Isi'] || '').trim());
  }).map(function (r, i) {
    var u = Number(r['Urutan']), untuk = String(r['Untuk'] || 'Semua').trim().toLowerCase();
    return { untuk: untuk === 'admin' ? 'Admin' : (untuk === 'teknisi' ? 'Teknisi' : 'Semua'), judul: String(r['Judul'] || ''),
      isi: String(r['Isi'] || ''), order: (r['Urutan'] !== '' && isFinite(u)) ? u : 1000 + i };
  }).sort(function (a, b) { return a.order - b.order; });
  return md;
}

/** ID part katalog: stabil selama Jenis/Nama/Model tidak diganti. */
function partId_(jenis, nama, model) {
  return [jenis, nama, model].map(function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }).join('|');
}

/** Katalog sparepart (Jenis → Nama → Model). Model boleh kosong. */
function readSpareparts_(warnings, opts) {
  var seen = {}, out = [];
  var jenisList = opts['Jenis Kerusakan'] || [];
  readOptional_(APP.SHEETS.SPAREPART).forEach(function (r) {
    if (!isActiveRow_(r['Aktif'])) return;
    var jenis = String(r['Jenis Sparepart'] || '').trim(), nama = String(r['Nama Sparepart'] || '').trim(), model = String(r['Model'] || '').trim();
    if (!nama) return;
    if (!jenis) { warnings.push('Sparepart: "' + nama + '" belum diisi Jenis Sparepart (baris ' + r._row + ').'); return; }
    var id = partId_(jenis, nama, model);
    if (seen[id]) { warnings.push('Sparepart: "' + nama + (model ? ' ' + model : '') + '" ditulis dua kali (yang kedua diabaikan).'); return; }
    seen[id] = true;
    if (jenisList.length && jenisList.indexOf(jenis) === -1) {
      warnings.push('Sparepart: jenis "' + jenis + '" (' + nama + ') tidak ada di Pilihan → Jenis Kerusakan. Filter otomatis tidak akan cocok.');
    }
    var u = Number(r['Urutan']);
    out.push({ id: id, jenis: jenis, nama: nama, model: model, satuan: String(r['Satuan'] || ''),
      order: (r['Urutan'] !== '' && isFinite(u)) ? u : 100000 + r._row });
  });
  out.sort(function (a, b) { return (a.order - b.order) || a.nama.localeCompare(b.nama) || a.model.localeCompare(b.model); });
  return out;
}

/** Kolom tab Laporan. Sheet kosong / belum ada → format Excel bawaan. */
function readReportFormat_(warnings) {
  var rows = readOptional_(APP.SHEETS.FORMAT);
  var src = rows.length ? rows.map(function (r, i) {
    var u = Number(r['Urutan']);
    return { kolom: String(r['Kolom'] || '').trim(), sumber: String(r['Sumber'] || '').trim(), aktif: isActiveRow_(r['Aktif']),
      order: (r['Urutan'] !== '' && isFinite(u)) ? u : 1000 + i };
  }) : APP.REPORT_DEFAULTS.map(function (d, i) { return { kolom: d[0], sumber: d[1], aktif: d[2] === 'Ya', order: i + 1 }; });
  var known = APP.REPORT_SOURCES, maint = APP.HEADERS.Maintenance;
  return src.filter(function (c) { return c.aktif && (c.kolom || c.sumber); }).map(function (c) {
    if (!c.sumber) c.sumber = c.kolom;
    if (known.indexOf(c.sumber) === -1 && maint.indexOf(c.sumber) === -1) {
      warnings.push('Format Laporan: sumber "' + c.sumber + '" bukan sumber bawaan; diambil dari kolom Maintenance bernama sama (kosong jika tidak ada).');
    }
    return { kolom: c.kolom || c.sumber, sumber: c.sumber, order: c.order };
  }).sort(function (a, b) { return a.order - b.order; });
}

function uniq_(list) {
  var out = [];
  list.forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
  return out;
}

function defaultFormDef_(d, i) {
  return {
    form: d[0], field: d[1], label: d[2], type: d[3], source: d[4], required: d[5] === 'Ya',
    other: d[6] === 'Ya', order: Number(d[7]) || i, locked: APP.LOCKED_FIELDS.indexOf(d[0] + '.' + d[1]) !== -1, labelZh: d[8] || ''
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
        // Label Indonesia belum diubah admin → label 中文 bawaan boleh dipakai.
        labelZh: String(r['Label (中文)'] || '').trim() || (def && [def.label, ''].indexOf(String(r['Label'] || '').trim()) !== -1 ? def.labelZh : ''),
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
  if (missing.length) {
    sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    forgetHeaders_(APP.SHEETS.MAINT);
  }
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

/** Factory sebuah record: kolom Factory (2.1) atau factory line-nya (data 2.0). */
function factoryOfRecord_(md, r) {
  if (r['Factory']) return normLine_(r['Factory']);
  var l = lineOf_(md, r['Line']);
  return l ? l.factory : '';
}

/** Proses sebuah pekerjaan: disimpan saat Mulai (2.2), atau Proses line-nya sekarang (data lama). */
function prosesOfRecord_(md, r) {
  if (r['Proses']) return String(r['Proses']);
  var l = lineOf_(md, r['Line']);
  return l ? l.proses : '';
}

/**
 * Filter umum (Beranda, Pending, Review, Riwayat, Dashboard).
 * @param {{factory?:string, baterai?:string, proses?:string, line?:string, q?:string}} f
 */
function matchFilter_(md, r, f, names) {
  if (!f) return true;
  if (f.factory && factoryOfRecord_(md, r) !== normLine_(f.factory)) return false;
  if (f.baterai && String(r['Baterai']) !== String(f.baterai)) return false;
  if (f.line && normLine_(r['Line']) !== normLine_(f.line)) return false;
  if (f.proses && prosesOfRecord_(md, r) !== String(f.proses)) return false;
  if (f.q) {
    var q = String(f.q).toLowerCase();
    var l2 = lineOf_(md, r['Line']);
    var hay = [r['Maintenance ID'], r['Line'], l2 ? l2.name : '', prosesOfRecord_(md, r), r['Nama Mesin'],
      r['Masalah'], r['Penyebab'], r['Jenis kerusakan'], r['Yang tertunda'], r['Part'],
      names ? names[String(r['Teknisi terakhir']).toLowerCase()] : '', r['Teknisi terakhir']].join(' ').toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

/** Ringkasan master untuk client (dropdown, filter, form). */
function clientMaster_(md) {
  var forms = {};
  Object.keys(md.forms).forEach(function (f) {
    forms[f] = md.forms[f].map(function (d) {
      return { field: d.field, label: d.label, labelZh: d.labelZh || '', type: d.type, required: d.required, other: d.other,
        options: d.type === 'pilihan' || d.field === 'Tipe' ? fieldOptions_(md, d) : [] };
    });
  });
  return {
    factories: md.factories,
    projects: md.projects,
    lines: Object.keys(md.lines).map(function (k) { return md.lines[k]; })
      .filter(function (l) { return l.active; }).sort(function (a, b) { return a.id.localeCompare(b.id); }),
    forms: forms,
    spareparts: md.spareparts.map(function (p) { return { id: p.id, jenis: p.jenis, nama: p.nama, model: p.model, satuan: p.satuan }; }),
    jenisKerusakan: md.options['Jenis Kerusakan'] || [],
    // PIC tambahan saat Selesai (2.6): user aktif, urut nama
    people: md.users.filter(function (u) { return u.email && isActiveRow_(u.aktif); })
      .map(function (u) { return { email: u.email, name: u.name }; }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
    trZh: md.tr.zh,
    rencana: md.rencana,
    appName: String(md.config.NAMA_APLIKASI || APP.NAME),
    version: APP.VERSION
  };
}
