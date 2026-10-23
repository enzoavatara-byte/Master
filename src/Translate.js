/**
 * Terjemahan teks bebas memakai Google Translate bawaan Apps Script (LanguageApp): gratis, tanpa API key, tanpa izin baru.
 * Hasil disimpan di sheet "Terjemahan" (admin boleh mengoreksi; koreksi dipakai ulang) + CacheService, jadi teks yang sama
 * tidak diterjemahkan dua kali. Teks asli di sheet data tidak pernah diubah.
 */

var TR_CODE_ = { id: 'id', zh: 'zh-CN', en: 'en' };
var TR_MAX_ = 50;          // teks baru per permintaan (= batas apiTranslate); sisanya tetap teks asli, diterjemahkan di permintaan berikutnya
var TR_BATCH_CHARS_ = 4000; // teks satu baris digabung (dipisah baris baru) → satu panggilan Google untuk banyak teks
var TR_TTL_ = 21600;       // 6 jam (maksimum CacheService)
var TR_MEMO_ = null;       // isi sheet Terjemahan per request

function hasHan_(s) { return /[㐀-鿿豈-﫿]/.test(String(s || '')); }

/** Bahasa asal sederhana: ada huruf Han = zh, selain itu dianggap Indonesia (atau Inggris). */
function textLang_(s) { return hasHan_(s) ? 'zh' : 'id'; }

function trHash_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// tr2: 2.6.1 — hasil terjemahan Inggris lama (gabungan campur bahasa) tidak dipakai lagi
function trCacheKey_(lang, s) { return 'tr2:' + lang + ':' + trHash_(s) + ':' + s.length; }

/** Sheet Terjemahan → { teks: {_row, id, zh, en} }. Baris dobel digabung (bahasa pertama yang terisi menang). */
function trTable_() {
  if (TR_MEMO_) return TR_MEMO_;
  var map = {};
  if (SpreadsheetApp.getActive().getSheetByName(APP.SHEETS.TERJEMAHAN)) {
    readTable_(APP.SHEETS.TERJEMAHAN).forEach(function (r) {
      var k = String(r['Teks']).trim();
      if (!k) return;
      var o = map[k] || (map[k] = { _row: r._row });
      ['id', 'zh', 'en'].forEach(function (l) { var v = String(r[l] == null ? '' : r[l]).trim(); if (v && !o[l]) o[l] = v; });
    });
  }
  TR_MEMO_ = map;
  return map;
}

/**
 * @param {string[]} texts
 * @param {string} lang 'id' | 'zh' | 'en'
 * @param {{max?:number, stats?:Object}=} opts max = batas teks baru yang boleh dikirim ke Google Translate;
 *   stats.left += jumlah teks yang perlu Google tetapi belum diterjemahkan (melewati batas / kuota habis / gagal)
 * @return {string[]} urutan sama dengan `texts`; teks yang sudah berbahasa tujuan / tak sempat diterjemahkan = teks asli
 */
function translate_(texts, lang, opts) {
  opts = opts || {};
  if (!TR_CODE_[lang]) throw new Error('Bahasa tidak dikenal: ' + lang);
  var src = texts.map(function (t) { return String(t == null ? '' : t).trim(); });
  var out = src.slice();
  var need = {};
  src.forEach(function (s) {
    // zh: teks Han tidak diterjemahkan; id: teks tanpa Han dianggap sudah terbaca (Indonesia/Inggris).
    if (s && !(lang === 'zh' && hasHan_(s)) && !(lang === 'id' && !hasHan_(s))) need[s] = true;
  });
  var uniq = Object.keys(need);
  if (!uniq.length) return out;

  var got = {};
  var cache = CacheService.getScriptCache();
  var keys = uniq.map(function (s) { return trCacheKey_(lang, s); });
  var hit = cache.getAll(keys) || {};
  var miss = [];
  uniq.forEach(function (s, i) { if (hit[keys[i]] != null) got[s] = hit[keys[i]]; else miss.push(s); });

  if (miss.length) {
    var table = trTable_(), put = {}, budget = opts.max == null ? TR_MAX_ : opts.max, ask = [], over = 0;
    miss.forEach(function (s) {
      var row = table[s];
      if (row && row[lang]) { got[s] = row[lang]; put[trCacheKey_(lang, s)] = row[lang]; return; }
      if (budget-- > 0) ask.push(s); else over++;
    });
    var res = googleMany_(ask, lang), fresh = Object.keys(res);
    if (opts.stats) opts.stats.left = (opts.stats.left || 0) + over + ask.length - fresh.length;
    fresh.forEach(function (s) { got[s] = res[s]; put[trCacheKey_(lang, s)] = res[s]; });
    if (Object.keys(put).length) cache.putAll(put, TR_TTL_);
    if (fresh.length) saveTranslations_(fresh, lang, got);
  }
  return src.map(function (s) { return got.hasOwnProperty(s) ? got[s] : s; });
}

/**
 * Google Translate untuk banyak teks dengan sesedikit mungkin panggilan: teks satu baris digabung per ±4000 karakter
 * (dipisah baris baru). Jumlah baris hasil tidak cocok → teks itu diterjemahkan satu per satu.
 * Satu panggilan = satu bahasa asal yang disebut jelas (ada huruf Han = 中文, selain itu Indonesia). Dengan deteksi otomatis,
 * gabungan Indonesia + 中文 dianggap 中文 seluruhnya dan teks Indonesia kembali utuh atau rusak
 * ("lampu indikator mati" → "Laminator mati"; ditemukan saat uji di Apps Script asli, 2.6.1).
 * Google menolak (mis. kuota harian habis) → berhenti, sisa teks tetap teks asli.
 * @return {Object<string,string>} teks → terjemahan (hanya yang berhasil)
 */
function googleMany_(texts, lang) {
  var out = {}, code = TR_CODE_[lang], dead = false, groups = {};
  var call = function (s, from) {
    if (dead) return null;
    try { return String(LanguageApp.translate(s, from, code) || ''); } catch (e) { console.warn('Terjemahan gagal: ' + e); dead = true; return null; }
  };
  texts.forEach(function (s) { var from = TR_CODE_[textLang_(s)]; (groups[from] = groups[from] || []).push(s); });
  Object.keys(groups).forEach(function (from) {
    if (from === code) { groups[from].forEach(function (s) { out[s] = s; }); return; }   // sudah berbahasa tujuan
    var single = [], chunks = [], cur = [], len = 0;
    groups[from].forEach(function (s) {
      if (s.indexOf('\n') !== -1) { single.push(s); return; }
      if (cur.length && len + s.length > TR_BATCH_CHARS_) { chunks.push(cur); cur = []; len = 0; }
      cur.push(s); len += s.length + 1;
    });
    if (cur.length) chunks.push(cur);
    chunks.forEach(function (c) {
      if (c.length === 1) { single.push(c[0]); return; }
      var r = call(c.join('\n'), from);
      if (r == null) return;
      var lines = r.split('\n');
      if (lines.length !== c.length) { single = single.concat(c); return; }
      c.forEach(function (s, i) { var v = lines[i].trim(); if (v) out[s] = v; });
    });
    single.forEach(function (s) { var r = call(s, from); if (r != null && r.trim()) out[s] = r.trim(); });
  });
  return out;
}

/**
 * Simpan hasil baru ke sheet Terjemahan: teks baru = satu tulisan untuk semua baris (di bawah lock singkat);
 * teks yang sudah punya baris = isi sel bahasanya saja, supaya dua user tidak saling menimpa.
 * Lock sedang dipakai → tidak disimpan (hasil tetap ada di cache 6 jam; sheet ini hanya cadangan & tempat koreksi).
 * Jangan dipanggil dari dalam withLock_.
 */
function saveTranslations_(texts, lang, got) {
  var sh = SpreadsheetApp.getActive().getSheetByName(APP.SHEETS.TERJEMAHAN);
  if (!sh) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    var h = headers_(sh), col = h.indexOf(lang) + 1, tcol = h.indexOf('Diperbarui') + 1;
    var table = trTable_(), now = new Date(), rows = [], upd = [], start = sh.getLastRow() + 1;
    texts.forEach(function (s) {
      var row = table[s];
      if (row && row._row && col > 0) { upd.push([row._row, got[s]]); row[lang] = got[s]; return; }
      var o = { 'Teks': s, 'Bahasa asal': textLang_(s), 'Sumber': 'Google', 'Diperbarui': now };
      o[lang] = got[s];
      rows.push(objToRow_(h, o));
      table[s] = row || {};
      table[s]._row = start + rows.length - 1;   // bahasa lain di eksekusi yang sama (TPM: zh lalu en) → baris yang sama
      table[s][lang] = got[s];
    });
    if (upd.length) {   // baris yang sudah ada: satu tulisan per kolom (bukan per sel; TPM bisa ratusan teks sekaligus)
      var put = function (c, v) {
        if (c < 1) return;
        var rg = sh.getRange(2, c, start - 2, 1), vals = rg.getValues();
        upd.forEach(function (u) { vals[u[0] - 2][0] = v == null ? u[1] : v; });
        rg.setValues(vals);
      };
      put(col); put(tcol, now);
    }
    if (rows.length) sh.getRange(start, 1, rows.length, h.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

/** Admin mengoreksi sheet Terjemahan → cache teks itu dibuang (dipanggil dari onEdit). */
function forgetTranslation_(text) {
  text = String(text || '').trim();
  if (!text) return;
  CacheService.getScriptCache().removeAll(['id', 'zh', 'en'].map(function (l) { return trCacheKey_(l, text); }));
}

/**
 * Tombol 翻译 / Terjemahkan di aplikasi, dan pesan error server untuk user berbahasa Mandarin.
 * @param {string[]} texts maks 50 teks, masing-masing maks 2000 karakter
 * @param {string} lang 'id' | 'zh' | 'en'
 */
function apiTranslate(texts, lang) {
  requireUser_();
  if (!Array.isArray(texts)) texts = [texts];
  if (texts.length > 50) throw new Error('Maksimal 50 teks per terjemahan.');
  return translate_(texts.map(function (t) { return String(t == null ? '' : t).slice(0, 2000); }), String(lang || 'id'));
}

// ---------- Label master (Pilihan, Form, Mesin, Lines) ----------

/**
 * Isi sel 中文 / English yang masih kosong di sheet master. Tidak menimpa isi yang sudah ada (koreksi admin aman).
 * @param {boolean} useGoogle false = hanya label bawaan (APP.OPTION_I18N, FORM_DEFAULTS), tanpa Google Translate (dipakai setup)
 * @return {{cells:number}}
 */
function isiTerjemahanMaster_(useGoogle) {
  var ss = SpreadsheetApp.getActive(), n = 0;
  var forms = {};
  APP.FORM_DEFAULTS.forEach(function (d) { forms[d[0] + '.' + d[1]] = d; });

  /** [sheet, kolom sumber, [[kolom tujuan, bahasa, bawaan(row)]]] */
  var jobs = [
    [APP.SHEETS.OPTIONS, 'Nilai', [['Nilai (中文)', 'zh', function (r) { return (APP.OPTION_I18N[String(r['Nilai']).trim()] || [])[0]; }],
                                   ['Nilai (English)', 'en', function (r) { return (APP.OPTION_I18N[String(r['Nilai']).trim()] || [])[1]; }]]],
    [APP.SHEETS.FORM, 'Label', [['Label (中文)', 'zh', function (r) {
      var d = forms[String(r['Form']).trim() + '.' + String(r['Field']).trim()];
      return d && String(r['Label']).trim() === d[2] ? d[8] : '';
    }]]],
    [APP.SHEETS.LINES, 'Nama Line', [['Nama (中文)', 'zh', null], ['Nama (English)', 'en', null]]]
  ];
  jobs.forEach(function (job) {
    var sh = findSheet_(job[0], ss);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
    var srcCol = h.indexOf(job[1]);
    if (srcCol < 0) return;
    job[2].forEach(function (t) {
      var c = h.indexOf(t[0]);
      if (c < 0) return;
      // 1) label bawaan; 2) sisanya sekaligus ke Google (googleMany_: sedikit panggilan, berhenti jika kuota habis)
      var plan = vals.slice(1).map(function (row) {
        var cur = row[c];
        if (String(cur == null ? '' : cur).trim() || !String(row[srcCol] || '').trim() || String(row[0] || '').trim() === '') return null;
        var o = {};
        h.forEach(function (k, i) { o[k] = row[i]; });
        return { src: String(row[srcCol]).trim(), v: (t[2] && t[2](o)) || '' };
      });
      var ask = {};
      plan.forEach(function (p) { if (p && !p.v) ask[p.src] = true; });
      var res = useGoogle && Object.keys(ask).length ? googleMany_(Object.keys(ask), t[1]) : {};
      var changed = false;
      var column = plan.map(function (p, i) {
        var v = p && (p.v || res[p.src]);
        if (!v) return [vals[i + 1][c]];
        changed = true; n++;
        return [v];
      });
      if (changed) sh.getRange(2, c + 1, column.length, 1).setValues(column);
    });
  });
  return { cells: n };
}

function menuIsiTerjemahan() {
  requireUser_([APP.ROLES.ADMIN]);
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Isi terjemahan otomatis',
    'Sel 中文 / English yang masih KOSONG di sheet Pilihan, Form, Mesin dan Lines diisi dengan Google Translate.\n' +
    'Isi yang sudah ada tidak diubah. Periksa hasilnya (istilah teknis) dan koreksi langsung di sheet.\n\nLanjutkan?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var out = isiTerjemahanMaster_(true);
  invalidateMaster_();
  ui.alert('Selesai: ' + out.cells + ' sel diisi.');
}
