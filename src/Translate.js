/**
 * Terjemahan teks bebas memakai Google Translate bawaan Apps Script (LanguageApp): gratis, tanpa API key, tanpa izin baru.
 * Hasil disimpan di sheet "Terjemahan" (admin boleh mengoreksi; koreksi dipakai ulang) + CacheService, jadi teks yang sama
 * tidak diterjemahkan dua kali. Teks asli di sheet data tidak pernah diubah.
 */

var TR_CODE_ = { id: 'id', zh: 'zh-CN', en: 'en' };
var TR_MAX_ = 30;          // teks baru per panggilan; sisanya tetap teks asli dan diterjemahkan di panggilan berikutnya
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
function trCacheKey_(lang, s) { return 'tr:' + lang + ':' + trHash_(s) + ':' + s.length; }

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
 * @param {{max?:number}=} opts max = batas teks baru yang boleh dikirim ke Google Translate
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
    var table = trTable_(), put = {}, budget = opts.max == null ? TR_MAX_ : opts.max, fresh = [];
    miss.forEach(function (s) {
      var row = table[s];
      if (row && row[lang]) { got[s] = row[lang]; put[trCacheKey_(lang, s)] = row[lang]; return; }
      if (budget <= 0) return;
      budget--;
      var t;
      try { t = String(LanguageApp.translate(s, '', TR_CODE_[lang]) || '').trim(); } catch (e) { console.warn('Terjemahan gagal: ' + e); return; }
      if (!t) return;
      got[s] = t;
      put[trCacheKey_(lang, s)] = t;
      fresh.push(s);
    });
    if (Object.keys(put).length) cache.putAll(put, TR_TTL_);
    if (fresh.length) saveTranslations_(fresh, lang, got);
  }
  return src.map(function (s) { return got.hasOwnProperty(s) ? got[s] : s; });
}

/** Simpan hasil baru ke sheet Terjemahan. Sel per sel (bukan satu baris penuh) supaya dua user tidak saling menimpa. */
function saveTranslations_(texts, lang, got) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(APP.SHEETS.TERJEMAHAN);
  if (!sh) return;
  var h = headers_(sh), col = h.indexOf(lang) + 1, tcol = h.indexOf('Diperbarui') + 1;
  var table = trTable_(), now = new Date();
  texts.forEach(function (s) {
    var row = table[s];
    if (row && row._row && col > 0) {
      sh.getRange(row._row, col).setValue(got[s]);
      if (tcol > 0) sh.getRange(row._row, tcol).setValue(now);
    } else {
      var o = { 'Teks': s, 'Bahasa asal': textLang_(s), 'Sumber': 'Google', 'Diperbarui': now };
      o[lang] = got[s];
      appendObj_(APP.SHEETS.TERJEMAHAN, o);
      table[s] = row || {};
      table[s][lang] = got[s];
    }
  });
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
  var google = function (s, lang) {
    if (!useGoogle || !s) return '';
    try { return String(LanguageApp.translate(s, '', TR_CODE_[lang]) || '').trim(); } catch (e) { console.warn('Terjemahan gagal: ' + e); return ''; }
  };
  /** [sheet, kolom sumber, [[kolom tujuan, bahasa, bawaan(row)]]] */
  var jobs = [
    [APP.SHEETS.OPTIONS, 'Nilai', [['Nilai (中文)', 'zh', function (r) { return (APP.OPTION_I18N[String(r['Nilai']).trim()] || [])[0]; }],
                                   ['Nilai (English)', 'en', function (r) { return (APP.OPTION_I18N[String(r['Nilai']).trim()] || [])[1]; }]]],
    [APP.SHEETS.FORM, 'Label', [['Label (中文)', 'zh', function (r) {
      var d = forms[String(r['Form']).trim() + '.' + String(r['Field']).trim()];
      return d && String(r['Label']).trim() === d[2] ? d[8] : '';
    }]]],
    [APP.SHEETS.MESIN, 'Nama Mesin', [['Nama (中文)', 'zh', null], ['Nama (English)', 'en', null]]],
    [APP.SHEETS.LINES, 'Nama Line', [['Nama (中文)', 'zh', null]]]
  ];
  jobs.forEach(function (job) {
    var sh = ss.getSheetByName(job[0]);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
    var srcCol = h.indexOf(job[1]);
    if (srcCol < 0) return;
    job[2].forEach(function (t) {
      var c = h.indexOf(t[0]);
      if (c < 0) return;
      var changed = false;
      var column = vals.slice(1).map(function (row) {
        var cur = row[c];
        if (String(cur == null ? '' : cur).trim() || !String(row[srcCol] || '').trim() || String(row[0] || '').trim() === '') return [cur];
        var o = {};
        h.forEach(function (k, i) { o[k] = row[i]; });
        var v = (t[2] && t[2](o)) || google(String(row[srcCol]).trim(), t[1]);
        if (!v) return [cur];
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
