/**
 * Test lokal logika server (src/*.js) dengan mock Apps Script services + jam yang bisa dimajukan.
 * Jalankan: node test/run.js
 * Ini TIDAK menguji UI atau perilaku asli Google (izin, kuota, trigger, rumus FILTER) — hanya logika.
 */
'use strict';
const assert = require('assert');
const { ctx, ss, clock, advance, FakeDate, user, lock, triggers, mails } = require('./mock');

// ---------- helpers ----------
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
  assert.ok(!lock.held, 'lock bocor setelah: ' + name);
}
function as(email, fn) { const prev = user.email; user.email = email; try { return fn(); } finally { user.email = prev; } }
function throwsMsg(fn, re) { assert.throws(fn, e => re.test(e.message), 'expected error matching ' + re); }
const rec = (id) => ctx.readTable_('Maintenance').find(r => r['Maintenance ID'] === id);
const logOf = (id) => ctx.readTable_('Log').filter(r => r['Maintenance ID'] === id).map(r => r['Kejadian']);
const jeq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.02, a + ' ≈ ' + b);
const sel = (masalah, extra) => ({ values: { Masalah: masalah, Penyebab: 'Komponen aus', Penanganan: 'Ganti part' }, other: {}, ...extra });
const done = sel('Sensor error', { parts: [{ nama: 'Fuse', jumlah: 2 }] });
const pend = (dik, tertunda, tenggat, extra) => ({ values: { 'Pekerjaan dilakukan': dik, 'Yang tertunda': tertunda }, tenggat, ...extra });

// ---------- tests ----------
console.log('MTTR 2.1 server logic');

test('setup: sheet, tab FILTER, pilihan, config, admin pertama, trigger (idempotent)', () => {
  ctx.setup(); ctx.setup();
  for (const n of ['Users', 'Factory', 'Projects', 'Lines', 'Mesin', 'BOM', 'Pilihan', 'Form', 'Config', 'Maintenance', 'Log', 'Maintenance VF7', 'Maintenance Limo7', 'Maintenance E22H', 'Maintenance E245', 'Pending Work']) assert.ok(ss.getSheetByName(n), n);
  assert.ok(!ss.getSheetByName('Sheet1'));
  assert.strictEqual(triggers.length, 1);
  assert.strictEqual(triggers[0].getHandlerFunction(), 'checkTimeouts');
  assert.strictEqual(ctx.readTable_('Config').length, 5);
  assert.strictEqual(ctx.readTable_('Users')[0].Peran, 'Admin');
  jeq(ctx.readTable_('Projects').map(p => p['Factory ID'] + ':' + p.Baterai), ['F1:VF7', 'F1:Limo7', 'F2:E22H', 'F2:E245']);
  assert.strictEqual(ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Masalah').length, 5, 'pilihan tidak terduplikasi');
  assert.strictEqual(ctx.readTable_('Form').length, 15, 'form tidak terduplikasi');
  const f = ss.getSheetByName('Maintenance E22H').formulas.A1;
  assert.match(f, /^=FILTER\('Maintenance'!A:AG, \(ROW\('Maintenance'!A:A\)=1\)\+\('Maintenance'!C:C="E22H"\)\)$/);
  const p = ss.getSheetByName('Pending Work').formulas.A2;
  assert.match(p, /'Maintenance'!D2:D="Pending"/);
  assert.match(p, /NOW\(\)-'Maintenance'!U2:U/);
  assert.strictEqual(ss.getSheetByName('Maintenance').protections.length, 1);
});

const U = ss.getSheetByName('Users');
U.appendRow(['budi@gmail.com', 'Budi', 'Teknisi', 'Ya']);
U.appendRow(['Andi@Gmail.com ', 'Andi', 'ME', 'ya']);        // alias peran v1 + email beda kapital
U.appendRow(['sari@gmail.com', 'Sari', 'Admin', 'Ya']);
U.appendRow(['lama@gmail.com', 'Lama', 'Teknisi', 'Tidak']);
const L = ss.getSheetByName('Lines');
L.appendRow(['L01', 'Assy 1', 'F2', '', '', 'Hall A', 'Ya']);
L.appendRow(['L02', 'Assy 2', 'F2', '', '', 'Hall A', 'Ya']);
L.appendRow(['L03', 'Assy 3', 'F2', '', '', 'Hall B', 'Ya']);
L.appendRow(['L99', 'Mati', 'F2', '', '', 'Hall C', 'Tidak']);

test('akses: tidak terdaftar / nonaktif ditolak; doGet menyanitasi ?line', () => {
  as('asing@gmail.com', () => {
    assert.strictEqual(ctx.doGet({ parameter: {} }).template, 'Message');
    throwsMsg(() => ctx.apiBootstrap(''), /ACCESS_DENIED/);
  });
  as('lama@gmail.com', () => throwsMsg(() => ctx.apiStart('L01', 'E22H'), /ACCESS_DENIED/));
  as('andi@gmail.com', () => {
    assert.strictEqual(ctx.apiBootstrap('').user.role, 'Teknisi');
    assert.strictEqual(ctx.doGet({ parameter: { line: 'L01"</script>' } }).vars.lineId, 'L01script');
  });
});

let A;
test('mulai: 1 tap → Aktif, ID = LINE-yyMMdd-NN, waktu dari server, baterai tervalidasi', () => {
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L01', ''), /Baterai wajib/);
    throwsMsg(() => ctx.apiStart('L01', 'X1'), /tidak ada di daftar/);
    throwsMsg(() => ctx.apiStart('L99', 'E22H'), /nonaktif/);
    const v = ctx.apiStart('l01', 'E245');
    assert.ok(v.open && v.openIsMine);
    A = v.open.id;
  });
  assert.strictEqual(A, 'L01-260930-01');
  const r = rec(A);
  assert.strictEqual(r.Status, 'Aktif');
  assert.strictEqual(r['Mulai'].getTime(), clock.now);
  jeq(logOf(A), ['start']);
});

test('blok: 1 teknisi 1 pekerjaan terbuka; 1 line 1 pekerjaan terbuka; info PIC di halaman line', () => {
  as('budi@gmail.com', () => throwsMsg(() => ctx.apiStart('L02', 'E22H'), /masih punya maintenance Aktif/));
  as('andi@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L01', 'E22H'), /sedang dikerjakan/);
    const v = ctx.apiGetLine('L01');
    assert.ok(v.open && !v.openIsMine);
    assert.strictEqual(v.open.techLastName, 'Budi');
  });
});

test('pause/resume: hanya waktu aktif ke Total aktif, pause terpisah', () => {
  advance(10);
  as('andi@gmail.com', () => throwsMsg(() => ctx.apiPause(A, ''), /dipegang teknisi lain/));
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiPause(A, 'Ngopi'), /tidak ada di daftar/);
    ctx.apiPause(A, 'Istirahat');
    throwsMsg(() => ctx.apiComplete(A, done), /berstatus Pause/);
    advance(5);
    ctx.apiResume(A);
    advance(20);
  });
  const r = rec(A);
  near(r['Total aktif (menit)'], 10);
  near(r['Total pause (menit)'], 5);
});

test('selesai: dropdown wajib, Lainnya butuh catatan, part + jumlah / Tidak ada → Completed, MTTR Ya', () => {
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiComplete(A, sel('', { parts: done.parts })), /Masalah wajib/);
    throwsMsg(() => ctx.apiComplete(A, sel('Lainnya', { parts: done.parts })), /Lainnya.*keterangan/);
    throwsMsg(() => ctx.apiComplete(A, { ...done, parts: [] }), /Tidak ada/);
    throwsMsg(() => ctx.apiComplete(A, { ...done, parts: [{ nama: 'Fuse', jumlah: 0 }] }), /Jumlah part/);
    const v = ctx.apiComplete(A, done);
    assert.strictEqual(v.open, null);
  });
  const r = rec(A);
  assert.strictEqual(r.Status, 'Completed');
  assert.strictEqual(r.Part, 'Fuse x2');
  assert.strictEqual(r['Masuk MTTR'], 'Ya');
  near(r['Total aktif (menit)'], 30);
  jeq(logOf(A), ['start', 'pause', 'resume', 'complete']);
});

test('baterai default = baterai terakhir di line', () => {
  as('andi@gmail.com', () => {
    assert.strictEqual(ctx.apiGetLine('L01').lastBattery, 'E245');
    assert.strictEqual(ctx.apiGetLine('L02').lastBattery, 'E22H', 'belum ada riwayat → baterai pertama line');
  });
});

let B;
test('pending: satu form → Pending, perlu review, tampil di tab Pending & halaman line', () => {
  as('budi@gmail.com', () => { B = ctx.apiStart('L02', 'E22H').open.id; });
  advance(15);
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiPending(B, pend('', 'Menunggu part', 'BESOK')), /sudah dilakukan wajib/);
    throwsMsg(() => ctx.apiPending(B, pend('Cek wiring', 'Menunggu part')), /Tenggat wajib/);
    throwsMsg(() => ctx.apiPending(B, pend('x', 'Menunggu part', 'TANGGAL', { tanggal: '2026-09-01' })), /masa lalu/);
    ctx.apiPending(B, pend('Cek wiring, sensor rusak', 'Menunggu part', 'BESOK'));
  });
  const r = rec(B);
  assert.strictEqual(r.Status, 'Pending');
  assert.strictEqual(r['Status review'], 'Perlu review');
  near(r['Total aktif (menit)'], 15);
  assert.strictEqual(ctx.fmtDate_(r.Tenggat), '2026-10-01 23:59:59');
  as('andi@gmail.com', () => {
    const list = ctx.apiListPending().items;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].overdue, false);
    assert.strictEqual(ctx.apiGetLine('L02').pendings[0].id, B);
    assert.strictEqual(ctx.apiBootstrap('').counts.pending, 1);
  });
  // teknisi yang pending sudah bebas mulai pekerjaan lain
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiBootstrap('').myOpen, null));
});

test('lanjutkan pending: wajib QR line yang sama, user lain, ID sama, waktu pending tercatat', () => {
  advance(60);
  as('andi@gmail.com', () => {
    throwsMsg(() => ctx.apiContinue(B, 'L03'), /bukan line L02/);
    throwsMsg(() => ctx.apiContinue(B, ''), /bukan line L02/);
    const v = ctx.apiContinue(B, 'l02');
    assert.ok(v.open && v.openIsMine && v.open.id === B);
    throwsMsg(() => ctx.apiContinue(B, 'L02'), /tidak lagi Pending/);
  });
  const r = rec(B);
  assert.strictEqual(r.Status, 'Aktif');
  assert.strictEqual(r['Teknisi awal'], 'budi@gmail.com');
  assert.strictEqual(r['Teknisi terakhir'], 'andi@gmail.com');
  assert.strictEqual(r['Teknisi terlibat'], 'budi@gmail.com, andi@gmail.com');
  near(r['Total pending (menit)'], 60);
  assert.strictEqual(r['Status review'], '');
  as('andi@gmail.com', () => assert.strictEqual(ctx.apiListPending().items.length, 0));
  advance(10);
  as('andi@gmail.com', () => ctx.apiComplete(B, { ...done, tanpaPart: true }));
  near(rec(B)['Total aktif (menit)'], 25);
  assert.strictEqual(rec(B).Part, 'Tidak ada');
});

test('cancel: alasan wajib dari daftar, Lainnya butuh catatan, teknisi lain ditolak, Admin boleh', () => {
  let C;
  as('budi@gmail.com', () => {
    C = ctx.apiStart('L03', 'E22H').open.id;
    throwsMsg(() => ctx.apiCancel(C, ''), /Alasan cancel wajib/);
    throwsMsg(() => ctx.apiCancel(C, 'Lainnya', ''), /Lainnya.*keterangan/);
  });
  as('andi@gmail.com', () => throwsMsg(() => ctx.apiCancel(C, 'Salah line'), /Hanya teknisi/));
  as('sari@gmail.com', () => ctx.apiCancel(C, 'Input ganda'));
  const r = rec(C);
  assert.strictEqual(r.Status, 'Cancelled');
  assert.strictEqual(r['Masuk MTTR'], 'Tidak');
  assert.strictEqual(r['Status review'], 'Perlu review');
  assert.match(ctx.readTable_('Log').slice(-1)[0].Detail, /oleh Admin/);
});

let D;
test('trigger 3 jam: peringatan + email; "Masih lanjut" tidak mereset timer', () => {
  as('budi@gmail.com', () => { D = ctx.apiStart('L03', 'E245').open.id; });
  advance(179);
  jeq(ctx.checkTimeouts(), { warned: 0, abandoned: 0 });
  advance(2);
  jeq(ctx.checkTimeouts(), { warned: 1, abandoned: 0 });
  jeq(ctx.checkTimeouts(), { warned: 0, abandoned: 0 }, 'tidak diperingatkan dua kali');
  assert.strictEqual(mails.length, 1);
  assert.strictEqual(mails[0].to, 'budi@gmail.com');
  as('budi@gmail.com', () => assert.ok(ctx.apiBootstrap('').myOpen.warnedIso));
  as('sari@gmail.com', () => assert.strictEqual(ctx.apiListReview().warnings.length, 1));
  advance(30);
  as('budi@gmail.com', () => ctx.apiConfirmStillWorking(D));
  const r = rec(D);
  assert.strictEqual(r['Peringatan pada'], '');
  assert.strictEqual(r['Mulai'].getTime(), clock.now - 211 * 60000, 'Mulai tidak berubah');
  advance(179);
  assert.strictEqual(ctx.checkTimeouts().warned, 0, 'hitungan 3 jam dari konfirmasi terakhir');
});

test('trigger 4 jam: peringatan tidak dijawab → Abandoned, masuk review, MTTR Menunggu', () => {
  advance(2);
  assert.strictEqual(ctx.checkTimeouts().warned, 1);
  advance(59);
  assert.strictEqual(ctx.checkTimeouts().abandoned, 0);
  advance(1);
  assert.strictEqual(ctx.checkTimeouts().abandoned, 1);
  const r = rec(D);
  assert.strictEqual(r.Status, 'Abandoned');
  assert.strictEqual(r['Masuk MTTR'], 'Menunggu');
  assert.strictEqual(r['Status review'], 'Perlu review');
  as('budi@gmail.com', () => throwsMsg(() => ctx.apiComplete(D, done), /berstatus Abandoned/));
  jeq(logOf(D).slice(-2), ['peringatan', 'abandoned']);
});

test('trigger telat (> 4 jam tanpa peringatan): diperingatkan dulu, tidak langsung Abandoned', () => {
  let E;
  as('andi@gmail.com', () => { E = ctx.apiStart('L01', 'E22H').open.id; });
  advance(300);
  jeq(ctx.checkTimeouts(), { warned: 1, abandoned: 0 });
  advance(60);
  assert.strictEqual(ctx.checkTimeouts().abandoned, 1);
  assert.strictEqual(rec(E).Status, 'Abandoned');
});

test('EMAIL_PERINGATAN = Tidak → cukup banner, tanpa email', () => {
  const cfg = ss.getSheetByName('Config');
  const row = cfg.data.find(r => r[0] === 'EMAIL_PERINGATAN');
  row[1] = 'Tidak';
  const before = mails.length;
  let F;
  as('budi@gmail.com', () => { F = ctx.apiStart('L02', 'E22H').open.id; });
  advance(181);
  assert.strictEqual(ctx.checkTimeouts().warned, 1);
  assert.strictEqual(mails.length, before);
  row[1] = 'Ya';
  as('budi@gmail.com', () => ctx.apiCancel(F, 'Masalah hilang sendiri'));
});

test('review: teknisi hanya lihat miliknya & hanya boleh cek Pending; Admin putuskan Cancelled/Abandoned', () => {
  let P;
  as('andi@gmail.com', () => {
    P = ctx.apiStart('L03', 'E22H').open.id;
    ctx.apiPending(P, pend('Bongkar cover', 'Butuh teknisi lain', 'HARI_INI'));
  });
  as('budi@gmail.com', () => {
    const ids = ctx.apiListReview().items.map(i => i.id);
    assert.ok(!ids.includes(P), 'pending milik Andi tidak terlihat Budi');
    const mine = ctx.apiListReview().items.find(i => i.status === 'Abandoned');
    assert.strictEqual(mine.canDecide, false);
    throwsMsg(() => ctx.apiReview(D, { action: 'KELUARKAN', note: 'x' }), /tidak berwenang/);
  });
  as('andi@gmail.com', () => {
    throwsMsg(() => ctx.apiReview(P, { action: 'SETUJU' }), /tidak valid/);
    ctx.apiReview(P, { action: 'CEK', note: 'ok' });
    throwsMsg(() => ctx.apiReview(P, { action: 'CEK' }), /tidak ada di antrian/);
  });
  assert.strictEqual(rec(P).Status, 'Pending', 'review tidak mengubah status pending');
  as('sari@gmail.com', () => {
    const list = ctx.apiListReview().items;
    assert.ok(list.length >= 3);
    assert.strictEqual(list[0].status, 'Abandoned', 'Abandoned paling atas');
    throwsMsg(() => ctx.apiReview(D, { action: 'HITUNG', activeMin: 60 }), /Catatan review wajib/);
    throwsMsg(() => ctx.apiReview(D, { action: 'HITUNG', activeMin: 99999, note: 'x' }), /Menit aktif/);
    ctx.apiReview(D, { action: 'HITUNG', activeMin: 90, note: 'Konfirmasi teknisi: selesai jam 12' });
    const cancelled = list.find(i => i.status === 'Cancelled');
    ctx.apiReview(cancelled.id, { action: 'SETUJU' });
  });
  const r = rec(D);
  assert.strictEqual(r['Masuk MTTR'], 'Ya');
  assert.strictEqual(r['Total aktif (menit)'], 90);
  assert.strictEqual(r['Direview oleh'], 'sari@gmail.com');
});

test('pending lewat tenggat: ditandai merah & diurutkan paling atas', () => {
  advance(24 * 60);
  as('budi@gmail.com', () => {
    const items = ctx.apiListPending().items;
    assert.ok(items[0].overdue);
  });
});

test('MTTR & statistik hanya dari Masuk MTTR = Ya (rata-rata menit aktif)', () => {
  const rows = ctx.readTable_('Maintenance').filter(r => r['Masuk MTTR'] === 'Ya');
  const exp = rows.reduce((s, r) => s + Number(r['Total aktif (menit)']), 0) / rows.length;
  clock.now -= 24 * 60 * 60000; // kembali ke hari data dibuat supaya masuk jendela 7 hari
  as('budi@gmail.com', () => {
    const st = ctx.apiBootstrap('').stats;
    assert.strictEqual(st.mttrN, rows.length);
    near(st.mttrMin, exp);
    assert.strictEqual(st.days.length, 7);
    assert.strictEqual(st.days[6].label, 'Hari ini');
  });
  clock.now += 24 * 60 * 60000;
});

test('riwayat: teknisi hanya pekerjaan yang pernah diikuti; Admin bisa lihat semua', () => {
  as('budi@gmail.com', () => {
    const h = ctx.apiHistory({});
    assert.ok(h.items.every(i => i.techFirst === 'budi@gmail.com' || i.techLast === 'budi@gmail.com'));
    assert.ok(h.items.some(i => i.id === B), 'B dimulai Budi, diselesaikan Andi');
    assert.strictEqual(ctx.apiHistory({ scope: 'all' }).total, h.total, 'scope all diabaikan untuk teknisi');
    assert.strictEqual(h.spreadsheetUrl, '');
  });
  as('sari@gmail.com', () => {
    const all = ctx.apiHistory({ scope: 'all' });
    assert.strictEqual(all.total, ctx.readTable_('Maintenance').length);
    assert.ok(all.items[0].startIso >= all.items[all.items.length - 1].startIso, 'terbaru di atas');
    assert.ok(ctx.apiHistory({ scope: 'all', battery: 'E245' }).items.every(i => i.battery === 'E245'));
  });
});

test('detail: riwayat kejadian dari Log, urut waktu', () => {
  as('budi@gmail.com', () => {
    const d = ctx.apiGetDetail(B);
    jeq(d.events.map(e => e.event), ['start', 'pending', 'lanjut', 'complete']);
    assert.match(d.record.dikerjakan, /Budi\] Cek wiring/);
  });
});

test('Log hanya ditambah, jumlah baris = jumlah kejadian', () => {
  const log = ctx.readTable_('Log');
  assert.ok(log.length > 20);
  assert.ok(log.every((r, i) => i === 0 || r.Timestamp >= log[i - 1].Timestamp));
});

test('tenggat "shift berikutnya" = akhir shift sesudah shift berjalan', () => {
  // 08:00 WIB (shift 07-15 berjalan) → shift berikutnya 15-23 → tenggat 23:00
  const t = new FakeDate(Date.UTC(2026, 8, 30, 1, 0, 0));
  assert.strictEqual(ctx.fmtDate_(ctx.endOfNextShift_(t)), '2026-09-30 23:00:00');
  // 23:30 WIB → shift berikutnya 07-15 besok → 15:00
  const t2 = new FakeDate(Date.UTC(2026, 8, 30, 16, 30, 0));
  assert.strictEqual(ctx.fmtDate_(ctx.endOfNextShift_(t2)), '2026-10-01 15:00:00');
});

test('ID urut per line per hari', () => {
  clock.now = Date.UTC(2026, 9, 5, 2, 0, 0);
  as('sari@gmail.com', () => {
    const x = ctx.apiStart('L02', 'E22H').open.id;
    ctx.apiCancel(x, 'Salah line');
    const y = ctx.apiStart('L02', 'E22H').open.id;
    assert.strictEqual(x, 'L02-261005-01');
    assert.strictEqual(y, 'L02-261005-02');
  });
});

test('BOM: sheet belum ada → [] (tidak error)', () => {
  const sh = ss.getSheetByName('BOM');
  ss.sheets = ss.sheets.filter(x => x !== sh);
  as('budi@gmail.com', () => jeq(ctx.apiGetBom('L01'), []));
  ss.sheets.push(sh);
});

test('BOM: per line + part umum (*), hanya Aktif, tampil di halaman line', () => {
  const B = ss.getSheetByName('BOM');
  B.appendRow(['L01', '', 'SN-100', 'Sensor proximity M12', 4, 'pcs', 'Rak A-01', 2, 'Ya']);
  B.appendRow(['l01', '', '', 'Belt conveyor 1200', 1, 'pcs', 'Rak B-03', 1, 'Ya']);
  B.appendRow(['L01', '', 'OLD-1', 'Part lama', 1, 'pcs', '', '', 'Tidak']);
  B.appendRow(['L02', '', 'MT-7', 'Motor 0.75kW', 2, 'unit', 'Gudang', 1, 'Ya']);
  B.appendRow(['*', '', 'FU-10', 'Fuse 10A', 10, 'pcs', 'Rak Umum', 20, 'Ya']);
  as('budi@gmail.com', () => {
    const bom = ctx.apiGetBom('L01');
    jeq(bom.map(b => b.value), ['Belt conveyor 1200', 'SN-100 Sensor proximity M12', 'FU-10 Fuse 10A']);
    assert.strictEqual(bom[1].location, 'Rak A-01');
    assert.strictEqual(bom[1].minStock, '2');
    assert.strictEqual(bom[2].common, true);
    jeq(ctx.apiGetLine('L01').bom.map(b => b.pn), ['', 'SN-100', 'FU-10']);
  });
});

test('BOM: selesai menerima part BOM line ini, menolak BOM line lain', () => {
  as('budi@gmail.com', () => {
    const id = ctx.apiStart('L01', 'E22H').open.id;
    throwsMsg(() => ctx.apiComplete(id, { ...done, parts: [{ nama: 'MT-7 Motor 0.75kW', jumlah: 1 }] }), /BOM line L01/);
    assert.strictEqual(rec(id).Status, 'Aktif', 'ditolak tanpa mengubah record');
    ctx.apiComplete(id, { ...done, parts: [{ nama: 'SN-100 Sensor proximity M12', jumlah: 2 }, { nama: 'FU-10 Fuse 10A', jumlah: 1 }, { nama: 'Relay', jumlah: 1 }] });
    assert.strictEqual(rec(id).Part, 'SN-100 Sensor proximity M12 x2; FU-10 Fuse 10A x1; Relay x1');
  });
});

// ---------- 2.1: factory, sub-line, mesin, form editable, dashboard ----------
const setRow = (sheet, pred, col, val) => {
  const sh = ss.getSheetByName(sheet), h = sh.data[0];
  sh.data.find((r, i) => i > 0 && pred(r, h))[h.indexOf(col)] = val;
};

test('2.1 persiapan: sub-line A/B (Grup), mesin per line & per grup, line F1', () => {
  as('sari@gmail.com', () => {
    const open = ctx.apiBootstrap('').myOpen;
    if (open) ctx.apiCancel(open.id, 'Input ganda');
  });
  L.appendRow(['L05-A', 'Formation 5A', 'F1', '', 'L05', 'Hall D', 'Ya']);
  L.appendRow(['L05-B', 'Formation 5B', 'F1', '', 'L05', 'Hall D', '']);           // Aktif kosong = aktif
  L.appendRow(['L06', 'Packing', 'F1', 'Limo7', '', 'Hall D', 'Ya']);              // override baterai
  L.appendRow(['L07', 'Salah', 'F1', 'X99', '', '', 'Ya']);                       // baterai tidak terdaftar
  const M = ss.getSheetByName('Mesin');
  M.appendRow(['M-PRESS', 'Press', 'L05', 'Ya']);      // milik grup → dipakai L05-A & L05-B
  M.appendRow(['M-OVEN', 'Oven', 'L05-A', 'Ya']);
  M.appendRow(['M-OLD', 'Mesin lama', 'L05-A', 'Tidak']);
  as('budi@gmail.com', () => {
    jeq(ctx.apiGetLine('L05-A').machines.map(m => m.id), ['M-PRESS', 'M-OVEN']);
    jeq(ctx.apiGetLine('L05-B').machines.map(m => m.id), ['M-PRESS']);
    assert.ok(ctx.apiGetLine('L05-B').line.active);
  });
});

test('2.1 baterai per factory: F1 hanya VF7/Limo7, override per line, default baterai pertama', () => {
  as('budi@gmail.com', () => {
    const v = ctx.apiGetLine('L05-A');
    jeq(v.line.batteries, ['VF7', 'Limo7']);
    assert.strictEqual(v.lastBattery, 'VF7');
    jeq(ctx.apiGetLine('L06').line.batteries, ['Limo7']);
    throwsMsg(() => ctx.apiStart('L05-A', { baterai: 'E22H', mesin: 'M-OVEN' }), /tidak ada di daftar pilihan untuk line L05-A/);
    throwsMsg(() => ctx.apiStart('L06', 'VF7'), /tidak ada di daftar/);
  });
});

let MO;
test('2.1 lock per mesin: 2 teknisi di 2 mesin satu line; mesin sama diblok; mesin wajib jika line punya mesin', () => {
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L05-A', { baterai: 'VF7' }), /Mesin wajib dipilih/);
    throwsMsg(() => ctx.apiStart('L05-A', { baterai: 'VF7', mesin: 'M-OLD' }), /tidak terdaftar/);
    MO = ctx.apiStart('L05-A', { baterai: 'VF7', mesin: 'm-oven' }).open.id;
  });
  const r = rec(MO);
  assert.strictEqual(r['Mesin ID'], 'M-OVEN');
  assert.strictEqual(r['Nama Mesin'], 'Oven');
  assert.strictEqual(r.Factory, 'F1');
  assert.strictEqual(r.Tipe, 'Corrective', 'default tipe = pilihan pertama');
  as('andi@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L05-A', { baterai: 'VF7', mesin: 'M-OVEN' }), /Mesin Oven sedang dikerjakan Budi/);
    const v = ctx.apiStart('L05-A', { baterai: 'VF7', mesin: 'M-PRESS' });
    assert.ok(v.openIsMine);
    assert.strictEqual(v.machines.find(m => m.id === 'M-OVEN').busyBy, 'Budi');
    assert.strictEqual(v.others.length, 1);
  });
  // mesin yang sama di sub-line lain = mesin fisik lain → boleh
  as('sari@gmail.com', () => {
    const id = ctx.apiStart('L05-B', { baterai: 'Limo7', mesin: 'M-PRESS' }).open.id;
    ctx.apiCancel(id, 'Input ganda');
  });
});

test('2.1 mesin "Lainnya" → nama wajib diisi, disimpan "Lainnya: <nama>", tidak mengunci mesin lain', () => {
  as('sari@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L05-A', { baterai: 'VF7', mesin: 'Lainnya' }), /wajib diisi nama mesin/);
    const id = ctx.apiStart('L05-A', { baterai: 'VF7', mesin: 'Lainnya', mesinLain: 'Kompresor' }).open.id;
    assert.strictEqual(rec(id)['Nama Mesin'], 'Lainnya: Kompresor');
    ctx.apiCancel(id, { values: { 'Alasan cancel': 'Lainnya' }, other: { 'Alasan cancel': 'uji mesin lainnya' } });
    assert.strictEqual(rec(id)['Alasan cancel'], 'Lainnya: uji mesin lainnya');
  });
});

test('2.1 Pause "Lainnya" → keterangan wajib, tercatat di Log', () => {
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiPause(MO, { values: { 'Alasan pause': 'Lainnya' } }), /Lainnya.*keterangan/);
    ctx.apiPause(MO, { values: { 'Alasan pause': 'Lainnya' }, other: { 'Alasan pause': 'Sholat' } });
    ctx.apiResume(MO);
  });
  assert.match(ctx.readTable_('Log').filter(e => e['Maintenance ID'] === MO && e.Kejadian === 'pause')[0].Detail, /Lainnya: Sholat/);
});

test('2.1 Preventive tidak masuk MTTR, Corrective masuk', () => {
  advance(30);
  as('budi@gmail.com', () => ctx.apiComplete(MO, done));
  assert.strictEqual(rec(MO)['Masuk MTTR'], 'Ya');
  as('andi@gmail.com', () => {
    const id = ctx.apiBootstrap('').myOpen.id;
    ctx.apiComplete(id, sel('Mesin berhenti', { tanpaPart: true }));
    const p = ctx.apiStart('L06', { baterai: 'Limo7', tipe: 'Preventive' }).open.id;
    advance(20);
    ctx.apiComplete(p, sel('Hasil produk NG', { tanpaPart: true }));
    assert.strictEqual(rec(p).Tipe, 'Preventive');
    assert.strictEqual(rec(p)['Masuk MTTR'], 'Tidak');
    throwsMsg(() => ctx.apiStart('L06', { baterai: 'Limo7', tipe: 'Darurat' }), /Tipe maintenance "Darurat"/);
  });
});

test('2.1 form editable: label, field tambahan (kolom dibuat otomatis), Lainnya, field sistem tidak bisa dihapus', () => {
  const F = ss.getSheetByName('Form'), P = ss.getSheetByName('Pilihan');
  setRow('Form', (r, h) => r[h.indexOf('Form')] === 'Selesai' && r[h.indexOf('Field')] === 'Masalah', 'Label', 'Gejala');
  F.appendRow(['Selesai', 'Kondisi akhir', 'Kondisi akhir mesin', 'pilihan', 'Kondisi', 'Ya', 'Ya', 6, 'Ya']);
  F.appendRow(['Mulai', 'Shift', 'Shift', 'angka', '', 'Tidak', '', 9, 'Ya']);
  F.appendRow(['Selesai', 'Status', 'curang', 'teks', '', '', '', 9, 'Ya']);       // kolom sistem → ditolak
  F.appendRow(['Selesai', 'X', 'X', 'tanggal', '', '', '', 9, 'Ya']);            // tipe salah → ditolak
  setRow('Form', (r, h) => r[h.indexOf('Form')] === 'Selesai' && r[h.indexOf('Field')] === 'Part', 'Aktif', 'Tidak'); // locked → tetap aktif
  P.appendRow(['Kondisi', 'Normal', 1, 'Ya']);
  P.appendRow(['Kondisi', 'Perlu monitor', 2, 'Ya']);
  as('budi@gmail.com', () => {
    const forms = ctx.apiBootstrap('').master.forms;
    assert.strictEqual(forms.Selesai[0].label, 'Gejala');
    jeq(forms.Selesai.find(f => f.field === 'Kondisi akhir').options, ['Normal', 'Perlu monitor', 'Lainnya']);
    assert.ok(forms.Selesai.find(f => f.field === 'Part'), 'field sistem tetap ada');
    assert.ok(!forms.Selesai.find(f => f.field === 'Status'));
    const id = ctx.apiStart('L03', { baterai: 'E245', values: { Shift: '2' } }).open.id;
    assert.strictEqual(rec(id).Shift, 2, 'field tambahan Mulai tersimpan sebagai kolom baru');
    throwsMsg(() => ctx.apiComplete(id, sel('', { tanpaPart: true })), /Gejala wajib/);
    throwsMsg(() => ctx.apiComplete(id, sel('Kebocoran', { tanpaPart: true })), /Kondisi akhir mesin wajib/);
    const x = sel('Kebocoran', { tanpaPart: true });
    x.values['Kondisi akhir'] = 'Lainnya'; x.other['Kondisi akhir'] = 'bunyi halus';
    ctx.apiComplete(id, x);
    assert.strictEqual(rec(id)['Kondisi akhir'], 'Lainnya: bunyi halus');
    const d = ctx.apiGetDetail(id).record.extra;
    assert.ok(d.find(e => e.label === 'Kondisi akhir mesin' && e.value === 'Lainnya: bunyi halus'));
  });
  as('sari@gmail.com', () => {
    const w = ctx.apiDashboard({}).warnings.join('\n');
    assert.match(w, /"Status" adalah kolom sistem/);
    assert.match(w, /tipe "tanggal"/);
    assert.match(w, /baterai "X99" di line L07/);
  });
  // bersihkan supaya test berikut tidak terganggu
  setRow('Form', (r, h) => r[h.indexOf('Field')] === 'Kondisi akhir', 'Aktif', 'Tidak');
});

test('2.1 filter factory/baterai/line(grup)/cari di Pending, Review, Riwayat', () => {
  as('budi@gmail.com', () => {
    const id = ctx.apiStart('L05-B', { baterai: 'Limo7', mesin: 'M-PRESS' }).open.id;
    ctx.apiPending(id, pend('Cek oli press', 'Menunggu part', 'BESOK'));
    assert.ok(ctx.apiListPending({ factory: 'F1' }).items.every(i => i.factory === 'F1'));
    assert.strictEqual(ctx.apiListPending({ factory: 'F1' }).items.length, 1);
    assert.strictEqual(ctx.apiListPending({ line: 'L05' }).items[0].id, id, 'filter grup mencakup sub-line');
    assert.strictEqual(ctx.apiListPending({ baterai: 'VF7' }).items.length, 0);
    assert.strictEqual(ctx.apiListPending({ q: 'press' }).items.length, 1);
    assert.ok(ctx.apiListPending({ factory: 'F2' }).items.every(i => i.factory === 'F2'));
    assert.ok(ctx.apiListReview({ factory: 'F1' }).items.every(i => i.factory === 'F1'));
    assert.ok(ctx.apiHistory({ factory: 'F1', tipe: 'Corrective' }).items.every(i => i.factory === 'F1' && i.tipe === 'Corrective'));
  });
});

test('2.1 dashboard: MTTR corrective, top mesin/line/teknisi, Lainnya terbanyak, kartu project', () => {
  setRow('Projects', (r, h) => r[h.indexOf('Baterai')] === 'VF7', 'Fase', 'Trial');
  setRow('Projects', (r, h) => r[h.indexOf('Baterai')] === 'VF7', 'Target MTTR (menit)', 10);
  as('sari@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 30, factory: 'F1' });
    assert.strictEqual(d.kpi.preventive, 1);
    assert.ok(d.kpi.corrective >= 2);
    const rows = ctx.readTable_('Maintenance').filter(r => r.Factory === 'F1' && r['Masuk MTTR'] === 'Ya');
    near(d.kpi.mttr, rows.reduce((s, r) => s + Number(r['Total aktif (menit)']), 0) / rows.length);
    assert.ok(d.machines.find(m => m.key === 'Oven · L05-A' && m.count === 1));
    assert.ok(d.lines.find(l => l.key === 'L05-A'));
    assert.ok(d.techs.find(t => t.key === 'Budi'));
    assert.ok(d.others.find(o => o.key === 'Nama Mesin → kompresor') === undefined, 'cancel tidak dihitung');
    const vf7 = d.projects.find(p => p.battery === 'VF7');
    assert.strictEqual(vf7.fase, 'Trial');
    assert.strictEqual(vf7.health, 'over');
    assert.ok(d.projects.every(p => p.factory === 'F1'));
    assert.strictEqual(d.weeks.length, 12);
    assert.strictEqual(d.kpi.pendingNow, 1);
  });
});

test('2.1 QR mesin: ?mesin= disanitasi, mesin satu line → buka line + mesin terpilih; QR admin berisi mesin', () => {
  as('andi@gmail.com', () => {
    assert.strictEqual(ctx.doGet({ parameter: { line: 'L05-A', mesin: 'M-OVEN"<x>' } }).vars.mesinId, 'M-OVENx');
    const b = ctx.apiBootstrap('', 'M-OVEN');
    assert.strictEqual(b.lineView.line.id, 'L05-A');
    assert.strictEqual(b.lineView.preselectMesin, 'M-OVEN');
    assert.strictEqual(ctx.apiBootstrap('', 'M-PRESS').lineView, null, 'mesin milik grup 2 sub-line: butuh ?line=');
    assert.strictEqual(ctx.apiBootstrap('L05-B', 'M-PRESS').lineView.preselectMesin, 'M-PRESS');
    throwsMsg(() => ctx.apiListLinesForQr(), /tidak punya akses/);
  });
  as('sari@gmail.com', () => {
    const q = ctx.apiListLinesForQr();
    jeq(q.lines.find(l => l.id === 'L05-A').machines.map(m => m.id), ['M-PRESS', 'M-OVEN']);
  });
});

test('2.1 migrasi: setup() ulang menambah kolom & mengembalikan field sistem yang dihapus, data tetap', () => {
  const F = ss.getSheetByName('Form'), h = F.data[0];
  const before = ctx.readTable_('Maintenance').length;
  F.data = F.data.filter((r, i) => i === 0 || !(r[h.indexOf('Form')] === 'Pending' && r[h.indexOf('Field')] === 'Tenggat'));
  as('sari@gmail.com', () => assert.match(ctx.apiDashboard({}).warnings.join('\n'), /Pending.Tenggat" hilang/));
  ctx.setup();
  assert.ok(ctx.readTable_('Form').some(r => r.Form === 'Pending' && r.Field === 'Tenggat'));
  assert.strictEqual(ctx.readTable_('Maintenance').length, before);
  assert.ok(ss.getSheetByName('Maintenance').data[0].includes('Kondisi akhir'));
  assert.strictEqual(triggers.length, 1);
});

console.log('\n' + passed + ' test lulus' + (process.exitCode ? ', ADA YANG GAGAL' : ''));
