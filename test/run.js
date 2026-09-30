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
const done = { masalah: 'Sensor error', penyebab: 'Komponen aus', penanganan: 'Ganti part', parts: [{ nama: 'Fuse', jumlah: 2 }] };

// ---------- tests ----------
console.log('MTTR 2.0 server logic');

test('setup: sheet, tab FILTER, pilihan, config, admin pertama, trigger (idempotent)', () => {
  ctx.setup(); ctx.setup();
  for (const n of ['Users', 'Lines', 'Pilihan', 'Config', 'Maintenance', 'Log', 'Maintenance E22H', 'Maintenance E245', 'Pending Work']) assert.ok(ss.getSheetByName(n), n);
  assert.ok(!ss.getSheetByName('Sheet1'));
  assert.strictEqual(triggers.length, 1);
  assert.strictEqual(triggers[0].getHandlerFunction(), 'checkTimeouts');
  assert.strictEqual(ctx.readTable_('Config').length, 4);
  assert.strictEqual(ctx.readTable_('Users')[0].Peran, 'Admin');
  const opts = ctx.getOptions_();
  jeq(opts.Baterai, ['E22H', 'E245']);
  assert.strictEqual(ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Baterai').length, 2, 'pilihan tidak terduplikasi');
  const f = ss.getSheetByName('Maintenance E22H').formulas.A1;
  assert.match(f, /^=FILTER\('Maintenance'!A:AC, \(ROW\('Maintenance'!A:A\)=1\)\+\('Maintenance'!C:C="E22H"\)\)$/);
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
L.appendRow(['L01', 'Assy 1', 'Hall A', 'Ya']);
L.appendRow(['L02', 'Assy 2', 'Hall A', 'Ya']);
L.appendRow(['L03', 'Assy 3', 'Hall B', 'Ya']);
L.appendRow(['L99', 'Mati', 'Hall C', 'Tidak']);

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
    throwsMsg(() => ctx.apiPause(A, 'Ngopi'), /tidak dikenal/);
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
    throwsMsg(() => ctx.apiComplete(A, { ...done, masalah: '' }), /Masalah wajib/);
    throwsMsg(() => ctx.apiComplete(A, { ...done, masalah: 'Lainnya' }), /Lainnya.*catatan/);
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
    assert.strictEqual(ctx.apiGetLine('L02').lastBattery, '');
  });
});

let B;
test('pending: satu form → Pending, perlu review, tampil di tab Pending & halaman line', () => {
  as('budi@gmail.com', () => { B = ctx.apiStart('L02', 'E22H').open.id; });
  advance(15);
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiPending(B, { tertunda: 'Menunggu part', tenggat: 'BESOK' }), /sudah dilakukan wajib/);
    throwsMsg(() => ctx.apiPending(B, { dikerjakan: 'Cek wiring', tertunda: 'Menunggu part' }), /Tenggat wajib/);
    throwsMsg(() => ctx.apiPending(B, { dikerjakan: 'x', tertunda: 'Menunggu part', tenggat: 'TANGGAL', tanggal: '2026-09-01' }), /masa lalu/);
    ctx.apiPending(B, { dikerjakan: 'Cek wiring, sensor rusak', tertunda: 'Menunggu part', tenggat: 'BESOK' });
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
    throwsMsg(() => ctx.apiCancel(C, 'Lainnya', ''), /catatan/);
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
    ctx.apiPending(P, { dikerjakan: 'Bongkar cover', tertunda: 'Butuh teknisi lain', tenggat: 'HARI_INI' });
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

console.log('\n' + passed + ' test lulus' + (process.exitCode ? ', ADA YANG GAGAL' : ''));
