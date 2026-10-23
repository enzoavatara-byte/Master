/**
 * Mock Apps Script services (Sheets, Session, Lock, Mail, Utilities, ...) + jam yang bisa dimajukan.
 * Dipakai test/run.js dan test/preview.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ---------- Jam palsu ----------
const clock = { now: Date.UTC(2026, 8, 30, 1, 0, 0) }; // 30 Sep 2026 08:00 WIB
class FakeDate extends Date {
  constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
  static now() { return clock.now; }
}
const advance = (min) => { clock.now += min * 60000; };

// ---------- Mock Sheets ----------
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getDisplayValues() { return this.getValues().map(r => r.map(v => (v instanceof Date ? v.toISOString() : String(v == null ? '' : v)))); }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) vals.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
      out.push(vals);
    }
    return out;
  }
  setValues(v) {
    for (let i = 0; i < this.nr; i++) {
      const idx = this.r - 1 + i;
      while (this.sh.data.length <= idx) this.sh.data.push([]);
      for (let j = 0; j < this.nc; j++) this.sh.data[idx][this.c - 1 + j] = v[i][j];
    }
    return this;
  }
  getSheet() { return this.sh; }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) delete this.sh.formulas[(this.r + i) + ',' + (this.c + j)];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.data[this.r - 1 + i];
      if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = '';
    }
    return this;
  }
  setFormula(f) { this.sh.formulas[this.a1 || (this.r + ',' + this.c)] = f; return this; }
  setValue(v) { return this.setValues([[v]]); }
  setFormulas(f) { this.sh.formulaWrites = (this.sh.formulaWrites || 0) + 1; return this.setValues(f); }
  getValue() {
    // Rumus uji locale (fxMode_): seperti Google Sheets asli — en_US menerima koma, in_ID (desimal koma) menerima ; dan \
    const f = this.sh.formulas[this.r + ',' + this.c];
    if (f === '=COLUMNS({1,2})+IF(TRUE,10,0)') return ss.locale === 'in_ID' ? '#ERROR!' : 12;
    if (f === '=COLUMNS({1\\2})+IF(TRUE;10;0)') return ss.locale === 'in_ID' ? 12 : '#ERROR!';
    return this.getValues()[0][0];
  }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getLastRow() { return this.r + this.nr - 1; }
  getA1Notation() { return this.a1 || (this.r + ',' + this.c + ':' + this.nr + 'x' + this.nc); }
  applyRowBanding(theme, header, footer) {
    const b = { range: this, header, colors: {}, remove: () => { this.sh.bandings = this.sh.bandings.filter(x => x !== b); }, getRange: () => this };
    ['setHeaderRowColor', 'setFirstRowColor', 'setSecondRowColor', 'setFooterRowColor'].forEach(m => { b[m] = (c) => { b.colors[m] = c; return b; }; });
    this.sh.bandings.push(b);
    return b;
  }
  createFilter() {
    if (this.sh.filter) throw new Error('Sheet sudah punya filter');
    const f = { range: this, remove: () => { this.sh.filter = null; } };
    this.sh.filter = f;
    return f;
  }
  setDataValidation(rule) { this.sh.validations.push({ range: this, rule }); return this; }
  clearDataValidations() { this.sh.validations = []; return this; }
}
// Format: dicatat di sh.fmt ([nama, range, argumen]) supaya test bisa memeriksa, tanpa meniru tampilan Sheets.
['setNumberFormat', 'merge', 'mergeAcross', 'breakApart', 'setWrap', 'setWrapStrategy', 'setFontWeight', 'setFontColor', 'setFontSize',
 'setBackground', 'setHorizontalAlignment', 'setVerticalAlignment', 'setBorder', 'setNote'].forEach((m) => {
  Range.prototype[m] = function (...a) { this.sh.fmt.push([m, this.getA1Notation(), a]); return this; };
});
/** Builder Apps Script tiruan: setiap setX(..)/whenX(..) dicatat, build() mengembalikan catatan itu. */
function recorder(kind) {
  const spec = { kind, calls: {}, log: [] };
  // seperti ConditionalFormatRule asli: warna aturan bisa dibaca lagi (dipakai untuk mengenali aturan buatan aplikasi)
  spec.getBooleanCondition = () => ({ getBackground: () => spec.calls.setBackground || null, getFontColor: () => spec.calls.setFontColor || null });
  const p = new Proxy({}, { get: (_, k) => k === 'build' ? () => spec : (...a) => { spec.calls[k] = a.length <= 1 ? a[0] : a; spec.log.push([k, a]); return p; } });
  return p;
}
let SHEET_ID_ = 1000;
class Sheet {
  constructor(name) {
    this.id = SHEET_ID_++;   // seperti Sheets asli: tetap walau nama tab diganti
    this.name = name; this.data = []; this.formulas = {}; this.protections = [];
    this.fmt = []; this.bandings = []; this.filter = null; this.validations = []; this.cfRules = []; this.charts = [];
    this.tabColor = null; this.isHidden = false; this.widths = {};
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  setName(n) {
    if (this.ss && this.ss.sheets.some(x => x !== this && x.name === n)) throw new Error('Nama tab "' + n + '" sudah dipakai');
    this.name = n; return this;
  }
  getLastRow() {
    let n = this.data.length;
    while (n > 0 && this.data[n - 1].every(v => v === '' || v === undefined || v === null)) n--;
    return n;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return 1000; }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  hideColumns(c, n) { this.hidden = this.hidden || new Set(); for (let i = 0; i < (n || 1); i++) this.hidden.add(c + i); }
  showColumns() { this.hidden = new Set(); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') { const rg = new Range(this, 1, 1, 1, 1); rg.a1 = r; return rg; }
    return new Range(this, r, c, nr || 1, nc || 1);
  }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  appendRow(row) { this.data.push(row.slice()); }
  setFrozenRows(n) { this.frozenRows = n; }
  setFrozenColumns(n) { this.frozenCols = n; }
  clear() { this.data = []; this.formulas = {}; this.fmt = []; }
  clearContents() { this.data = this.data.length ? [] : this.data; this.formulas = {}; return this; }
  insertColumnsAfter() { return this; }
  getProtections() { return this.protections; }
  protect() {
    const p = { unprotected: [], setDescription() { return p; }, setWarningOnly() { return p; },
      setUnprotectedRanges: (r) => { p.unprotected = r; return p; }, remove: () => { this.protections = this.protections.filter(x => x !== p); } };
    this.protections.push(p);
    return p;
  }
  getBandings() { return this.bandings.slice(); }
  getFilter() { return this.filter; }
  getConditionalFormatRules() { return this.cfRules.slice(); }
  setConditionalFormatRules(r) { this.cfRules = r.slice(); }
  setTabColor(c) { this.tabColor = c; return this; }
  getTabColor() { return this.tabColor; }
  hideSheet() { if (this.ss && this.ss.active === this) throw new Error('Tab aktif tidak bisa disembunyikan'); this.isHidden = true; return this; }
  showSheet() { this.isHidden = false; return this; }
  isSheetHidden() { return this.isHidden; }
  getIndex() { return this.ss ? this.ss.sheets.indexOf(this) + 1 : 1; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  setRowHeight(r, h) { (this.heights = this.heights || {})[r] = h; return this; }
  setHiddenGridlines() { return this; }
  insertRowsAfter() { return this; }
  newChart() { return recorder('chart'); }
  insertChart(c) { this.charts.push(c); }
  getCharts() { return this.charts.slice(); }
  removeChart(c) { this.charts = this.charts.filter(x => x !== c); }
}
class Spreadsheet {
  constructor() { this.sheets = [new Sheet('Sheet1')]; this.sheets[0].ss = this; this.tz = 'UTC'; this.locale = 'en_US'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n, i) { const s = new Sheet(n); s.ss = this; if (i == null) this.sheets.push(s); else this.sheets.splice(i, 0, s); return s; }
  setActiveSheet(s) { this.active = s; return s; }
  getActiveSheet() { return this.active || this.sheets[0]; }
  moveActiveSheet(pos) { const s = this.getActiveSheet(); this.sheets = this.sheets.filter(x => x !== s); this.sheets.splice(pos - 1, 0, s); }
  getSheets() { return this.sheets; }
  getSpreadsheetLocale() { return this.locale; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  setRecalculationInterval() {}
  getUrl() { return 'https://docs.google.com/spreadsheets/d/TEST'; }
}

// ---------- Mock globals ----------
const ss = new Spreadsheet();
const user = { email: 'owner@gmail.com' };
const triggers = [];
const mails = [];
// CacheService tiruan. Default MATI (test mengubah sheet langsung tanpa trigger onChange);
// test cache menyalakannya lewat cache.enabled = true.
const cache = { enabled: false, store: {}, puts: 0 };
const scriptCache = {
  get: (k) => (cache.enabled && k in cache.store ? cache.store[k] : null),
  getAll: (ks) => { const o = {}; ks.forEach(k => { if (cache.enabled && k in cache.store) o[k] = cache.store[k]; }); return o; },
  putAll: (o) => { if (!cache.enabled) return; cache.puts++; Object.assign(cache.store, o); },
  remove: (k) => { delete cache.store[k]; },
  removeAll: (ks) => { ks.forEach(k => { delete cache.store[k]; }); }
};
const lock = { held: false };
// PropertiesService.getDocumentProperties() tiruan (penanda migrasi, sheetId tab pengaturan).
const docProps = { store: {},
  getProperty(k) { return k in this.store ? this.store[k] : null; }, setProperty(k, v) { this.store[k] = String(v); return this; },
  getProperties() { return Object.assign({}, this.store); }, setProperties(o) { Object.keys(o).forEach(k => { this.store[k] = String(o[k]); }); return this; },
  deleteProperty(k) { delete this.store[k]; return this; } };

const pad = (n) => String(n).padStart(2, '0');
const Utilities = {
  formatDate(d, tz, fmt) {
    assert.strictEqual(tz, 'Asia/Jakarta');
    const j = new Date(d.getTime() + 7 * 3600e3);
    const map = {
      yyyy: j.getUTCFullYear(), yy: pad(j.getUTCFullYear() % 100), MM: pad(j.getUTCMonth() + 1), dd: pad(j.getUTCDate()),
      HH: pad(j.getUTCHours()), mm: pad(j.getUTCMinutes()), ss: pad(j.getUTCSeconds()), u: (j.getUTCDay() || 7)
    };
    return fmt.replace(/'([^']*)'|yyyy|yy|MM|dd|HH|mm|ss|u/g, (m, lit) => lit !== undefined ? lit : String(map[m]));
  },
  parseDate(s, tz) {
    assert.strictEqual(tz, 'Asia/Jakarta');
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (!m) throw new Error('Unparseable date: ' + s);
    return new FakeDate(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +(m[6] || 0)));
  }
};

const ui = { menus: [] };
const ctx = {
  console: { log() {}, warn: console.warn, error: console.error }, Math, JSON, Date: FakeDate, String, Number, Object, Array, Error, isFinite, isNaN, parseInt,
  SpreadsheetApp: {
    getActive: () => ss, flush() {},
    ProtectionType: { SHEET: 'SHEET' },
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
    WrapStrategy: { CLIP: 'CLIP', OVERFLOW: 'OVERFLOW', WRAP: 'WRAP' },
    BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK' },
    newConditionalFormatRule: () => recorder('cf'),
    newDataValidation: () => recorder('dv'),
    RecalculationInterval: { HOUR: 'HOUR' },
    getUi: () => ({ createMenu: (name) => { ui.menus.push(name); return { addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }; },
      alert: (msg) => { (ui.alerts = ui.alerts || []).push(msg); return 'OK'; },
      // jawaban prompt diambil dari ui.answers (null / habis = Cancel)
      prompt: (title) => { (ui.asked = ui.asked || []).push(title); const a = (ui.answers || []).shift();
        return { getSelectedButton: () => (a == null ? 'CANCEL' : 'OK'), getResponseText: () => (a == null ? '' : a) }; },
      ButtonSet: { OK_CANCEL: 'OK_CANCEL' }, Button: { OK: 'OK', CANCEL: 'CANCEL' } })
  },
  Session: { getActiveUser: () => ({ getEmail: () => user.email }) },
  LockService: {
    getScriptLock: () => ({
      tryLock() { if (lock.held) return false; lock.held = true; return true; },
      releaseLock() { lock.held = false; }
    })
  },
  MailApp: { sendEmail: (m) => mails.push(m) },
  // Google Translate palsu: "[zh-CN] teks" — cukup untuk menguji cache & alur, bukan kualitas terjemahan.
  // Seperti Google: baris per baris, SATU bahasa asal per panggilan. Asal '' = deteksi otomatis: ada huruf Han → seluruh
  // panggilan dianggap 中文 dan baris tanpa Han kembali utuh (perilaku asli yang merusak teks Indonesia di 2.6.0).
  // fail = kuota habis; joinLines = hasil tanpa pemisah baris (jumlah baris tidak cocok); log = semua panggilan.
  LanguageApp: { calls: 0, log: [], fail: false, joinLines: false, translate(text, src, tgt) {
    this.calls++;
    this.log.push({ text: String(text), src, tgt });
    if (this.fail) throw new Error('Service invoked too many times for one day: translate.');
    const han = (l) => /[\u3400-\u9fff]/.test(l), from = src || (han(text) ? 'zh-CN' : 'id');
    return String(text).split('\n').map(l => (from === tgt || (from === 'zh-CN' && !han(l)) ? l : '[' + tgt + '] ' + l))
      .join(this.joinLines ? ' ' : '\n');
  } },
  CacheService: { getScriptCache: () => scriptCache },
  PropertiesService: { getDocumentProperties: () => docProps },
  Charts: { ChartType: { BAR: 'BAR', COLUMN: 'COLUMN', PIE: 'PIE' }, ChartHiddenDimensionStrategy: { SHOW_BOTH: 'SHOW_BOTH' } },
  Utilities,
  ScriptApp: {
    getProjectTriggers: () => triggers,
    newTrigger: (fn) => {
      const make = (every) => ({ create: () => triggers.push({ getHandlerFunction: () => fn, every }) });
      return {
        timeBased: () => ({ everyMinutes: (n) => make('menit:' + n), everyHours: (n) => make('jam:' + n), everyDays: (n) => ({ atHour: (h) => make('hari:' + n + '@' + h) }) }),
        forSpreadsheet: () => ({ onChange: () => make('onChange') })
      };
    },
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/XYZ/exec' })
  },
  HtmlService: {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
    createTemplateFromFile(name) {
      const t = { _name: name };
      t.evaluate = () => {
        const out = { template: name, vars: t };
        out.setTitle = (x) => { out.title = x; return out; }; out.addMetaTag = () => out; out.setXFrameOptionsMode = () => out;
        return out;
      };
      return t;
    },
    createHtmlOutputFromFile: () => ({ getContent: () => '' }),
    createHtmlOutput(html) {
      const out = { template: null, html };
      out.setTitle = (x) => { out.title = x; return out; }; out.addMetaTag = () => out;
      return out;
    }
  }
};
vm.createContext(ctx);
const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort().reverse() // urutan terbalik: pastikan tidak bergantung urutan load
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f }));


module.exports = { ctx, ss, clock, advance, FakeDate, user, lock, triggers, mails, cache, ui, docProps };
