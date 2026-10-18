/**
 * Test lokal logika server (src/*.js) dengan mock Apps Script services + jam yang bisa dimajukan.
 * Jalankan: node test/run.js
 * Ini TIDAK menguji UI atau perilaku asli Google (izin, kuota, trigger, rumus FILTER) — hanya logika.
 */
'use strict';
const assert = require('assert');
const { ctx, ss, clock, advance, FakeDate, user, lock, triggers, mails, cache, ui } = require('./mock');

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
const jeq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.02, a + ' ≈ ' + b);
const sel = (masalah, extra) => ({ values: { 'Jenis kerusakan': 'Elektrikal', Masalah: masalah, Penyebab: 'Komponen aus', Penanganan: 'Ganti part' }, other: {}, ...extra });
const pid = (j, n, m) => ctx.partId_(j, n, m);
const FUSE = pid('Elektrikal', 'Fuse', '10A');
const done = sel('Sensor error', { parts: [{ id: FUSE, qty: 2 }] });
/** Baris sheet berdasarkan NAMA kolom (bukan posisi) — seperti aplikasi membaca sheet. */
const rowOf = (sheet, obj) => ctx.objToRow_(ss.getSheetByName(sheet).data[0].map(h => String(h).trim()), obj);
const lineRow = (a, extra) => rowOf('Lines', Object.assign({ 'Line ID': a[0], 'Nama Line': a[1], 'Factory ID': a[2], 'Baterai': a[3], 'Grup': a[4], 'Area': a[5], 'Aktif': a[6] }, extra || {}));
const pend = (dik, tertunda, tenggat, extra) => ({ values: { 'Pekerjaan dilakukan': dik, 'Yang tertunda': tertunda }, tenggat, ...extra });

// ---------- tests ----------
console.log('MTTR 2.2 server logic');

test('setup: sheet, tab FILTER, pilihan, config, admin pertama, trigger (idempotent)', () => {
  ctx.setup(); ctx.setup();
  for (const n of ['Users', 'Factory', 'Projects', 'Lines', 'Mesin', 'Sparepart', 'Pemakaian Sparepart', 'Format Laporan', 'Catatan Panduan', 'Pilihan', 'Form', 'Config', 'Maintenance', 'Log', 'Maintenance VF7', 'Maintenance Limo7', 'Maintenance E22H', 'Maintenance E245', 'Pending Work', 'Rekap 2026', 'Laporan 2026']) assert.ok(ss.getSheetByName(n), n);
  assert.ok(!ss.getSheetByName('Sheet1'));
  assert.ok(!ss.getSheetByName('BOM'), 'BOM tidak dibuat lagi');
  jeq(triggers.map(t => t.getHandlerFunction()).sort(), ['checkTimeouts', 'onMasterChange', 'refreshRekap'], 'trigger tidak dobel');
  assert.strictEqual(triggers.find(t => t.getHandlerFunction() === 'refreshRekap').every, 'hari:1@1', 'bangun ulang penuh tiap malam');
  assert.strictEqual(ctx.readTable_('Config').length, 9);
  assert.strictEqual(ctx.readTable_('Users')[0].Peran, 'Admin');
  jeq(ctx.readTable_('Projects').map(p => p['Factory ID'] + ':' + p.Baterai), ['F1:VF7', 'F1:Limo7', 'F2:E22H', 'F2:E245']);
  assert.strictEqual(ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Masalah').length, 5, 'pilihan tidak terduplikasi');
  assert.strictEqual(ctx.readTable_('Form').length, 20, 'form tidak terduplikasi');
  assert.strictEqual(ctx.readTable_('Sparepart').length, 11, 'katalog contoh sekali saja');
  assert.strictEqual(ctx.readTable_('Format Laporan').length, 22);
  jeq(ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Jenis Kerusakan').map(r => r.Nilai), ['Elektrikal', 'Mekanikal', 'Pneumatik', 'Program']);
  const f = ss.getSheetByName('Maintenance E22H').formulas.A1;
  assert.match(f, /^=FILTER\('Maintenance'!A:AP, \(ROW\('Maintenance'!A:A\)=1\)\+\('Maintenance'!C:C="E22H"\)\)$/);
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
L.appendRow(lineRow(['L01', 'Assy 1', 'F2', '', '', 'Hall A', 'Ya']));
L.appendRow(lineRow(['L02', 'Assy 2', 'F2', '', '', 'Hall A', 'Ya']));
L.appendRow(lineRow(['L03', 'Assy 3', 'F2', '', '', 'Hall B', 'Ya']));
L.appendRow(lineRow(['L99', 'Mati', 'F2', '', '', 'Hall C', 'Tidak']));

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
    throwsMsg(() => ctx.apiComplete(A, sel('', { parts: done.parts })), /masalah wajib/i);
    throwsMsg(() => ctx.apiComplete(A, sel('Lainnya', { parts: done.parts })), /Lainnya.*keterangan/);
    throwsMsg(() => ctx.apiComplete(A, { ...done, parts: [] }), /Tidak ada/);
    throwsMsg(() => ctx.apiComplete(A, { ...done, parts: [{ id: FUSE, qty: 0 }] }), /Jumlah "Fuse" harus/);
    const v = ctx.apiComplete(A, done);
    assert.strictEqual(v.open, null);
  });
  const r = rec(A);
  assert.strictEqual(r.Status, 'Completed');
  assert.strictEqual(r.Part, 'Fuse 10A ×2');
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
  assert.strictEqual(rec(B).Part, 'Tidak ada pergantian');
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

test('sparepart: katalog Jenis → Nama → Model dari sheet (model boleh kosong, nonaktif & duplikat dilewati)', () => {
  const SP = ss.getSheetByName('Sparepart');
  SP.appendRow(rowOf('Sparepart', { 'Jenis Sparepart': 'Mekanikal', 'Nama Sparepart': 'Bearing', 'Model': '6206-ZZ', 'Satuan': 'pcs', 'Aktif': 'Tidak' }));
  SP.appendRow(rowOf('Sparepart', { 'Jenis Sparepart': 'Mekanikal', 'Nama Sparepart': 'Bearing', 'Model': '6205-2RS' }));   // duplikat
  SP.appendRow(rowOf('Sparepart', { 'Jenis Sparepart': 'Hidrolik', 'Nama Sparepart': 'Seal', 'Model': '' }));             // jenis tak dikenal → peringatan
  SP.appendRow(rowOf('Sparepart', { 'Jenis Sparepart': '', 'Nama Sparepart': 'Kabel', 'Model': 'NYAF 1.5' }));          // kolom pertama kosong → tetap terbaca & diperingatkan
  as('budi@gmail.com', () => {
    const cat = ctx.apiBootstrap('', '', {}).master.spareparts;
    assert.ok(cat.some(p => p.nama === 'Bearing' && p.model === '6205-2RS'));
    assert.ok(!cat.some(p => p.model === '6206-ZZ'), 'nonaktif tidak tampil');
    assert.strictEqual(cat.filter(p => p.model === '6205-2RS').length, 1, 'duplikat diabaikan');
    assert.ok(cat.some(p => p.nama === 'Backup Program PLC' && p.model === ''), 'model kosong boleh');
  });
  as('sari@gmail.com', () => {
    const w = ctx.apiDashboard({}).warnings.join('\n');
    assert.match(w, /ditulis dua kali/);
    assert.match(w, /jenis "Hidrolik"/);
    assert.match(w, /"Kabel" belum diisi Jenis Sparepart \(baris \d+\)/);
  });
});

test('sparepart: banyak part + manual → kolom Part ditulis ke bawah, satu baris Pemakaian per part (nama PIC + email)', () => {
  as('budi@gmail.com', () => {
    const id = ctx.apiStart('L01', 'E22H').open.id;
    throwsMsg(() => ctx.apiComplete(id, { ...done, parts: [] }), /Pilih sparepart/);
    throwsMsg(() => ctx.apiComplete(id, { ...done, parts: [{ id: 'tidak|ada|ini', qty: 1 }] }), /tidak ditemukan di katalog/);
    throwsMsg(() => ctx.apiComplete(id, { ...done, parts: [{ manual: true, jenis: 'Mekanikal', nama: '', qty: 1 }] }), /nama sparepart wajib/);
    throwsMsg(() => ctx.apiComplete(id, { ...done, parts: [{ manual: true, jenis: 'Ngawur', nama: 'X', qty: 1 }] }), /pilih jenis sparepart/);
    advance(20);
    ctx.apiComplete(id, { ...done, parts: [
      { id: pid('Mekanikal', 'Bearing', '6205-2RS'), qty: 2 },
      { id: FUSE, qty: 1 },
      { id: pid('Mekanikal', 'Bearing', '6205-2RS'), qty: 1 },          // dipilih dua kali → digabung
      { manual: true, jenis: 'Pneumatik', nama: 'Fitting L', model: '8mm', qty: 4 }
    ] });
    const r = rec(id);
    assert.strictEqual(r.Part, 'Bearing 6205-2RS ×3\nFuse 10A ×1\nFitting L 8mm ×4 (manual)');
    assert.strictEqual(r['Nama PIC'], 'Budi');
    assert.strictEqual(r['Jenis kerusakan'], 'Elektrikal');
    const u = ctx.readTable_('Pemakaian Sparepart').filter(x => x['Maintenance ID'] === id);
    assert.strictEqual(u.length, 3);
    jeq(u.map(x => [x['Jenis Sparepart'], x['Nama Sparepart'], x.Model, x.Jumlah, x.Manual]),
      [['Mekanikal', 'Bearing', '6205-2RS', 3, 'Tidak'], ['Elektrikal', 'Fuse', '10A', 1, 'Tidak'], ['Pneumatik', 'Fitting L', '8mm', 4, 'Ya']]);
    assert.ok(u.every(x => x.PIC === 'Budi' && x['Email PIC'] === 'budi@gmail.com' && x.Line === 'L01'));
    assert.deepStrictEqual(ctx.apiGetDetail(id).record.parts.length, 3);
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
  L.appendRow(lineRow(['L05-A', 'Formation 5A', 'F1', '', 'L05', 'Hall D', 'Ya']));
  L.appendRow(lineRow(['L05-B', 'Formation 5B', 'F1', '', 'L05', 'Hall D', '']));           // Aktif kosong = aktif
  L.appendRow(lineRow(['L06', 'Packing', 'F1', 'Limo7', '', 'Hall D', 'Ya']));              // override baterai
  L.appendRow(lineRow(['L07', 'Salah', 'F1', 'X99', '', '', 'Ya']));                       // baterai tidak terdaftar
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
    assert.strictEqual(forms.Selesai.find(f => f.field === 'Masalah').label, 'Gejala');
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
  assert.strictEqual(triggers.length, 3);
});

// ---------- 2.2: stop line, laporan (format Excel), proses & alias, panduan, nama aplikasi ----------
U.appendRow(rowOf('Users', { Email: 'dewi@gmail.com', Nama: 'Dewi', Peran: 'Teknisi', Aktif: 'Ya' }));
L.appendRow(lineRow(['L10', 'Cell Retreatment 1', 'F2', '', '', 'Hall E', 'Ya'], { Alias: 'CR1, Retreat satu', Proses: 'Modul Line' }));
L.appendRow(lineRow(['L11', 'Cell Retreatment 2', 'F2', '', '', 'Hall E', 'Ya'], { Proses: 'Modul Line' }));
/** Tab Laporan tanpa kolom kunci tersembunyi (keys = Maintenance ID per baris). */
const lap = (y) => {
  const d = ss.getSheetByName('Laporan ' + y).data.filter((r, i) => i < 2 || r.some(v => v !== '' && v != null));
  const k = d[1].findIndex(h => /^ID sistem /.test(h));
  const cut = (r) => r.filter((_, i) => i !== k);
  return { title: cut(d[0]), head: cut(d[1]), rows: d.slice(2).map(cut), keys: d.slice(2).map(r => r[k]), keyCol: k };
};
const lapRow = (y, pred) => { const t = lap(y); return t.rows.map((r, j) => Object.assign({ _id: t.keys[j] }, Object.fromEntries(t.head.map((h, i) => [String(h).split('\n').pop(), r[i]])))).filter(pred); };
let J1, J2;

test('2.2 stop line: ditanya saat Mulai, default dari tipe (Corrective = Ya, Preventive = Tidak), nilai salah ditolak', () => {
  as('dewi@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L10', { baterai: 'E22H', stopLine: 'Mungkin' }), /Stop line harus/);
    let id = ctx.apiStart('L10', { baterai: 'E22H', tipe: 'Preventive' }).open.id;
    assert.strictEqual(rec(id)['Stop line'], 'Tidak');
    ctx.apiCancel(id, 'Input ganda');
    id = ctx.apiStart('L10', { baterai: 'E22H', tipe: 'Preventive', stopLine: 'Ya' }).open.id;
    assert.strictEqual(rec(id)['Stop line'], 'Ya', 'pilihan teknisi menang atas default');
    ctx.apiCancel(id, 'Input ganda');
    J1 = ctx.apiStart('L10', { baterai: 'E22H' }).open.id;
    const r = rec(J1);
    assert.strictEqual(r['Stop line'], 'Ya');
    assert.strictEqual(r.Proses, 'Modul Line');
    assert.strictEqual(r['Nama PIC'], 'Dewi');
  });
  jeq(as('dewi@gmail.com', () => ctx.apiBootstrap('').stopLineDefault), ['Corrective']);
});

test('2.2 Selesai: jenis kerusakan wajib, detail opsional tersimpan, banyak part', () => {
  as('dewi@gmail.com', () => {
    advance(30);
    const x = sel('Sensor error', { parts: [{ id: FUSE, qty: 1 }, { id: pid('Mekanikal', 'Bearing', '6205-2RS'), qty: 2 }] });
    delete x.values['Jenis kerusakan'];
    throwsMsg(() => ctx.apiComplete(J1, x), /jenis kerusakan wajib/i);
    x.values['Jenis kerusakan'] = 'Mekanikal';
    x.values['Detail masalah'] = 'Conveyor A stop';
    ctx.apiComplete(J1, x);
    const r = rec(J1);
    assert.strictEqual(r['Jenis kerusakan'], 'Mekanikal');
    assert.strictEqual(r['Detail masalah'], 'Conveyor A stop');
    assert.strictEqual(r['Detail penyebab'], '');
    assert.strictEqual(r['Nama teknisi terlibat'], 'Dewi');
    J2 = ctx.apiStart('L11', { baterai: 'E245', tipe: 'Preventive' }).open.id;
    advance(12);
    ctx.apiComplete(J2, sel('Kebocoran', { tanpaPart: true }));
  });
});

test('2.2 laporan: kolom & isi sama dengan Excel (stop line 1/0, durasi, part ke bawah, nama PIC), Cancelled tidak ikut', () => {
  ctx.buildLaporan_(2026);
  const t = lap(2026);
  assert.strictEqual(t.title[0], ctx.getConfig_('LAPORAN_JUDUL'));
  assert.match(t.title[0], /Form Stop Line Peralatan/);
  assert.strictEqual(t.keyCol, 21, 'kolom kunci di kanan tabel');
  assert.ok(ss.getSheetByName('Laporan 2026').hidden.has(22), 'kolom kunci disembunyikan');
  assert.strictEqual(t.head.length, 21, '21 kolom seperti Excel (Maintenance ID nonaktif)');
  assert.strictEqual(t.head[0], '序号\nNO');
  assert.strictEqual(t.head[20], '维修人员\nKaryawan Perbaikan');
  const all = ctx.readTable_('Maintenance').filter(r => r.Mulai.getTime() < Date.UTC(2027, 0, 1) && r.Status !== 'Cancelled');
  assert.strictEqual(t.rows.length, all.length, 'satu baris per pekerjaan, tanpa Cancelled');
  jeq(t.rows.map(r => r[0]), all.map((_, i) => i + 1), 'NO urut');
  const a = lapRow(2026, r => r.Station === 'Cell Retreatment 1')[0];
  assert.ok(a, 'Station = nama line jika tanpa mesin');
  assert.strictEqual(a['Pabrik yang bersangkutan'], 'F2');
  assert.strictEqual(a.Project, 'E22H');
  assert.strictEqual(a.Process, 'Modul Line');
  assert.ok(a.Tanggal instanceof FakeDate);
  assert.match(a['Waktu Perbaikan'], /^\d\d\.\d\d$/);
  assert.match(a['Waktu Selesai Perbaikan'], /^\d\d\.\d\d$/);
  assert.strictEqual(a['Apakah stop line (1-iya,0-tidak)'], 1);
  assert.strictEqual(a['Durasi Stop Line (menit)'], 30);
  assert.strictEqual(a['Jenis Kerusakan'], 'Mekanikal');
  assert.strictEqual(a['Fenomena Kerusakan'], 'Sensor error – Conveyor A stop');
  assert.strictEqual(a['Alasan Kerusakan'], 'Komponen aus');
  assert.strictEqual(a['Jenis Sparepart'], 'Elektrikal\nMekanikal', 'satu part per baris, bukan ;');
  assert.strictEqual(a['Nama Sparepart'], 'Fuse\nBearing');
  assert.strictEqual(a['Model Sparepart'], '10A\n6205-2RS');
  assert.strictEqual(a['Jumlah Sparepart'], '1\n2');
  assert.strictEqual(a['Kondisi Perbaikan'], 'Selesai');
  assert.strictEqual(a['Karyawan Perbaikan'], 'Dewi', 'nama, bukan email');
  const b = lapRow(2026, r => r.Station === 'Cell Retreatment 2')[0];
  assert.strictEqual(b['Apakah stop line (1-iya,0-tidak)'], 0);
  assert.strictEqual(b['Durasi Stop Line (menit)'], 0, 'tidak stop line → durasi 0');
  assert.strictEqual(b['Jenis Sparepart'], 'Tidak ada pergantian');
  assert.strictEqual(b['Nama Sparepart'], '');
  const one = lapRow(2026, r => r['Nama Sparepart'] === 'Fuse' && r['Model Sparepart'] === '10A')[0];
  assert.strictEqual(one['Jumlah Sparepart'], 2, 'satu part → jumlah tetap angka');
  const pend = lapRow(2026, r => r['Kondisi Perbaikan'] === 'Pending')[0];
  assert.ok(pend && pend['Waktu Selesai Perbaikan'] === '' && pend['Jenis Sparepart'] === '', 'Pending: belum ada jam selesai / part');
  ctx.buildLaporan_(2026);
  assert.strictEqual(lap(2026).rows.length, t.rows.length, 'dibuat ulang, tidak menumpuk');
});

test('2.2 Format Laporan bisa diedit: ganti judul kolom, aktifkan kolom, sumber salah = peringatan', () => {
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Project', 'Kolom', 'Baterai');
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Maintenance ID', 'Aktif', 'Ya');
  const F = ss.getSheetByName('Format Laporan');
  F.appendRow(rowOf('Format Laporan', { Kolom: 'Tipe', Sumber: 'Tipe', Urutan: 2.5, Aktif: 'Ya' }));        // nama kolom Maintenance
  F.appendRow(rowOf('Format Laporan', { Kolom: 'Ngawur', Sumber: 'Kolom tidak ada', Urutan: 99, Aktif: 'Ya' }));
  ctx.resetMaster_();          // eksekusi baru (di Apps Script setiap trigger/menu = eksekusi baru)
  ctx.buildLaporan_(2026);
  const h = lap(2026).head;
  assert.ok(h.includes('Baterai') && !h.includes('Project'));
  assert.strictEqual(h[h.length - 2], 'Maintenance ID');
  assert.strictEqual(h[h.length - 1], 'Ngawur');
  assert.strictEqual(h[2], 'Tipe', 'urutan mengikuti kolom Urutan');
  const r = lapRow(2026, x => x['Maintenance ID'] === J2)[0];
  assert.strictEqual(r.Tipe, 'Preventive');
  assert.strictEqual(r.Ngawur, '', 'sumber tidak dikenal → kolom kosong, laporan tetap jadi');
  as('sari@gmail.com', () => assert.match(ctx.apiDashboard({}).warnings.join('\n'), /Kolom tidak ada/));
  F.data = F.data.filter(x => x[0] !== 'Tipe' && x[0] !== 'Ngawur');
  setRow('Format Laporan', (r, hh) => r[hh.indexOf('Sumber')] === 'Project', 'Kolom', 'Project');
  setRow('Format Laporan', (r, hh) => r[hh.indexOf('Sumber')] === 'Maintenance ID', 'Aktif', 'Tidak');
});

test('2.2 tombol "Perbarui Laporan & Rekap": hanya admin', () => {
  as('dewi@gmail.com', () => throwsMsg(() => ctx.apiBuildReports(), /tidak punya akses/));
  as('sari@gmail.com', () => {
    const out = ctx.apiBuildReports();
    assert.strictEqual(out.laporan, 'Laporan 2026');
    assert.strictEqual(out.rekap, 'Rekap 2026');
    assert.ok(out.rows >= 2);
  });
});

test('2.2 proses & alias: cari line lewat alias, filter proses, Line ID tidak berubah; dashboard jenis & sparepart', () => {
  as('dewi@gmail.com', () => {
    const l10 = ctx.apiBootstrap('').master.lines.find(l => l.id === 'L10');
    assert.strictEqual(l10.alias, 'CR1, Retreat satu');
    assert.strictEqual(l10.proses, 'Modul Line');
    const byAlias = ctx.apiHistory({ q: 'retreat satu' }).items;
    assert.ok(byAlias.length >= 1 && byAlias.every(i => i.line === 'L10'));
    jeq([...new Set(ctx.apiHistory({ proses: 'Modul Line' }).items.map(i => i.line))].sort(), ['L10', 'L11']);
    assert.strictEqual(ctx.apiGetLine('L10').line.proses, 'Modul Line');
    assert.strictEqual(ctx.apiGetDetail(J1).record.proses, 'Modul Line');
  });
  as('sari@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 30, proses: 'Modul Line' });
    assert.strictEqual(d.kpi.corrective + d.kpi.preventive, 2);
    jeq(d.jenis.map(j => j.key).sort(), ['Elektrikal', 'Mekanikal']);
    const fuse = d.parts.find(p => p.key === 'Fuse 10A');
    assert.ok(fuse && fuse.qty === 1 && fuse.jenis === 'Elektrikal');
    assert.ok(ctx.apiListLinesForQr().lines.find(l => l.id === 'L10').proses === 'Modul Line');
  });
});

test('2.2 nama aplikasi per lokasi + catatan panduan per peran (admin lihat semua)', () => {
  setRow('Config', (r, h) => r[h.indexOf('Key')] === 'NAMA_APLIKASI', 'Value', 'MTTR Cikarang');
  const N = ss.getSheetByName('Catatan Panduan');
  N.appendRow(rowOf('Catatan Panduan', { Untuk: 'Teknisi', Judul: 'Kunci panel', Isi: 'Ambil di pos security', Urutan: 2, Aktif: 'Ya' }));
  N.appendRow(rowOf('Catatan Panduan', { Untuk: 'Admin', Judul: 'Backup bulanan', Isi: 'File → Make a copy', Urutan: 3, Aktif: 'Ya' }));
  N.appendRow(rowOf('Catatan Panduan', { Untuk: '', Judul: 'Kontak', Isi: 'WA grup maintenance', Urutan: 1, Aktif: 'Ya' }));
  N.appendRow(rowOf('Catatan Panduan', { Untuk: 'Semua', Judul: 'Lama', Isi: 'x', Urutan: 4, Aktif: 'Tidak' }));
  as('dewi@gmail.com', () => {
    const b = ctx.apiBootstrap('');
    assert.strictEqual(b.master.appName, 'MTTR Cikarang');
    assert.strictEqual(b.master.version, ctx.APP.VERSION);
    jeq(b.notes.map(n => n.judul), ['Kontak', 'Kunci panel']);
    assert.strictEqual(ctx.doGet({ parameter: {} }).title, 'MTTR Cikarang');
  });
  as('sari@gmail.com', () => jeq(ctx.apiBootstrap('').notes.map(n => n.judul), ['Kontak', 'Kunci panel', 'Backup bulanan']));
  ui.menus.length = 0; ctx.onOpen();
  assert.strictEqual(ui.menus[0], 'MTTR Cikarang');
  ctx.buildRekap_(2026);
  assert.strictEqual(ss.getSheetByName('Rekap 2026').data[0][0], 'Rekap MTTR Cikarang 2026');
  setRow('Config', (r, h) => r[h.indexOf('Key')] === 'NAMA_APLIKASI', 'Value', '');
  as('dewi@gmail.com', () => assert.strictEqual(ctx.apiBootstrap('').master.appName, 'MTTR', 'kosong → default'));
  setRow('Config', (r, h) => r[h.indexOf('Key')] === 'NAMA_APLIKASI', 'Value', 'MTTR');
});

test('2.2 migrasi dari 2.1: setup() menambah baris Form baru (stop line, jenis kerusakan, detail); Aktif = Tidak mematikan pertanyaan stop line', () => {
  const F = ss.getSheetByName('Form'), h = F.data[0];
  const key = (r) => r[h.indexOf('Form')] + '.' + r[h.indexOf('Field')];
  F.data = F.data.filter((r, i) => i === 0 || !ctx.APP.FORM_MIGRATE.includes(key(r)));
  ctx.setup();
  jeq(ctx.APP.FORM_MIGRATE.filter(k => !F.data.some(r => key(r) === k)), [], 'semua baris 2.2 kembali');
  ctx.setup();
  assert.strictEqual(F.data.filter(r => key(r) === 'Mulai.Stop line').length, 1, 'tidak dobel');
  setRow('Form', (r) => key(r) === 'Mulai.Stop line', 'Aktif', 'Tidak');
  as('dewi@gmail.com', () => {
    const id = ctx.apiStart('L11', { baterai: 'E245', stopLine: 'Ya' }).open.id;
    assert.strictEqual(rec(id)['Stop line'], '', 'pertanyaan dimatikan → kosong');
    ctx.apiCancel(id, 'Input ganda');
  });
  setRow('Form', (r) => key(r) === 'Mulai.Stop line', 'Aktif', 'Ya');
});

test('2.2.2 upgrade: setup mengganti trigger tiap jam (2.2.1) dengan bangun ulang penuh tiap malam, tidak dobel', () => {
  triggers.find(t => t.getHandlerFunction() === 'refreshRekap').every = 'jam:1';   // seperti dipasang 2.2.1
  ctx.setup();
  const r = triggers.filter(t => t.getHandlerFunction() === 'refreshRekap');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].every, 'hari:1@1');
  assert.strictEqual(triggers.length, 3);
});

U.appendRow(rowOf('Users', { Email: 'eko@gmail.com', Nama: 'Eko', Peran: 'Teknisi', Aktif: 'Ya' }));
const rekapDone = () => ss.getSheetByName('Rekap 2026').data[16][1];   // baris Total, kolom "Pekerjaan selesai"
const rowById = (id) => lapRow(2026, r => r._id === id)[0];

test('2.2.2 langsung: Mulai/Pause/Selesai/Cancel memperbarui Laporan & Rekap tanpa bangun ulang penuh, hasil = bangun ulang penuh', () => {
  as('sari@gmail.com', () => ctx.apiBuildReports());
  const origL = ctx.buildLaporan_, origR = ctx.buildRekap_;
  let full = 0, live;
  ctx.buildLaporan_ = function () { full++; return origL.apply(this, arguments); };
  ctx.buildRekap_ = function () { full++; return origR.apply(this, arguments); };
  try {
    const before = lap(2026).rows.length, doneBefore = rekapDone();
    let id, c1, c2;
    as('dewi@gmail.com', () => { id = ctx.apiStart('L10', { baterai: 'E22H' }).open.id; });
    assert.strictEqual(lap(2026).rows.length, before + 1, 'Mulai → baris baru langsung ada');
    assert.strictEqual(rowById(id)['Kondisi Perbaikan'], 'Dikerjakan');
    assert.strictEqual(rowById(id).NO, before + 1);
    advance(5);
    as('dewi@gmail.com', () => ctx.apiPause(id, { values: { 'Alasan pause': 'Istirahat' } }));
    assert.strictEqual(rowById(id)['Kondisi Perbaikan'], 'Pause');
    as('dewi@gmail.com', () => ctx.apiResume(id));
    advance(20);
    as('dewi@gmail.com', () => ctx.apiComplete(id, sel('Sensor error', { parts: [{ id: FUSE, qty: 3 }, { manual: true, jenis: 'Pneumatik', nama: 'Fitting L', qty: 1 }] })));
    const a = rowById(id);
    assert.strictEqual(a['Kondisi Perbaikan'], 'Selesai');
    assert.strictEqual(a['Nama Sparepart'], 'Fuse\nFitting L');
    assert.strictEqual(a['Jumlah Sparepart'], '3\n1');
    assert.strictEqual(rekapDone(), doneBefore + 1, 'Rekap langsung bertambah');
    // Cancel di tengah → barisnya hilang, NO diurutkan ulang
    as('eko@gmail.com', () => { c1 = ctx.apiStart('L10', { baterai: 'E22H' }).open.id; });
    as('dewi@gmail.com', () => { c2 = ctx.apiStart('L11', { baterai: 'E245' }).open.id; });
    assert.ok(rowById(c1) && rowById(c2));
    as('eko@gmail.com', () => ctx.apiCancel(c1, 'Input ganda'));
    assert.ok(!rowById(c1), 'Cancelled tidak di laporan');
    const t = lap(2026);
    jeq(t.rows.map(r => r[0]), t.rows.map((_, i) => i + 1), 'NO tetap urut');
    as('dewi@gmail.com', () => ctx.apiCancel(c2, 'Input ganda'));
    assert.strictEqual(full, 0, 'tidak ada bangun ulang penuh selama aksi biasa');
    live = lap(2026).rows;
  } finally {
    ctx.buildLaporan_ = origL; ctx.buildRekap_ = origR;
  }
  ctx.resetMaster_(); ctx.buildLaporan_(2026);
  jeq(lap(2026).rows, live, 'hasil sinkron langsung sama dengan bangun ulang penuh');
});

test('2.2.2 langsung: Format Laporan diubah → aksi berikutnya membangun ulang dengan format baru; LAPORAN_LANGSUNG = Tidak → tab tidak disentuh', () => {
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Project', 'Kolom', '项目\nProject');
  let id;
  as('eko@gmail.com', () => { id = ctx.apiStart('L10', { baterai: 'E22H' }).open.id; });
  assert.strictEqual(lap(2026).head[2], '项目\nProject');
  assert.ok(rowById(id));
  as('eko@gmail.com', () => ctx.apiCancel(id, 'Input ganda'));
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Project', 'Kolom', 'Project');
  setRow('Config', (r, h) => r[h.indexOf('Key')] === 'LAPORAN_LANGSUNG', 'Value', 'Tidak');
  as('sari@gmail.com', () => ctx.apiBuildReports());
  const n = lap(2026).rows.length;
  as('eko@gmail.com', () => { id = ctx.apiStart('L10', { baterai: 'E22H' }).open.id; });
  assert.strictEqual(lap(2026).rows.length, n, 'dimatikan → hanya lewat tombol / malam');
  as('eko@gmail.com', () => ctx.apiCancel(id, 'Input ganda'));
  setRow('Config', (r, h) => r[h.indexOf('Key')] === 'LAPORAN_LANGSUNG', 'Value', 'Ya');
});

// ---------- Rekap tahunan & arsip ----------
const rekapRows = (y) => ss.getSheetByName('Rekap ' + y).data.slice(3, 17).map(r => r.slice());
const finalOf = (r) => r.Status === 'Completed' ? r.Selesai : (['Cancelled', 'Abandoned'].includes(r.Status) ? r['Status sejak'] : null);
const wibMonth = (d) => new Date(d.getTime() + 7 * 3600e3).getUTCMonth();

test('rekap: tab "Rekap 2026" 12 bulan + total, MTTR tertimbang, bulan = bulan selesai', () => {
  ctx.buildRekap_(2026);
  const rows = rekapRows(2026);
  assert.strictEqual(rows[0][0], 'Bulan');
  jeq(rows.slice(1, 13).map(r => r[0]), ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']);
  const all = ctx.readTable_('Maintenance').filter(r => finalOf(r) instanceof Date);
  const done = all.filter(r => r.Status === 'Completed');
  const counted = all.filter(r => r['Masuk MTTR'] === 'Ya');
  const tot = rows[13];
  assert.strictEqual(tot[0], 'Total 2026');
  assert.strictEqual(tot[1], done.length, 'pekerjaan selesai');
  assert.strictEqual(tot[2] + tot[3], done.length, 'corrective + preventive = selesai');
  assert.strictEqual(tot[3], done.filter(r => r.Tipe === 'Preventive').length);
  near(tot[4], counted.reduce((a, r) => a + Number(r['Total aktif (menit)']), 0) / counted.length);
  assert.strictEqual(tot[8], all.filter(r => r.Status === 'Cancelled').length);
  assert.strictEqual(tot[9], all.filter(r => r.Status === 'Abandoned').length);
  assert.strictEqual(tot[10], all.filter(r => r.Status === 'Abandoned' && r['Masuk MTTR'] === 'Ya').length);
  for (let m = 0; m < 12; m++) {
    assert.strictEqual(rows[1 + m][1], done.filter(r => wibMonth(r.Selesai) === m).length, 'bulan ' + (m + 1));
  }
  assert.strictEqual(rows[1][4], '', 'bulan tanpa data: MTTR kosong, bukan 0');
  // jalankan ulang = hasil sama (tidak menumpuk)
  ctx.buildRekap_(2026);
  jeq(rekapRows(2026), rows);
});

test('dashboard "Tahun ini" = 1 Januari s/d sekarang, sama dengan rekap', () => {
  as('sari@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 'ytd' });
    assert.strictEqual(d.periode, 'ytd');
    near(d.kpi.mttr, rekapRows(2026)[13][4]);
  });
});

let archived, keepPending;
test('arsip: tahun berjalan ditolak; Februari tahun berikutnya Dashboard mengingatkan', () => {
  throwsMsg(() => ctx.arsipkanTahun_(2026), /tahun yang sudah lewat/);
  clock.now = Date.UTC(2027, 1, 2, 2, 0, 0); // 2 Feb 2027 09:00 WIB
  as('sari@gmail.com', () => {
    const w = ctx.apiDashboard({}).warnings.join('\n');
    assert.match(w, /pekerjaan tahun 2026 belum diarsipkan/);
  });
  as('budi@gmail.com', () => { const id = ctx.apiStart('L01', 'E22H').open.id; advance(15); ctx.apiComplete(id, sel('Kebocoran', { tanpaPart: true })); });
  archived = ctx.readTable_('Maintenance').filter(r => ctx.isArchivable_(r, 2026)).map(r => r['Maintenance ID']);
  keepPending = ctx.readTable_('Maintenance').filter(r => r.Status === 'Pending').map(r => r['Maintenance ID']);
  assert.ok(archived.length >= 5 && keepPending.length >= 1, archived.length + ' / ' + keepPending.length);
});

test('arsip: pindah pekerjaan final 2026 + Log-nya; yang Pending/menunggu review tetap; rekap tidak berubah', () => {
  const before = rekapRows(2026);
  const mBefore = ctx.readTable_('Maintenance').length, lBefore = ctx.readTable_('Log').length;
  const usageArchived = ctx.readTable_('Pemakaian Sparepart').filter(u => archived.includes(u['Maintenance ID'])).length;
  assert.ok(usageArchived >= 5, 'ada pemakaian sparepart yang ikut diarsip: ' + usageArchived);
  const out = ctx.arsipkanTahun_(2026);
  const lapBefore = lap(2026).rows;
  assert.strictEqual(out.maintenance, archived.length);
  assert.strictEqual(out.sparepart, usageArchived);
  assert.strictEqual(ctx.readTable_('Arsip Sparepart 2026').length, usageArchived);
  assert.ok(ctx.readTable_('Pemakaian Sparepart').every(u => !archived.includes(u['Maintenance ID'])));
  ctx.resetMaster_(); ctx.buildLaporan_(2026);
  jeq(lap(2026).rows, lapBefore, 'laporan 2026 sama setelah arsip (data diambil dari tab Arsip)');
  const m = ctx.readTable_('Maintenance');
  assert.strictEqual(m.length, mBefore - archived.length);
  assert.ok(m.every(r => !archived.includes(r['Maintenance ID'])));
  assert.ok(keepPending.every(id => m.some(r => r['Maintenance ID'] === id)), 'pending tetap di tab aktif');
  assert.ok(m.some(r => r['Status review'] === 'Perlu review'), 'yang menunggu review tetap');
  assert.ok(m.some(r => r.Mulai.getTime() >= Date.UTC(2027, 0, 1)), 'data 2027 tidak tersentuh');
  jeq(ctx.readTable_('Arsip 2026').map(r => r['Maintenance ID']).sort(), archived.slice().sort());
  const logA = ctx.readTable_('Arsip Log 2026');
  assert.strictEqual(logA.length, out.log);
  assert.strictEqual(ctx.readTable_('Log').length, lBefore - out.log);
  assert.ok(ctx.readTable_('Log').every(e => !archived.includes(e['Maintenance ID'])));
  assert.ok(logA.every(e => e.Timestamp instanceof FakeDate), 'tanggal tetap tanggal');
  jeq(rekapRows(2026), before, 'rekap 2026 sama sebelum & sesudah arsip');
  assert.strictEqual(ctx.arsipkanTahun_(2026).maintenance, 0, 'jalankan ulang: tidak ada yang dobel');
  assert.strictEqual(ctx.readTable_('Arsip 2026').length, archived.length);
});

test('arsip: aplikasi tetap jalan; arsip tidak tampil di Riwayat; peringatan hilang', () => {
  as('sari@gmail.com', () => {
    assert.ok(!ctx.apiDashboard({}).warnings.some(w => /belum diarsipkan/.test(w)));
    assert.strictEqual(ctx.apiHistory({ scope: 'all' }).total, ctx.readTable_('Maintenance').length);
    throwsMsg(() => ctx.apiGetDetail(archived[0]), /tidak ditemukan/);
  });
  as('andi@gmail.com', () => {
    const p = ctx.readTable_('Maintenance').find(r => r.Status === 'Pending');
    const v = ctx.apiContinue(p['Maintenance ID'], p.Line);
    assert.strictEqual(v.open.status, 'Aktif', 'pending dari 2026 bisa dilanjutkan di 2027');
    advance(10);
    ctx.apiComplete(p['Maintenance ID'], sel('Kebocoran', { tanpaPart: true }));
  });
  ctx.refreshRekap();
  assert.ok(ss.getSheetByName('Rekap 2027'));
  assert.strictEqual(rekapRows(2027)[13][1], 2, 'rekap 2027: 2 pekerjaan selesai (bulan Februari)');
  assert.strictEqual(rekapRows(2027)[2][1], 2);
});

// ---------- Kecepatan: cache master & data awal di halaman ----------
test('cache master: request kedua tidak membaca sheet master; edit manual (onEdit/onChange) langsung menghapus cache', () => {
  cache.enabled = true; cache.store = {}; cache.puts = 0;
  const Lsh = ss.getSheetByName('Lines');
  let linesReads = 0;
  const orig = Lsh.getDataRange.bind(Lsh);
  Lsh.getDataRange = () => { linesReads++; return orig(); };
  try {
    as('budi@gmail.com', () => ctx.apiBootstrap('', '', {}));
    assert.strictEqual(cache.puts, 1, 'request pertama mengisi cache');
    const r1 = linesReads;
    as('budi@gmail.com', () => ctx.apiBootstrap('', '', {}));
    as('andi@gmail.com', () => ctx.apiListPending({}));
    assert.strictEqual(linesReads, r1, 'request berikutnya (user lain juga) tidak membaca sheet Lines');
    // edit manual tanpa trigger → masih data lama (bukti cache dipakai)
    Lsh.appendRow(['L77', 'Line baru', 'F1', '', '', '', 'Ya']);
    as('budi@gmail.com', () => assert.ok(!ctx.apiBootstrap('', '', {}).master.lines.some(l => l.id === 'L77')));
    // edit di sheet Maintenance tidak menghapus cache master
    ctx.onEdit({ range: ss.getSheetByName('Maintenance').getRange(2, 1) });
    as('budi@gmail.com', () => assert.ok(!ctx.apiBootstrap('', '', {}).master.lines.some(l => l.id === 'L77')));
    // onEdit di sheet master → langsung terlihat
    ctx.onEdit({ range: Lsh.getRange(Lsh.getLastRow(), 1) });
    as('budi@gmail.com', () => assert.ok(ctx.apiBootstrap('', '', {}).master.lines.some(l => l.id === 'L77')));
    // hapus baris (onChange) → juga langsung terlihat
    Lsh.data = Lsh.data.filter(r => r[0] !== 'L77');
    ctx.onMasterChange();
    as('budi@gmail.com', () => assert.ok(!ctx.apiBootstrap('', '', {}).master.lines.some(l => l.id === 'L77')));
  } finally {
    Lsh.getDataRange = orig;
  }
});

test('cache master: user dinonaktifkan → langsung ditolak setelah edit', () => {
  as('andi@gmail.com', () => ctx.apiBootstrap('', '', {}));
  setRow('Users', (r, h) => String(r[h.indexOf('Email')]).trim().toLowerCase() === 'andi@gmail.com', 'Aktif', 'Tidak');
  ctx.onEdit({ range: ss.getSheetByName('Users').getRange(2, 1) });
  as('andi@gmail.com', () => throwsMsg(() => ctx.apiBootstrap('', '', {}), /ACCESS_DENIED/));
  setRow('Users', (r, h) => String(r[h.indexOf('Email')]).trim().toLowerCase() === 'andi@gmail.com', 'Aktif', 'ya');
  ctx.onEdit({ range: ss.getSheetByName('Users').getRange(2, 1) });
  as('andi@gmail.com', () => assert.strictEqual(ctx.apiBootstrap('', '', {}).user.role, 'Teknisi'));
});

test('cache master: katalog sparepart besar dipecah ke beberapa potongan cache dan tetap utuh', () => {
  const B = ss.getSheetByName('Sparepart');
  for (let i = 0; i < 400; i++) B.appendRow(rowOf('Sparepart', { 'Jenis Sparepart': 'Mekanikal', 'Nama Sparepart': 'Part panjang ' + i + ' '.repeat(40), 'Model': 'PN-' + i, 'Satuan': 'pcs' }));
  ctx.onMasterChange();
  as('budi@gmail.com', () => ctx.apiBootstrap('', '', {}));
  const n = Number(Object.keys(cache.store).filter(k => /:n$/.test(k)).map(k => cache.store[k])[0]);
  assert.ok(n >= 2, 'potongan cache: ' + n);
  as('budi@gmail.com', () => assert.ok(ctx.apiBootstrap('', '', {}).master.spareparts.length >= 400));
  B.data = B.data.filter(r => !/^PN-\d+$/.test(r[2]));
  ctx.onMasterChange();
  cache.enabled = false;
});

test('doGet menanam data awal di halaman (aman dari </script>), tanpa panggilan kedua', () => {
  setRow('Lines', (r) => r[0] === 'L02', 'Nama Line', 'Assy </script><b>2');
  as('budi@gmail.com', () => {
    const page = ctx.doGet({ parameter: { line: 'L02' } });
    assert.ok(!/<\/script/i.test(page.vars.boot), 'tidak bisa menutup tag script');
    const boot = JSON.parse(page.vars.boot);
    assert.strictEqual(boot.user.email, 'budi@gmail.com');
    assert.strictEqual(boot.lineView.line.id, 'L02');
    assert.strictEqual(boot.lineView.line.name, 'Assy </script><b>2');
  });
  as('asing@gmail.com', () => assert.strictEqual(ctx.doGet({ parameter: {} }).template, 'Message'));
  setRow('Lines', (r) => r[0] === 'L02', 'Nama Line', 'Assy 2');
});

test('file Message belum dibuat / setup belum dijalankan → pesan asli tetap tampil, bukan error file', () => {
  const H = ctx.HtmlService, orig = H.createTemplateFromFile;
  H.createTemplateFromFile = (n) => { if (n === 'Message') throw new Error('No HTML file named Message was found.'); return orig.call(H, n); };
  const Us = ss.getSheetByName('Users');
  try {
    as('asing@gmail.com', () => {
      const out = ctx.doGet({ parameter: {} });
      assert.match(out.html, /tidak terdaftar/);
      assert.match(out.html, /file HTML <b>Message<\/b>/);
    });
    ss.sheets = ss.sheets.filter(x => x !== Us);         // seperti spreadsheet baru yang belum di-setup
    as('budi@gmail.com', () => {
      const out = ctx.doGet({ parameter: {} });
      assert.match(out.html, /Konfigurasi belum lengkap/);
      assert.match(out.html, /Sheet &quot;Users&quot; tidak ditemukan\. Admin perlu menjalankan setup\(\)/);
    });
  } finally {
    H.createTemplateFromFile = orig;
    if (!ss.getSheetByName('Users')) ss.sheets.push(Us);
  }
  as('budi@gmail.com', () => assert.strictEqual(ctx.doGet({ parameter: {} }).template, 'Index'));
});

test('setup: file proyek yang belum dibuat disebut namanya (bukan "currentEmail_ is not defined")', () => {
  assert.strictEqual(ctx.cekFile(), ctx.APP.VERSION);
  const H = ctx.HtmlService, origH = H.createHtmlOutputFromFile, origAuth = ctx.currentEmail_;
  H.createHtmlOutputFromFile = (n) => { if (n === 'Message') throw new Error('No HTML file named Message was found.'); return origH.call(H, n); };
  ctx.currentEmail_ = undefined;                            // seperti file Auth tidak ada
  try {
    throwsMsg(() => ctx.setup(), /File belum lengkap di Apps Script: Auth \(script\), Message \(HTML\)\. Buat file/);
  } finally {
    H.createHtmlOutputFromFile = origH;
    ctx.currentEmail_ = origAuth;
  }
  assert.strictEqual(ctx.cekFile(), ctx.APP.VERSION);
});

test('deploy versi baru saat HP masih membuka versi lama: refresh memberi tahu (tanpa mengubah data)', () => {
  as('budi@gmail.com', () => {
    const same = ctx.apiRefresh({}, ctx.APP.VERSION);
    assert.strictEqual(same.updated, undefined);
    const old = ctx.apiRefresh({}, '2.1.1');
    assert.strictEqual(old.updated, ctx.APP.VERSION);
    assert.match(old.appUrl, /\/exec$/);
    assert.strictEqual(ctx.apiRefresh({}).updated, undefined, 'klien lama tanpa versi: tidak diganggu');
  });
});

// ---------- Paling akhir: menghapus data ----------
test('hapus data testing: sebelum tanggal → pekerjaan + Log + sparepart (juga arsip) terhapus, laporan & rekap dibuat ulang, master utuh', () => {
  throwsMsg(() => ctx.parseTanggalWib_('2027-02-01'), /dd\/mm\/yyyy/);
  throwsMsg(() => ctx.parseTanggalWib_('31/02/2027'), /tidak valid/);
  assert.strictEqual(ctx.parseTanggalWib_(''), null);
  const cut = ctx.parseTanggalWib_('01/02/2027');
  assert.strictEqual(cut.getTime(), Date.UTC(2027, 0, 31, 17, 0, 0), '00:00 WIB');
  const master = ['Users', 'Lines', 'Mesin', 'Sparepart', 'Pilihan', 'Form', 'Config'].map(n => [n, ctx.readTable_(n).length]);
  const old = ctx.readTable_('Maintenance').concat(ctx.readTable_('Arsip 2026')).filter(r => r.Mulai < cut).map(r => r['Maintenance ID']);
  const plan = ctx.testDataPlan_(cut).counts;
  assert.strictEqual(plan.maintenance, old.length);
  assert.ok(plan.log > 0 && plan.sparepart > 0);
  const out = ctx.hapusDataTesting_(cut);
  jeq(out, plan);
  const m = ctx.readTable_('Maintenance');
  assert.ok(m.length >= 1 && m.every(r => r.Mulai >= cut), 'yang dimulai sejak tanggal itu tetap ada');
  const live = new Set(m.map(r => r['Maintenance ID']));
  assert.ok(ctx.readTable_('Log').every(e => live.has(e['Maintenance ID'])), 'Log tanpa pekerjaan yang dihapus');
  assert.ok(ctx.readTable_('Pemakaian Sparepart').every(u => live.has(u['Maintenance ID'])));
  for (const n of ['Arsip 2026', 'Arsip Log 2026', 'Arsip Sparepart 2026', 'Laporan 2026', 'Rekap 2026']) assert.strictEqual(ss.getSheetByName(n), null, n + ' dihapus (kosong)');
  assert.strictEqual(lap(2027).rows.length, m.filter(r => r.Status !== 'Cancelled').length);
  jeq(['Users', 'Lines', 'Mesin', 'Sparepart', 'Pilihan', 'Form', 'Config'].map(n => [n, ctx.readTable_(n).length]), master, 'sheet master tidak disentuh');
  // semua
  ctx.hapusDataTesting_(null);
  assert.strictEqual(ctx.readTable_('Maintenance').length, 0);
  assert.strictEqual(ctx.readTable_('Log').length, 0);
  assert.strictEqual(ctx.readTable_('Pemakaian Sparepart').length, 0);
  assert.strictEqual(lap(2027).rows.length, 0);
  assert.strictEqual(ss.getSheetByName('Rekap 2027').data[16][1], 0);
  assert.strictEqual(ctx.hapusDataTesting_(null).maintenance, 0, 'jalankan ulang: tidak ada apa-apa');
  // aplikasi tetap jalan setelah dibersihkan
  as('budi@gmail.com', () => {
    const id = ctx.apiStart('L01', 'E22H').open.id;
    assert.ok(id.endsWith('-01'));
    assert.strictEqual(lap(2027).rows.length, 1);
    ctx.apiCancel(id, 'Input ganda');
  });
});

console.log('\n' + passed + ' test lulus' + (process.exitCode ? ', ADA YANG GAGAL' : ''));
