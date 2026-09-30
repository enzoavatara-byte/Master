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
  setFormula(f) { this.sh.formulas[this.a1 || (this.r + ',' + this.c)] = f; return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; this.formulas = {}; this.protections = []; }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return 1000; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') { const rg = new Range(this, 1, 1, 1, 1); rg.a1 = r; return rg; }
    return new Range(this, r, c, nr || 1, nc || 1);
  }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  appendRow(row) { this.data.push(row.slice()); }
  setFrozenRows() {}
  clear() { this.data = []; this.formulas = {}; }
  getProtections() { return this.protections; }
  protect() { const p = { setDescription() { return p; }, setWarningOnly() { return p; } }; this.protections.push(p); return p; }
}
class Spreadsheet {
  constructor() { this.sheets = [new Sheet('Sheet1')]; this.tz = 'UTC'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
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
const lock = { held: false };

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

const ctx = {
  console: { log() {}, warn: console.warn, error: console.error }, Math, JSON, Date: FakeDate, String, Number, Object, Array, Error, isFinite, isNaN, parseInt,
  SpreadsheetApp: {
    getActive: () => ss, flush() {},
    ProtectionType: { SHEET: 'SHEET' },
    RecalculationInterval: { HOUR: 'HOUR' },
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) })
  },
  Session: { getActiveUser: () => ({ getEmail: () => user.email }) },
  LockService: {
    getScriptLock: () => ({
      tryLock() { if (lock.held) return false; lock.held = true; return true; },
      releaseLock() { lock.held = false; }
    })
  },
  MailApp: { sendEmail: (m) => mails.push(m) },
  Utilities,
  ScriptApp: {
    getProjectTriggers: () => triggers,
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }),
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/XYZ/exec' })
  },
  HtmlService: {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
    createTemplateFromFile(name) {
      const t = { _name: name };
      t.evaluate = () => {
        const out = { template: name, vars: t };
        out.setTitle = () => out; out.addMetaTag = () => out; out.setXFrameOptionsMode = () => out;
        return out;
      };
      return t;
    },
    createHtmlOutputFromFile: () => ({ getContent: () => '' })
  }
};
vm.createContext(ctx);
const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort().reverse() // urutan terbalik: pastikan tidak bergantung urutan load
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f }));


module.exports = { ctx, ss, clock, advance, FakeDate, user, lock, triggers, mails };
