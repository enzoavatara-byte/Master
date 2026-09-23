/**
 * Test lokal logika server (src/*.js) dengan mock Apps Script services.
 * Jalankan: node test/run.js
 * Ini TIDAK menguji UI atau perilaku asli Google (izin, kuota, trigger) — hanya logika state machine.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

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
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return 1000; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  appendRow(row) { this.data.push(row.slice()); }
  setFrozenRows() {}
}
class Spreadsheet {
  constructor() { this.sheets = [new Sheet('Sheet1')]; this.tz = 'UTC'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/TEST'; }
}

// ---------- Mock globals ----------
const ss = new Spreadsheet();
let currentUser = 'owner@gmail.com';
const triggers = [];
let lockHeld = false;

function pad(n) { return String(n).padStart(2, '0'); }
function jkt(d) { return new Date(d.getTime() + 7 * 3600e3); }
const Utilities = {
  formatDate(d, tz, fmt) {
    assert.strictEqual(tz, 'Asia/Jakarta');
    const j = jkt(d);
    return fmt.replace('yyyy', j.getUTCFullYear()).replace('MM', pad(j.getUTCMonth() + 1)).replace('dd', pad(j.getUTCDate()))
      .replace('HH', pad(j.getUTCHours())).replace('mm', pad(j.getUTCMinutes())).replace('ss', pad(j.getUTCSeconds())).replace(/'(\w)'/g, '$1');
  },
  parseDate(s, tz, fmt) {
    assert.strictEqual(tz, 'Asia/Jakarta');
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (!m) throw new Error('Unparseable date: ' + s);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +(m[6] || 0)));
  }
};

const ctx = {
  console, Math, JSON, Date, String, Number, Object, Array, Error, isFinite, isNaN,
  SpreadsheetApp: {
    getActive: () => ss, getActiveSpreadsheet: () => ss, flush() {},
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) })
  },
  Session: { getActiveUser: () => ({ getEmail: () => currentUser }) },
  LockService: {
    getScriptLock: () => ({
      tryLock() { if (lockHeld) return false; lockHeld = true; return true; },
      releaseLock() { lockHeld = false; }
    })
  },
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

// ---------- helpers ----------
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
}
function as(email, fn) { const prev = currentUser; currentUser = email; try { return fn(); } finally { currentUser = prev; } }
function throwsMsg(fn, re) { assert.throws(fn, e => re.test(e.message), 'expected error matching ' + re); }
function maintRows() { return ctx.readTable_('Maintenance'); }
function setRowField(id, field, value) {
  const sh = ss.getSheetByName('Maintenance');
  const h = sh.data[0];
  const row = sh.data.find(r => r[0] === id);
  row[h.indexOf(field)] = value;
}
const no = s => { assert.ok(!lockHeld, 'lock leaked after ' + s); };

// ---------- tests ----------
console.log('MTTR server logic');

test('setup membuat sheet, header, config, admin pertama, trigger (idempotent)', () => {
  ctx.setup(); ctx.setup();
  for (const n of ['Users', 'Lines', 'Maintenance', 'Config']) assert.ok(ss.getSheetByName(n), n);
  assert.ok(!ss.getSheetByName('Sheet1'));
  assert.strictEqual(ss.tz, 'Asia/Jakarta');
  const users = ctx.readTable_('Users');
  assert.strictEqual(users.length, 1);
  assert.strictEqual(users[0].Role, 'Admin');
  assert.strictEqual(triggers.length, 1);
  assert.strictEqual(ctx.readTable_('Config').length, 1);
  assert.strictEqual(ctx.getAbandonHours_(), 8);
});

// seed
const U = ss.getSheetByName('Users');
U.appendRow(['me1@gmail.com', 'Budi', 'ME', 'MTN', 'Active']);
U.appendRow(['Me2@Gmail.com ', 'Andi', 'me', 'MTN', 'active']);
U.appendRow(['spv@gmail.com', 'Sari', 'Supervisor', 'MTN', 'Active']);
U.appendRow(['old@gmail.com', 'Lama', 'ME', 'MTN', 'Inactive']);
const L = ss.getSheetByName('Lines');
L.appendRow(['L01', 'Line Assy 1', 'Press 200T', 'PROD', 'Hall A', 'Active']);
L.appendRow(['L02', 'Line Assy 2', 'Welder', 'PROD', 'Hall B', 'Active']);
L.appendRow(['L99', 'Line Mati', 'X', 'PROD', 'Hall C', 'Inactive']);

test('email tidak terdaftar / nonaktif ditolak (doGet + api)', () => {
  as('stranger@gmail.com', () => {
    assert.strictEqual(ctx.doGet({ parameter: {} }).template, 'Message');
    throwsMsg(() => ctx.apiBootstrap(''), /ACCESS_DENIED/);
  });
  as('old@gmail.com', () => throwsMsg(() => ctx.apiStart('L01'), /ACCESS_DENIED/));
  as('', () => assert.strictEqual(ctx.doGet({ parameter: {} }).template, 'Message'));
});

test('email & role case-insensitive, doGet meneruskan line param yang disanitasi', () => {
  as('me2@gmail.com', () => {
    const b = ctx.apiBootstrap('');
    assert.strictEqual(b.user.role, 'ME');
    const out = ctx.doGet({ parameter: { line: 'L01"</script><x>' } });
    assert.strictEqual(out.template, 'Index');
    assert.strictEqual(out.vars.lineId, 'L01scriptx');
  });
});

let id1;
test('START via QR: IN_PROGRESS, timestamp server, line case-insensitive', () => {
  const before = Date.now();
  const v = as('me1@gmail.com', () => ctx.apiStart('l01'));
  no('start');
  assert.ok(v.found && v.active && v.canAct);
  assert.strictEqual(v.active.status, 'IN_PROGRESS');
  id1 = v.active.id;
  assert.match(id1, /^MT-\d{8}-\d{6}-[A-Z0-9]{4}$/);
  const r = maintRows()[0];
  assert.ok(r['Start Time'] instanceof Date && r['Start Time'].getTime() >= before);
  assert.strictEqual(r['Finish Time'], '');
  assert.strictEqual(r['User Email'], 'me1@gmail.com');
});

test('BLOCK: line yang sama tidak bisa di-START dua kali', () => {
  as('me2@gmail.com', () => throwsMsg(() => ctx.apiStart('L01'), /sudah punya maintenance IN_PROGRESS/));
  as('me1@gmail.com', () => throwsMsg(() => ctx.apiStart('L01'), /sudah punya/));
  no('blocked start');
  assert.strictEqual(maintRows().length, 1);
});

test('START ditolak untuk line tidak ada / nonaktif', () => {
  as('me1@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('NOPE'), /tidak ditemukan/);
    throwsMsg(() => ctx.apiStart('L99'), /nonaktif/);
  });
});

test('Lock sibuk -> error jelas, tidak ada record ganda', () => {
  lockHeld = true;
  as('me2@gmail.com', () => throwsMsg(() => ctx.apiStart('L02'), /sibuk/));
  lockHeld = false;
  assert.strictEqual(maintRows().length, 1);
});

test('ME lain melihat line terkunci tapi tidak bisa menutup', () => {
  const v = as('me2@gmail.com', () => ctx.apiGetLine('L01'));
  assert.strictEqual(v.canAct, false);
  assert.strictEqual(v.active.userName, 'Budi');
  as('me2@gmail.com', () => throwsMsg(() => ctx.apiComplete(id1, { problem: 'x', actionTaken: 'y', testingResult: 'OK' }), /Hanya ME/));
  no('forbidden complete');
});

test('COMPLETE: validasi form wajib', () => {
  as('me1@gmail.com', () => {
    throwsMsg(() => ctx.apiComplete(id1, { problem: ' ', actionTaken: 'y', testingResult: 'OK' }), /Problem/);
    throwsMsg(() => ctx.apiComplete(id1, { problem: 'x', actionTaken: '', testingResult: 'OK' }), /Action/);
    throwsMsg(() => ctx.apiComplete(id1, { problem: 'x', actionTaken: 'y', testingResult: 'MAYBE' }), /OK atau NG/);
  });
});

test('COMPLETE dengan NG: status COMPLETED, finish & duration tercatat, tidak loop', () => {
  setRowField(id1, 'Start Time', new Date(Date.now() - 42 * 60e3)); // mulai 42 menit lalu
  const v = as('me1@gmail.com', () => ctx.apiComplete(id1, { problem: 'Sensor error', actionTaken: 'Ganti kabel', partReplaced: '', testingResult: 'ng' }));
  no('complete');
  assert.strictEqual(v.active, null, 'line bebas lagi');
  const r = maintRows().find(x => x['Maintenance ID'] === id1);
  assert.strictEqual(r.Status, 'COMPLETED');
  assert.strictEqual(r['Testing Result'], 'NG');
  assert.strictEqual(r['Part Replaced'], '-');
  assert.ok(r['Finish Time'] instanceof Date);
  assert.ok(Math.abs(r['Duration (min)'] - 42) < 0.1, 'duration ' + r['Duration (min)']);
  assert.strictEqual(r['Closed By'], 'me1@gmail.com');
  as('me1@gmail.com', () => throwsMsg(() => ctx.apiComplete(id1, { problem: 'x', actionTaken: 'y', testingResult: 'OK' }), /sudah berstatus COMPLETED/));
});

test('Setelah NG, maintenance baru bisa dibuka di line yang sama', () => {
  const v = as('me1@gmail.com', () => ctx.apiStart('L01'));
  assert.notStrictEqual(v.active.id, id1);
});

let idAband, idCancel;
test('CANCEL: butuh alasan, tidak ada finish/duration', () => {
  idCancel = as('me2@gmail.com', () => ctx.apiStart('L02')).active.id;
  as('me2@gmail.com', () => throwsMsg(() => ctx.apiCancel(idCancel, '  '), /Alasan/));
  as('me2@gmail.com', () => ctx.apiCancel(idCancel, 'Salah scan'));
  const r = maintRows().find(x => x['Maintenance ID'] === idCancel);
  assert.strictEqual(r.Status, 'CANCELLED');
  assert.strictEqual(r['Finish Time'], '');
  assert.strictEqual(r['Duration (min)'], '');
  assert.match(r.Note, /Salah scan/);
});

test('ABANDONED: > 8 jam -> status berubah, Finish Time TIDAK diisi', () => {
  idAband = maintRows().find(r => r.Status === 'IN_PROGRESS' && r['Line ID'] === 'L01')['Maintenance ID'];
  setRowField(idAband, 'Start Time', new Date(Date.now() - 7.9 * 3600e3));
  assert.strictEqual(ctx.markAbandoned(), 0, 'belum 8 jam');
  setRowField(idAband, 'Start Time', new Date(Date.now() - 8.1 * 3600e3));
  assert.strictEqual(ctx.markAbandoned(), 1);
  no('markAbandoned');
  const r = maintRows().find(x => x['Maintenance ID'] === idAband);
  assert.strictEqual(r.Status, 'ABANDONED');
  assert.strictEqual(r['Finish Time'], '');
  assert.match(r.Note, /AUTO/);
});

test('ABANDONED: ME tidak bisa complete, line bebas untuk START baru', () => {
  as('me1@gmail.com', () => throwsMsg(() => ctx.apiComplete(idAband, { problem: 'x', actionTaken: 'y', testingResult: 'OK' }), /ABANDONED/));
  assert.strictEqual(as('me1@gmail.com', () => ctx.apiGetLine('L01')).active, null);
});

test('Threshold bisa diubah via sheet Config', () => {
  const c = ss.getSheetByName('Config');
  c.data[1][1] = 2;
  assert.strictEqual(ctx.getAbandonHours_(), 2);
  c.data[1][1] = 'abc';
  assert.strictEqual(ctx.getAbandonHours_(), 8);
  c.data[1][1] = 8;
});

test('Review: hanya Supervisor/Admin, antrian berisi ABANDONED', () => {
  as('me1@gmail.com', () => throwsMsg(() => ctx.apiListAbandoned(), /tidak punya akses/));
  const list = as('spv@gmail.com', () => ctx.apiListAbandoned());
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, idAband);
  assert.strictEqual(as('spv@gmail.com', () => ctx.apiBootstrap('')).abandonedCount, 1);
});

test('Review COMPLETE: validasi finish time & catatan, lalu tercatat dengan audit', () => {
  const start = maintRows().find(x => x['Maintenance ID'] === idAband)['Start Time'];
  const fmt = d => ctx.Utilities.formatDate(d, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm");
  as('spv@gmail.com', () => {
    throwsMsg(() => ctx.apiResolveAbandoned(idAband, { decision: 'COMPLETE', finishTime: fmt(new Date(start.getTime() + 3600e3)), note: '' }), /Catatan/);
    throwsMsg(() => ctx.apiResolveAbandoned(idAband, { decision: 'COMPLETE', finishTime: fmt(new Date(start.getTime() - 3600e3)), note: 'x' }), /setelah Start/);
    throwsMsg(() => ctx.apiResolveAbandoned(idAband, { decision: 'COMPLETE', finishTime: fmt(new Date(Date.now() + 3600e3)), note: 'x' }), /masa depan/);
    throwsMsg(() => ctx.apiResolveAbandoned(idAband, { decision: 'COMPLETE', note: 'x' }), /wajib/);
    throwsMsg(() => ctx.apiResolveAbandoned(idAband, { decision: 'WHAT', note: 'x' }), /tidak dikenal/);
    no('review validation');
    const finish = new Date(Math.floor((start.getTime() + 90 * 60e3) / 60e3) * 60e3 + 60e3);
    const rest = ctx.apiResolveAbandoned(idAband, { decision: 'COMPLETE', finishTime: fmt(finish), problem: 'Motor', actionTaken: 'Reset', testingResult: 'OK', note: 'Konfirmasi via telp' });
    assert.strictEqual(rest.length, 0);
  });
  const r = maintRows().find(x => x['Maintenance ID'] === idAband);
  assert.strictEqual(r.Status, 'COMPLETED');
  assert.strictEqual(r['Reviewed By'], 'spv@gmail.com');
  assert.ok(r['Reviewed At'] instanceof Date);
  assert.match(r.Note, /^REVIEW \(finish manual\)/);
  assert.ok(r['Duration (min)'] > 90 && r['Duration (min)'] < 92, String(r['Duration (min)']));
  as('spv@gmail.com', () => throwsMsg(() => ctx.apiResolveAbandoned(idAband, { decision: 'CANCEL', note: 'x' }), /tidak ada di antrian/));
});

test('Review CANCEL', () => {
  const id = as('me2@gmail.com', () => ctx.apiStart('L02')).active.id;
  setRowField(id, 'Start Time', new Date(Date.now() - 9 * 3600e3));
  ctx.markAbandoned();
  as('owner@gmail.com', () => ctx.apiResolveAbandoned(id, { decision: 'CANCEL', note: 'ME lupa, tidak ada repair' }));
  const r = maintRows().find(x => x['Maintenance ID'] === id);
  assert.strictEqual(r.Status, 'CANCELLED');
  assert.strictEqual(r['Finish Time'], '');
});

test('Supervisor boleh menutup maintenance milik ME lain', () => {
  const id = as('me2@gmail.com', () => ctx.apiStart('L02')).active.id;
  as('spv@gmail.com', () => ctx.apiComplete(id, { problem: 'a', actionTaken: 'b', testingResult: 'OK' }));
  const r = maintRows().find(x => x['Maintenance ID'] === id);
  assert.strictEqual(r['Closed By'], 'spv@gmail.com');
  assert.strictEqual(r['User Email'], 'me2@gmail.com');
});

test('Riwayat: ME lihat miliknya, Supervisor lihat semua + filter', () => {
  const all = as('spv@gmail.com', () => ctx.apiListRecords({}));
  assert.strictEqual(all.total, maintRows().length);
  assert.ok(all.spreadsheetUrl);
  const mine = as('me1@gmail.com', () => ctx.apiListRecords({}));
  assert.ok(mine.records.every(r => r.userEmail === 'me1@gmail.com'));
  assert.strictEqual(mine.spreadsheetUrl, '');
  const ng = as('spv@gmail.com', () => ctx.apiListRecords({ testing: 'x', status: 'CANCELLED' }));
  assert.ok(ng.records.length >= 2 && ng.records.every(r => r.status === 'CANCELLED'));
  const l02 = as('spv@gmail.com', () => ctx.apiListRecords({ lineId: 'l02' }));
  assert.ok(l02.records.every(r => r.lineId === 'L02'));
  const future = as('spv@gmail.com', () => ctx.apiListRecords({ from: '2099-01-01' }));
  assert.strictEqual(future.total, 0);
  const s = all.records[0];
  assert.strictEqual(typeof s.startIso, 'string'); // tidak ada Date di payload
  assert.ok(!Object.values(s).some(v => v instanceof Date));
});

test('QR list hanya Admin', () => {
  as('spv@gmail.com', () => throwsMsg(() => ctx.apiListLinesForQr(), /tidak punya akses/));
  const q = as('owner@gmail.com', () => ctx.apiListLinesForQr());
  assert.strictEqual(q.lines.length, 3);
  assert.match(q.baseUrl, /\/exec$/);
});

test('Tidak ada lock yang bocor', () => no('end'));

console.log(`\n${passed} passed${process.exitCode ? ', ADA YANG GAGAL' : ''}`);
