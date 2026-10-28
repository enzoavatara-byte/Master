/**
 * Test lokal logika server (src/*.js) dengan mock Apps Script services + jam yang bisa dimajukan.
 * Jalankan: node test/run.js
 * Ini TIDAK menguji UI atau perilaku asli Google (izin, kuota, trigger, rumus FILTER) — hanya logika.
 */
'use strict';
const assert = require('assert');
const { ctx, ss, clock, advance, FakeDate, user, lock, triggers, mails, cache, ui, bawaanLama } = require('./mock');
bawaanLama();   // 2.6.9: test lama memakai factory / project / sparepart bawaan versi sebelumnya

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
  for (const n of ['Users', 'Factory', 'Projects', 'Lines', 'Sparepart', 'Pemakaian Sparepart', 'Format Laporan', 'Catatan Panduan', 'Pilihan', 'Form', 'Config', 'Maintenance', 'Log', 'Maintenance VF7', 'Maintenance Limo7', 'Maintenance E22H', 'Maintenance E245', 'Pending Work', 'Rekap 2026', 'Laporan 2026']) assert.ok(ss.getSheetByName(n), n);
  assert.ok(!ss.getSheetByName('Sheet1'));
  assert.ok(!ss.getSheetByName('BOM'), 'BOM tidak dibuat lagi');
  assert.ok(!ss.getSheetByName('Mesin'), '2.6: sheet Mesin tidak dibuat (line = unit)');
  jeq(ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Tipe Maintenance').map(r => r.Nilai), ['Corrective'], '2.6: Preventive dihapus');
  jeq(triggers.map(t => t.getHandlerFunction()).sort(), ['backupTerjadwal', 'checkTimeouts', 'onMasterChange', 'refreshRekap'], 'trigger tidak dobel');
  assert.strictEqual(triggers.find(t => t.getHandlerFunction() === 'refreshRekap').every, 'hari:1@1', 'bangun ulang penuh tiap malam');
  assert.strictEqual(ctx.readTable_('Config').length, 23);   // 2.6.4: + IKON_APLIKASI, 2.6.6: + BACKUP_TAB
  assert.strictEqual(ctx.readTable_('Users')[0].Peran, 'Admin');
  jeq(ctx.readTable_('Projects').map(p => p['Factory ID'] + ':' + p.Baterai), ['F1:VF7', 'F1:Limo7', 'F2:E22H', 'F2:E245']);
  assert.strictEqual(ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Masalah').length, 5, 'pilihan tidak terduplikasi');
  assert.strictEqual(ctx.readTable_('Form').length, 20, 'form tidak terduplikasi');
  assert.strictEqual(ctx.readTable_('Sparepart').length, 11, 'katalog contoh sekali saja');
  assert.strictEqual(ctx.readTable_('Format Laporan').length, 22);
  jeq(ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Jenis Kerusakan').map(r => r.Nilai), ['Elektrikal', 'Mekanikal', 'Pneumatik', 'Program', 'Operasional', 'Produk', 'MES']);
  // 2.6.1: Maintenance <baterai> = Laporan per project (rumus FILTER ke tab Laporan, No. 1..n per project)
  const B = ss.getSheetByName('Maintenance E22H'), lapH = ss.getSheetByName('Laporan 2026').data[1];
  jeq(B.data[1], lapH.slice(0, lapH.length - 1), 'header = Laporan tanpa kolom kunci');
  assert.match(String(B.data[0][0]), / · E22H · 2026$/);
  const fB = B.data[2].filter(v => typeof v === 'string' && v[0] === '=');
  assert.strictEqual(B.data[2][0], '=IFERROR(SEQUENCE(COUNTIF(\'Laporan 2026\'!C3:C, "E22H")), "")', 'kolom NO = 1..n');
  assert.strictEqual(B.data[2][1], '=IFERROR(FILTER(\'Laporan 2026\'!B3:' + ctx.colLetter_(lapH.length - 1) + ', \'Laporan 2026\'!C3:C="E22H"), "")');
  assert.strictEqual(fB.length, 2);
  assert.strictEqual(B.frozenRows, 2);
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
test('pending: satu form → Pending (2.6: tanpa review/Cek), tampil di tab Pending & halaman line', () => {
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
  assert.strictEqual(r['Status review'], '', '2.6: Pending tidak masuk antrean review');
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
  assert.strictEqual(r['Status review'], '', '2.6.1: Cancel langsung final, tanpa review');
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

test('review (2.6.1): hanya admin; Pending & Cancelled tidak masuk review; Admin putuskan Abandoned', () => {
  let P;
  as('andi@gmail.com', () => {
    P = ctx.apiStart('L03', 'E22H').open.id;
    ctx.apiPending(P, pend('Bongkar cover', 'Butuh teknisi lain', 'HARI_INI'));
  });
  as('budi@gmail.com', () => {
    assert.strictEqual(ctx.apiListReview().items.length, 0, 'teknisi tidak punya antrean review');
    assert.strictEqual(ctx.apiBootstrap('').counts.review, 0);
    throwsMsg(() => ctx.apiReview(D, { action: 'KELUARKAN', note: 'x' }), /tidak berwenang/);
  });
  as('andi@gmail.com', () => throwsMsg(() => ctx.apiReview(P, { action: 'CEK', note: 'ok' }), /tidak ada di antrian/));
  assert.strictEqual(rec(P).Status, 'Pending');
  as('sari@gmail.com', () => {
    const list = ctx.apiListReview().items;
    assert.ok(!list.some(i => i.id === P), 'Pending tidak di antrean review');
    throwsMsg(() => ctx.apiReview(P, { action: 'CEK' }), /tidak ada di antrian/);
    assert.ok(list.length >= 1 && list.every(i => i.status === 'Abandoned'), '2.6.1: hanya Abandoned');
    throwsMsg(() => ctx.apiReview(D, { action: 'HITUNG', activeMin: 60 }), /Catatan review wajib/);
    throwsMsg(() => ctx.apiReview(D, { action: 'HITUNG', activeMin: 99999, note: 'x' }), /Menit aktif/);
    ctx.apiReview(D, { action: 'HITUNG', activeMin: 90, note: 'Konfirmasi teknisi: selesai jam 12' });
    const cancelled = ctx.readTable_('Maintenance').find(r => r.Status === 'Cancelled');
    throwsMsg(() => ctx.apiReview(cancelled['Maintenance ID'], { action: 'SETUJU' }), /tidak ada di antrian/);
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

test('2.6 persiapan: line = unit (L05-A, L05-B terpisah), tanpa daftar mesin, line F1', () => {
  as('sari@gmail.com', () => {
    const open = ctx.apiBootstrap('').myOpen;
    if (open) ctx.apiCancel(open.id, 'Input ganda');
  });
  L.appendRow(lineRow(['L05-A', 'Formation 5A', 'F1', '', '', 'Hall D', 'Ya']));
  L.appendRow(lineRow(['L05-B', 'Formation 5B', 'F1', '', '', 'Hall D', '']));             // Aktif kosong = aktif
  L.appendRow(lineRow(['L06', 'Packing', 'F1', 'Limo7', '', 'Hall D', 'Ya']));              // override baterai
  L.appendRow(lineRow(['L07', 'Salah', 'F1', 'X99', '', '', 'Ya']));                       // baterai tidak terdaftar
  as('budi@gmail.com', () => {
    const v = ctx.apiGetLine('L05-A');
    assert.strictEqual(v.machines, undefined, 'tidak ada pilihan mesin');
    assert.ok(ctx.apiGetLine('L05-B').line.active);
    assert.ok(!ctx.apiBootstrap('').master.forms.Mulai.some(f => f.field === 'Mesin ID'), 'form Mulai tanpa mesin');
    jeq(ctx.apiBootstrap('').master.forms.Mulai.find(f => f.field === 'Tipe').options, ['Corrective'], 'satu tipe → aplikasi tidak menanyakan');
  });
});

test('2.1 baterai per factory: F1 hanya VF7/Limo7, override per line, default baterai pertama', () => {
  as('budi@gmail.com', () => {
    const v = ctx.apiGetLine('L05-A');
    jeq(v.line.batteries, ['VF7', 'Limo7']);
    assert.strictEqual(v.lastBattery, 'VF7');
    jeq(ctx.apiGetLine('L06').line.batteries, ['Limo7']);
    throwsMsg(() => ctx.apiStart('L05-A', { baterai: 'E22H' }), /tidak ada di daftar pilihan untuk line L05-A/);
    throwsMsg(() => ctx.apiStart('L06', 'VF7'), /tidak ada di daftar/);
  });
});

let MO;
test('2.6 satu pekerjaan terbuka per line (line = unit); line lain boleh; mesin dari klien lama diabaikan', () => {
  as('budi@gmail.com', () => { MO = ctx.apiStart('L05-A', { baterai: 'VF7', mesin: 'm-oven' }).open.id; });
  const r = rec(MO);
  assert.strictEqual(r['Mesin ID'], '');
  assert.strictEqual(r['Nama Mesin'], '');
  assert.strictEqual(r.Factory, 'F1');
  assert.strictEqual(r.Tipe, 'Corrective', 'tipe satu-satunya dipakai otomatis');
  as('andi@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L05-A', { baterai: 'VF7' }), /Line L05-A sedang dikerjakan Budi/);
    assert.strictEqual(ctx.apiGetLine('L05-A').lineLocked, true);
    const v = ctx.apiStart('L05-B', { baterai: 'VF7' });
    assert.ok(v.openIsMine, 'unit lain (L05-B) bebas');
  });
  as('sari@gmail.com', () => {
    const id = ctx.apiStart('L06', { baterai: 'Limo7', mesin: 'Lainnya', mesinLain: 'Kompresor' }).open.id;
    assert.strictEqual(rec(id)['Nama Mesin'], '', 'isian mesin "Lainnya" dari klien lama diabaikan');
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

test('2.6 Preventive dihapus: tipe lain ditolak; jika admin menyalakan lagi, Preventive tetap tidak masuk MTTR', () => {
  advance(30);
  as('budi@gmail.com', () => ctx.apiComplete(MO, done));
  assert.strictEqual(rec(MO)['Masuk MTTR'], 'Ya');
  as('andi@gmail.com', () => {
    const id = ctx.apiBootstrap('').myOpen.id;
    ctx.apiComplete(id, sel('Mesin berhenti', { tanpaPart: true }));
    throwsMsg(() => ctx.apiStart('L06', { baterai: 'Limo7', tipe: 'Preventive' }), /Tipe maintenance "Preventive"/);
  });
  ss.getSheetByName('Pilihan').appendRow(rowOf('Pilihan', { Jenis: 'Tipe Maintenance', Nilai: 'Preventive', Urutan: 2, Aktif: 'Ya' }));
  ctx.invalidateMaster_();
  as('andi@gmail.com', () => {
    const p = ctx.apiStart('L06', { baterai: 'Limo7', tipe: 'Preventive' }).open.id;
    advance(20);
    ctx.apiComplete(p, sel('Hasil produk NG', { tanpaPart: true }));
    assert.strictEqual(rec(p).Tipe, 'Preventive');
    assert.strictEqual(rec(p)['Masuk MTTR'], 'Tidak');
    throwsMsg(() => ctx.apiStart('L06', { baterai: 'Limo7', tipe: 'Darurat' }), /Tipe maintenance "Darurat"/);
  });
  setRow('Pilihan', (r, h) => r[h.indexOf('Nilai')] === 'Preventive', 'Aktif', 'Tidak');
  ctx.invalidateMaster_();
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

test('2.1 filter factory/baterai/line/cari di Pending, Review, Riwayat (2.6: tanpa grup)', () => {
  as('budi@gmail.com', () => {
    const id = ctx.apiStart('L05-B', { baterai: 'Limo7' }).open.id;
    ctx.apiPending(id, pend('Cek oli press', 'Menunggu part', 'BESOK'));
    assert.ok(ctx.apiListPending({ factory: 'F1' }).items.every(i => i.factory === 'F1'));
    assert.strictEqual(ctx.apiListPending({ factory: 'F1' }).items.length, 1);
    assert.strictEqual(ctx.apiListPending({ line: 'L05-B' }).items[0].id, id);
    assert.strictEqual(ctx.apiListPending({ line: 'L05' }).items.length, 0, '2.6: tidak ada filter grup');
    assert.strictEqual(ctx.apiListPending({ baterai: 'VF7' }).items.length, 0);
    assert.strictEqual(ctx.apiListPending({ q: 'formation 5b' }).items.length, 1, 'cari lewat nama line');
    assert.ok(ctx.apiListPending({ factory: 'F2' }).items.every(i => i.factory === 'F2'));
    assert.ok(ctx.apiListReview({ factory: 'F1' }).items.every(i => i.factory === 'F1'));
    assert.ok(ctx.apiHistory({ factory: 'F1', tipe: 'Corrective' }).items.every(i => i.factory === 'F1' && i.tipe === 'Corrective'));
  });
});

test('2.1 dashboard: MTTR corrective, top line/teknisi, Lainnya terbanyak, kartu project', () => {
  setRow('Projects', (r, h) => r[h.indexOf('Baterai')] === 'VF7', 'Fase', 'Trial');
  setRow('Projects', (r, h) => r[h.indexOf('Baterai')] === 'VF7', 'Target MTTR (menit)', 10);
  as('sari@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 30, factory: 'F1' });
    assert.ok(d.kpi.corrective >= 2);
    const rows = ctx.readTable_('Maintenance').filter(r => r.Factory === 'F1' && r['Masuk MTTR'] === 'Ya');
    near(d.kpi.mttr, rows.reduce((s, r) => s + Number(r['Total aktif (menit)']), 0) / rows.length);
    assert.ok(d.linesFreq.find(l => l.key === 'L05-A' && l.name), '2.6: top line + nama line');
    assert.strictEqual(d.lines, undefined); assert.strictEqual(d.machines, undefined);
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

test('2.6 PIC tambahan saat Selesai: dari Users aktif, boleh >1, tanpa diri sendiri; masuk Teknisi terlibat, Laporan, Log, Dashboard per teknisi', () => {
  U.appendRow(rowOf('Users', { Email: 'joko@gmail.com', Nama: 'Joko', Peran: 'Teknisi', Aktif: 'Tidak' }));
  ctx.invalidateMaster_();
  let id;
  as('budi@gmail.com', () => {
    const m = ctx.apiBootstrap('').master;
    assert.ok(m.people.find(p => p.email === 'andi@gmail.com' && p.name === 'Andi'), 'daftar PIC dari Users');
    assert.ok(!m.people.find(p => p.email === 'joko@gmail.com'), 'user nonaktif tidak bisa dipilih');
    jeq(m.people.map(p => p.name), m.people.map(p => p.name).slice().sort((a, b) => a.localeCompare(b)), 'urut nama');
    assert.ok(m.forms.Selesai.find(f => f.field === 'PIC tambahan' && f.type === 'sistem' && !f.required), 'opsional');
    id = ctx.apiStart('L01', { baterai: 'E22H' }).open.id;
    advance(12);
    throwsMsg(() => ctx.apiComplete(id, { ...done, pics: ['joko@gmail.com'] }), /joko@gmail.com.*nonaktif/);
    throwsMsg(() => ctx.apiComplete(id, { ...done, pics: ['siapa@gmail.com'] }), /tidak terdaftar/);
    assert.strictEqual(rec(id).Status, 'Aktif', 'ditolak sebelum menulis apa pun');
    ctx.apiComplete(id, { ...done, pics: [' Andi@gmail.com ', 'andi@gmail.com', 'budi@gmail.com', 'sari@gmail.com'] });
  });
  const r = rec(id);
  assert.strictEqual(r['Teknisi terlibat'], 'budi@gmail.com, andi@gmail.com, sari@gmail.com', 'diri sendiri & dobel diabaikan');
  assert.strictEqual(r['Nama teknisi terlibat'], 'Budi, Andi, Sari');
  assert.strictEqual(r['Nama PIC'], 'Budi', 'PIC utama tetap yang menekan Selesai');
  assert.match(ctx.readTable_('Log').find(e => e['Maintenance ID'] === id && e.Kejadian === 'complete').Detail, /PIC tambahan: Andi, Sari/);
  assert.strictEqual(ctx.laporanValue_('PIC', r, 0, [], ctx.masterData_(), ctx.userNameMap_()), 'Budi, Andi, Sari', 'Laporan & TPM Responsibility');
  as('andi@gmail.com', () => assert.ok(ctx.apiHistory({}).items.find(i => i.id === id), 'PIC tambahan melihat pekerjaan di Riwayat-nya'));
  as('owner@gmail.com', () => {
    const t = ctx.apiDashboard({ periode: 30 }).techs, sari = t.find(x => x.key === 'Sari');
    assert.ok(sari && sari.count >= 1, 'Dashboard: PIC tambahan ikut dihitung per teknisi');
    assert.strictEqual(t.filter(x => x.key === 'Budi').length, 1, 'satu baris per teknisi');
  });
  // admin mematikan field → pics diabaikan (klien lama / form tanpa field)
  setRow('Form', (x, h) => x[h.indexOf('Form')] === 'Selesai' && x[h.indexOf('Field')] === 'PIC tambahan', 'Aktif', 'Tidak');
  ctx.invalidateMaster_();
  as('sari@gmail.com', () => {
    const j = ctx.apiStart('L02', { baterai: 'E22H' }).open.id;
    advance(3);
    ctx.apiComplete(j, { ...done, pics: ['joko@gmail.com'] });
    assert.strictEqual(rec(j)['Teknisi terlibat'], 'sari@gmail.com');
    assert.ok(!ctx.apiBootstrap('').master.forms.Selesai.find(f => f.field === 'PIC tambahan'));
  });
  setRow('Form', (x, h) => x[h.indexOf('Form')] === 'Selesai' && x[h.indexOf('Field')] === 'PIC tambahan', 'Aktif', 'Ya');
  ctx.invalidateMaster_();
  as('budi@gmail.com', () => {
    const j = ctx.apiStart('L02', { baterai: 'E22H' }).open.id;
    throwsMsg(() => ctx.apiComplete(j, { ...done, pics: Array.from({ length: 11 }, (_, i) => 'x' + i + '@gmail.com') }), /tidak terdaftar/);
    ctx.apiCancel(j, { values: { 'Alasan cancel': 'Lainnya' }, other: { 'Alasan cancel': 'uji pic' } });
  });
});

test('2.6 QR: hanya per line; QR mesin lama (?mesin=) disanitasi lalu diabaikan, ?line= tetap membuka line', () => {
  as('andi@gmail.com', () => {
    assert.strictEqual(ctx.doGet({ parameter: { line: 'L05-A', mesin: 'M-OVEN"<x>' } }).vars.mesinId, 'M-OVENx');
    assert.strictEqual(ctx.apiBootstrap('', 'M-OVEN').lineView, null, 'QR mesin tanpa line: tidak ada line');
    const v = ctx.apiBootstrap('L05-A', 'M-OVEN').lineView;
    assert.strictEqual(v.line.id, 'L05-A');
    assert.strictEqual(v.preselectMesin, undefined);
    throwsMsg(() => ctx.apiListLinesForQr(), /tidak punya akses/);
  });
  as('sari@gmail.com', () => {
    const q = ctx.apiListLinesForQr();
    assert.ok(q.lines.find(l => l.id === 'L05-A') && q.lines.every(l => l.machines === undefined));
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
  assert.strictEqual(triggers.length, 4);   // 2.6.6: + backupTerjadwal
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

test('2.2 stop line: ditanya saat Mulai, default Ya (Corrective), pilihan teknisi menang, nilai salah ditolak', () => {
  as('dewi@gmail.com', () => {
    throwsMsg(() => ctx.apiStart('L10', { baterai: 'E22H', stopLine: 'Mungkin' }), /Stop line harus/);
    const id = ctx.apiStart('L10', { baterai: 'E22H', stopLine: 'Tidak' }).open.id;
    assert.strictEqual(rec(id)['Stop line'], 'Tidak', 'pilihan teknisi menang atas default');
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
    J2 = ctx.apiStart('L11', { baterai: 'E245', stopLine: 'Tidak' }).open.id;
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
  assert.strictEqual(a['Jenis Sparepart'], '① Elektrikal\n② Mekanikal', 'satu part per baris, bukan ;  (2.6.1: bernomor sama di tiap kolom)');
  assert.strictEqual(a['Nama Sparepart'], '① Fuse\n② Bearing');
  assert.strictEqual(a['Model Sparepart'], '① 10A\n② 6205-2RS');
  assert.strictEqual(a['Jumlah Sparepart'], '① 1\n② 2');
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
  assert.strictEqual(r.Tipe, 'Corrective');
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

test('2.2 proses: cari line lewat nama, filter proses, Line ID tidak berubah (2.6: Alias tidak dipakai); dashboard jenis & sparepart', () => {
  as('dewi@gmail.com', () => {
    const l10 = ctx.apiBootstrap('').master.lines.find(l => l.id === 'L10');
    assert.strictEqual(l10.alias, undefined, 'kolom Alias lama diabaikan');
    assert.strictEqual(l10.proses, 'Modul Line');
    assert.strictEqual(ctx.apiHistory({ q: 'retreat satu' }).items.length, 0, 'alias tidak dicari lagi');
    const byName = ctx.apiHistory({ q: 'retreatment 1' }).items;
    assert.ok(byName.length >= 1 && byName.every(i => i.line === 'L10'));
    jeq([...new Set(ctx.apiHistory({ proses: 'Modul Line' }).items.map(i => i.line))].sort(), ['L10', 'L11']);
    assert.strictEqual(ctx.apiGetLine('L10').line.proses, 'Modul Line');
    assert.strictEqual(ctx.apiGetDetail(J1).record.proses, 'Modul Line');
  });
  as('sari@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 30, proses: 'Modul Line' });
    assert.strictEqual(d.kpi.corrective, 2);
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
  assert.strictEqual(triggers.length, 4);   // 2.6.6: + backupTerjadwal
});

U.appendRow(rowOf('Users', { Email: 'eko@gmail.com', Nama: 'Eko', Peran: 'Teknisi', Aktif: 'Ya' }));
const rekapDone = () => ss.getSheetByName('Rekap 2026').data[16][1];   // baris Total, kolom "Pekerjaan selesai"
const rowById = (id) => lapRow(2026, r => r._id === id)[0];

test('2.2.2 langsung: Mulai/Pause/Selesai/Cancel memperbarui Laporan tanpa bangun ulang penuh (2.6.1: Rekap tiap malam), hasil = bangun ulang penuh', () => {
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
    assert.strictEqual(a['Nama Sparepart'], '① Fuse\n② Fitting L');
    assert.strictEqual(a['Jumlah Sparepart'], '① 3\n② 1');
    assert.strictEqual(rekapDone(), doneBefore, '2.6.1: Rekap (tersembunyi) tidak ditulis per tombol');
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
  ctx.refreshRekap();
  assert.ok(rekapDone() >= 1, 'Rekap dibangun malam');
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
  assert.strictEqual(rows[0][0], 'Bulan\n月份', 'judul kolom dua bahasa');
  jeq(rows.slice(1, 13).map(r => r[0]), ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']);
  const all = ctx.readTable_('Maintenance').filter(r => finalOf(r) instanceof Date);
  const done = all.filter(r => r.Status === 'Completed');
  const counted = all.filter(r => r['Masuk MTTR'] === 'Ya');
  const tot = rows[13];
  assert.strictEqual(tot[0], 'Total 2026');
  assert.strictEqual(tot[1], done.length, 'pekerjaan selesai');
  assert.strictEqual(tot[2], done.filter(r => r.Tipe !== 'Preventive').length, 'Corrective (2.6: kolom Preventive dihapus)');
  assert.strictEqual(rows[0].length, 10);
  near(tot[3], counted.reduce((a, r) => a + Number(r['Total aktif (menit)']), 0) / counted.length);
  assert.strictEqual(tot[7], all.filter(r => r.Status === 'Cancelled').length);
  assert.strictEqual(tot[8], all.filter(r => r.Status === 'Abandoned').length);
  assert.strictEqual(tot[9], all.filter(r => r.Status === 'Abandoned' && r['Masuk MTTR'] === 'Ya').length);
  for (let m = 0; m < 12; m++) {
    assert.strictEqual(rows[1 + m][1], done.filter(r => wibMonth(r.Selesai) === m).length, 'bulan ' + (m + 1));
  }
  assert.strictEqual(rows[1][3], '', 'bulan tanpa data: MTTR kosong, bukan 0');
  // jalankan ulang = hasil sama (tidak menumpuk)
  ctx.buildRekap_(2026);
  jeq(rekapRows(2026), rows);
});

test('dashboard "Tahun ini" = 1 Januari s/d sekarang, sama dengan rekap', () => {
  as('sari@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 'ytd' });
    assert.strictEqual(d.periode, 'ytd');
    near(d.kpi.mttr, rekapRows(2026)[13][3]);
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
  ['Maintenance', 'Log', 'Pemakaian Sparepart'].forEach(n => { const sh = ss.getSheetByName(n);
    assert.strictEqual(sh.getMaxRows(), sh.getLastRow() + 500, n + ': baris yang dikosongkan arsip dihapus, sisa 500 (2.6.5)'); });
  assert.strictEqual(ss.getSheetByName('Arsip Log 2026').getMaxColumns(), ss.getSheetByName('Arsip Log 2026').data[0].length, 'tab arsip tanpa kolom kosong');
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

test('multi-akun: apiWhoAmI = akun yang benar-benar dipakai Google untuk panggilan (tanpa baca sheet)', () => {
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiWhoAmI(), 'budi@gmail.com'));
  as('Akun.Lain@Gmail.com ', () => assert.strictEqual(ctx.apiWhoAmI(), 'akun.lain@gmail.com', 'belum terdaftar pun tetap dijawab, supaya HP bisa menjelaskan'));
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiBootstrap('').cekAkun, true, 'default: pemeriksaan aktif'));
  setRow('Config', (r, h) => r[h.indexOf('Key')] === 'CEK_AKUN', 'Value', 'Tidak');
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiBootstrap('').cekAkun, false, 'admin bisa mematikan'));
  setRow('Config', (r, h) => r[h.indexOf('Key')] === 'CEK_AKUN', 'Value', 'Ya');
});

// ---------- 2.5: bahasa China, terjemahan, saran, rencana ----------
U.appendRow(rowOf('Users', { Email: 'li@gmail.com', Nama: 'Li Wei', Peran: 'Teknisi', Aktif: 'Ya', Bahasa: 'zh' }));
U.appendRow(rowOf('Users', { Email: 'zhang@gmail.com', Nama: 'Zhang', Peran: 'Teknisi', Aktif: 'Ya', Bahasa: 'Mandarin' }));
const LA = ctx.LanguageApp;

test('2.5 setup: sheet Terjemahan/Saran/Rencana, label 中文/English bawaan terisi, tidak menimpa koreksi admin', () => {
  for (const n of ['Terjemahan', 'Saran', 'Rencana']) assert.ok(ss.getSheetByName(n), n);
  const R = ctx.readTable_('Rencana');
  assert.ok(R.length >= 4 && R.some(r => /Login tanpa akun Google/.test(r.Judul)) && R.some(r => /Pindah dari Google Apps Script/.test(r.Judul)));
  const opt = (v) => ctx.readTable_('Pilihan').find(r => r.Nilai === v);
  assert.strictEqual(opt('Sensor error')['Nilai (中文)'], '传感器故障');
  assert.strictEqual(opt('Sensor error')['Nilai (English)'], 'Sensor error');
  const form = (f, k) => ctx.readTable_('Form').find(r => r.Form === f && r.Field === k);
  assert.strictEqual(form('Selesai', 'Jenis kerusakan')['Label (中文)'], '故障类型');
  assert.strictEqual(form('Selesai', 'Masalah')['Label (中文)'], '故障现象', 'diisi saat setup pertama; setelah itu milik admin');
  setRow('Form', (r, h) => r[h.indexOf('Form')] === 'Cancel' && r[h.indexOf('Field')] === 'Catatan', 'Label (中文)', '');
  setRow('Form', (r, h) => r[h.indexOf('Form')] === 'Cancel' && r[h.indexOf('Field')] === 'Catatan', 'Label', 'Keterangan batal');
  setRow('Pilihan', (r, h) => r[h.indexOf('Nilai')] === 'Kebocoran', 'Nilai (中文)', '漏气/漏油');
  const before = ctx.readTable_('Rencana').length;
  ctx.setup();
  assert.strictEqual(opt('Kebocoran')['Nilai (中文)'], '漏气/漏油', 'koreksi admin tidak ditimpa');
  assert.strictEqual(form('Cancel', 'Catatan')['Label (中文)'], '', 'label Indonesia diubah admin → 中文 bawaan tidak dipasang (bisa salah arti)');
  assert.strictEqual(ctx.readTable_('Rencana').length, before, 'rencana tidak dobel');
});

test('2.5 bahasa user (Users → Bahasa), label tampilan zh, nilai yang disimpan tetap kanonik', () => {
  as('li@gmail.com', () => {
    const b = ctx.apiBootstrap('');
    assert.strictEqual(b.user.lang, 'zh');
    assert.strictEqual(b.master.trZh['Sensor error'], '传感器故障');
    assert.strictEqual(b.master.trZh['Kebocoran'], '漏气/漏油');
    assert.strictEqual(b.master.forms.Selesai.find(f => f.field === 'Jenis kerusakan').labelZh, '故障类型');
    assert.ok(b.master.rencana.length >= 4);
  });
  as('zhang@gmail.com', () => assert.strictEqual(ctx.apiBootstrap('').user.lang, 'zh', '"Mandarin" = zh'));
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiBootstrap('').user.lang, 'id', 'kosong = id'));
  setRow('Lines', (r) => r[0] === 'L10', 'Nama (中文)', '电芯返修 1');
  as('li@gmail.com', () => {
    const tr = ctx.apiBootstrap('').master.trZh;
    assert.strictEqual(tr['Cell Retreatment 1'], '电芯返修 1');
    const id = ctx.apiStart('L10', { baterai: 'E22H' }).open.id;
    advance(5);
    ctx.apiComplete(id, { ...sel('Kebocoran', { tanpaPart: true }), values: { ...sel('Kebocoran').values, Catatan: '气管接头漏气' } });
    const r = rec(id);
    assert.strictEqual(r.Masalah, 'Kebocoran', 'disimpan kanonik, bukan label 中文');
    assert.match(r.Catatan, /\] 气管接头漏气$/, 'teks bebas disimpan apa adanya (dengan cap waktu & nama)');
  });
  assert.match(as('asing@gmail.com', () => ctx.doGet({ parameter: {} }).vars.body), /未注册或已停用/, 'Access Denied juga dalam 中文');
});

test('2.5 terjemahan: Google Translate sekali lalu dari sheet Terjemahan; koreksi admin dipakai; teks berbahasa tujuan tidak dikirim', () => {
  LA.calls = 0;
  const out = as('li@gmail.com', () => ctx.apiTranslate(['Ganti selang angin bocor', '气管接头漏气', '', 'Ganti selang angin bocor'], 'zh'));
  jeq(out, ['[zh-CN] Ganti selang angin bocor', '气管接头漏气', '', '[zh-CN] Ganti selang angin bocor']);
  assert.strictEqual(LA.calls, 1, 'teks sama dua kali = satu panggilan; teks Han tidak dikirim');
  const row = ctx.readTable_('Terjemahan').find(r => r.Teks === 'Ganti selang angin bocor');
  assert.strictEqual(row['Bahasa asal'], 'id');
  assert.strictEqual(row.zh, '[zh-CN] Ganti selang angin bocor');
  ctx.resetMaster_();
  as('li@gmail.com', () => ctx.apiTranslate(['Ganti selang angin bocor'], 'zh'));
  assert.strictEqual(LA.calls, 1, 'permintaan berikutnya dari sheet, tanpa Google');
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiTranslate(['Ganti selang angin bocor'], 'en')[0], '[en] Ganti selang angin bocor'));
  assert.strictEqual(ctx.readTable_('Terjemahan').filter(r => r.Teks === 'Ganti selang angin bocor').length, 1, 'bahasa baru ditulis di baris yang sama');
  setRow('Terjemahan', (r, h) => r[h.indexOf('Teks')] === 'Ganti selang angin bocor', 'zh', '更换漏气的气管');
  ctx.onEdit({ range: ss.getSheetByName('Terjemahan').getRange(2, 4) });
  ctx.resetMaster_();
  as('li@gmail.com', () => assert.strictEqual(ctx.apiTranslate(['Ganti selang angin bocor'], 'zh')[0], '更换漏气的气管', 'koreksi admin dipakai'));
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiTranslate(['气管接头漏气'], 'id')[0], '[id] 气管接头漏气'));
  as('budi@gmail.com', () => assert.strictEqual(ctx.apiTranslate(['Sudah dalam bahasa Indonesia'], 'id')[0], 'Sudah dalam bahasa Indonesia'));
  as('budi@gmail.com', () => throwsMsg(() => ctx.apiTranslate(new Array(51).fill('x'), 'zh'), /Maksimal 50/));
  as('asing@gmail.com', () => throwsMsg(() => ctx.apiTranslate(['x'], 'zh'), /ACCESS_DENIED/));
  const many = Array.from({ length: 60 }, (_, i) => 'teks unik nomor ' + i);
  LA.calls = 0;
  const rowsBefore = ss.getSheetByName('Terjemahan').getLastRow();
  const part = ctx.translate_(many, 'zh');
  assert.strictEqual(LA.calls, 1, 'teks satu baris digabung: satu panggilan Google');
  assert.strictEqual(part[49], '[zh-CN] teks unik nomor 49', 'baris hasil dipasangkan kembali dengan benar');
  assert.strictEqual(part[55], 'teks unik nomor 55', 'lebih dari 50 teks baru: sisanya tetap teks asli (permintaan berikutnya)');
  assert.strictEqual(ss.getSheetByName('Terjemahan').getLastRow(), rowsBefore + 50, '50 baris baru ditulis sekaligus');
});

test('2.5 terjemahan Google: jumlah baris tidak cocok → satu per satu; kuota habis → berhenti, teks asli', () => {
  ctx.resetMaster_();
  LA.calls = 0; LA.joinLines = true;
  let out = ctx.translate_(['pompa vakum lemah', 'oli rembes di gearbox', 'Catatan:\nbaut kendor\nsudah dikencangkan'], 'zh');
  LA.joinLines = false;
  assert.strictEqual(LA.calls, 1 + 3, 'gabungan gagal dipasangkan → diulang per teks');
  assert.strictEqual(out[1], '[zh-CN] oli rembes di gearbox');
  ctx.resetMaster_();
  LA.calls = 0; LA.fail = true;
  out = ctx.translate_(['kabel sensor terjepit', 'motor panas', 'teks\ndua baris'], 'zh');
  LA.fail = false;
  assert.strictEqual(LA.calls, 1, 'Google menolak → tidak dicoba lagi di permintaan ini');
  assert.deepStrictEqual(out, ['kabel sensor terjepit', 'motor panas', 'teks\ndua baris'], 'teks asli dikembalikan, tanpa error');
  ctx.resetMaster_();
  assert.strictEqual(ctx.translate_(['motor panas'], 'zh')[0], '[zh-CN] motor panas', 'gagal tidak di-cache: dicoba lagi berikutnya');
});

test('2.5 isi terjemahan otomatis: mengisi sel kosong Lines (中文 + English, 2.6)/Pilihan, tidak menimpa yang sudah ada', () => {
  LA.calls = 0;
  ctx.isiTerjemahanMaster_(true);
  const m = ctx.readTable_('Lines');
  assert.strictEqual(m.find(r => r['Line ID'] === 'L10')['Nama (中文)'], '电芯返修 1', 'tidak ditimpa');
  assert.strictEqual(m.find(r => r['Line ID'] === 'L11')['Nama (中文)'], '[zh-CN] Cell Retreatment 2');
  assert.strictEqual(m.find(r => r['Line ID'] === 'L11')['Nama (English)'], '[en] Cell Retreatment 2');
  assert.ok(LA.calls > 0);
  const n = LA.calls;
  ctx.isiTerjemahanMaster_(true);
  assert.strictEqual(LA.calls, n, 'jalankan ulang: semua sudah terisi');
});

test('2.5 saran: teknisi kirim & lihat miliknya, admin lihat semua + badge, tanggapi; saran 中文 diterjemahkan untuk admin', () => {
  as('budi@gmail.com', () => {
    throwsMsg(() => ctx.apiSaranKirim({ kategori: 'Fitur aplikasi', isi: '  ' }), /Tulis saranmu/);
    const l = ctx.apiSaranKirim({ kategori: 'Sparepart', isi: 'Tambahkan bearing 6206 di katalog' });
    assert.strictEqual(l.items.length, 1);
    assert.strictEqual(l.items[0].status, 'Baru');
    assert.strictEqual(l.items[0].email, '', 'teknisi tidak melihat email');
  });
  advance(1);
  as('li@gmail.com', () => {
    const l = ctx.apiSaranKirim({ kategori: 'Ngawur', isi: '希望增加夜班统计' });
    assert.strictEqual(l.items.length, 1, 'hanya saran sendiri');
    assert.strictEqual(l.items[0].kategori, 'Lainnya', 'kategori tak dikenal → Lainnya');
    assert.strictEqual(l.items[0].bahasa, 'zh');
    assert.strictEqual(l.items[0].terjemahan, '[id] 希望增加夜班统计');
  });
  let sid;
  as('sari@gmail.com', () => {
    const b = ctx.apiBootstrap('');
    assert.strictEqual(b.counts.saran, 2, 'badge admin: 2 saran baru');
    const l = ctx.apiSaranList();
    assert.ok(l.isAdmin && l.items.length === 2);
    assert.strictEqual(l.items[0].nama, 'Li Wei', 'terbaru dulu');
    sid = l.items[1].id;
    throwsMsg(() => ctx.apiSaranTanggapi(sid, { status: 'Hore', tanggapan: '' }), /Status saran tidak dikenal/);
    const after = ctx.apiSaranTanggapi(sid, { status: 'Direncanakan', tanggapan: 'Masuk update minggu depan' });
    assert.strictEqual(after.items.find(i => i.id === sid).status, 'Direncanakan');
    assert.strictEqual(ctx.apiRefresh({}).counts.saran, 1);
  });
  as('budi@gmail.com', () => {
    const mine = ctx.apiSaranList().items[0];
    assert.strictEqual(mine.tanggapan, 'Masuk update minggu depan');
    assert.strictEqual(mine.oleh, 'Sari');
    throwsMsg(() => ctx.apiSaranTanggapi(sid, { status: 'Selesai' }), /tidak punya akses/);
    assert.strictEqual(ctx.apiBootstrap('').counts.saran, 0, 'teknisi tanpa badge admin');
  });
});

// ---------- Paling akhir: menghapus data ----------
test('hapus data testing: sebelum tanggal → pekerjaan + Log + sparepart (juga arsip) terhapus, laporan & rekap dibuat ulang, master utuh', () => {
  throwsMsg(() => ctx.parseTanggalWib_('2027-02-01'), /dd\/mm\/yyyy/);
  throwsMsg(() => ctx.parseTanggalWib_('31/02/2027'), /tidak valid/);
  assert.strictEqual(ctx.parseTanggalWib_(''), null);
  const cut = ctx.parseTanggalWib_('01/02/2027');
  assert.strictEqual(cut.getTime(), Date.UTC(2027, 0, 31, 17, 0, 0), '00:00 WIB');
  const master = ['Users', 'Lines', 'Sparepart', 'Pilihan', 'Form', 'Config'].map(n => [n, ctx.readTable_(n).length]);
  const old = ctx.readTable_('Maintenance').concat(ctx.readTable_('Arsip 2026')).filter(r => r.Mulai < cut).map(r => r['Maintenance ID']);
  const plan = ctx.testDataPlan_(cut).counts;
  assert.strictEqual(plan.maintenance, old.length);
  assert.ok(plan.log > 0 && plan.sparepart > 0);
  const out = ctx.hapusDataTesting_(cut);
  jeq(out, Object.assign({ kpi: [] }, plan), 'tidak ada KPI tertutup → tidak ada yang dibuka lagi');
  const m = ctx.readTable_('Maintenance');
  assert.ok(m.length >= 1 && m.every(r => r.Mulai >= cut), 'yang dimulai sejak tanggal itu tetap ada');
  const live = new Set(m.map(r => r['Maintenance ID']));
  assert.ok(ctx.readTable_('Log').every(e => live.has(e['Maintenance ID'])), 'Log tanpa pekerjaan yang dihapus');
  assert.ok(ctx.readTable_('Pemakaian Sparepart').every(u => live.has(u['Maintenance ID'])));
  for (const n of ['Arsip 2026', 'Arsip Log 2026', 'Arsip Sparepart 2026', 'Laporan 2026', 'Rekap 2026']) assert.strictEqual(ss.getSheetByName(n), null, n + ' dihapus (kosong)');
  assert.strictEqual(lap(2027).rows.length, m.filter(r => r.Status !== 'Cancelled').length);
  jeq(['Users', 'Lines', 'Sparepart', 'Pilihan', 'Form', 'Config'].map(n => [n, ctx.readTable_(n).length]), master, 'sheet master tidak disentuh');
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

// ---------- 2.5.1 tampilan spreadsheet ----------
const ring = () => ss.getSheetByName('Ringkasan');
const cellOf = (sh, a1) => { const m = /^([A-Z])(\d+)$/.exec(a1); return (sh.data[+m[2] - 1] || [])[m[1].charCodeAt(0) - 65]; };
const findCell = (sh, re) => { for (let i = 0; i < sh.data.length; i++) for (let j = 0; j < sh.data[i].length; j++) if (re.test(String(sh.data[i][j]))) return { r: i + 1, c: j + 1, v: sh.data[i][j] }; return null; };
const colL = (name) => ctx.colLetter_(ctx.headers_(ss.getSheetByName('Maintenance')).indexOf(name) + 1);

test('2.5.1 setup: Ringkasan & Baca Saya paling depan, warna tab per kelompok, tab jarang dipakai disembunyikan', () => {
  assert.strictEqual(ctx.setup(), 'Setup selesai.', 'tampilan tanpa masalah');
  const y = ctx.yearOf_(new FakeDate()), names = ss.getSheets().map(s => s.getName());
  const TPM = ['TPM E22H', 'TPM E245', 'TPM Limo7', 'TPM VF7'];
  const BAT = ['Maintenance VF7', 'Maintenance Limo7', 'Maintenance E22H', 'Maintenance E245'];
  jeq(names.slice(0, 15), ['Ringkasan', 'Baca Saya', 'Laporan ' + y, 'KPI ' + y, ...BAT, ...TPM, 'Saran', 'Maintenance', 'Pemakaian Sparepart']);
  const shown = ss.getSheets().filter(s => !s.isSheetHidden()).map(s => s.getName());
  jeq(shown, ['Ringkasan', 'Baca Saya', 'Laporan ' + y, 'KPI ' + y, ...BAT, ...TPM, 'Saran', 'Maintenance', 'Pemakaian Sparepart', 'Input Manual', 'Users', 'Lines', 'Sparepart', 'Pilihan']);
  ['Rekap ' + y, 'Pending Work'].forEach(n => assert.ok(ss.getSheetByName(n).isSheetHidden(), '2.6.1: ' + n + ' tetap dibuat, disembunyikan'));
  assert.strictEqual(ss.getSheetByName('TPM VF7').tabColor, ctx.TEMA_.tab.laporan);
  assert.strictEqual(ss.getSheetByName('Maintenance VF7').tabColor, ctx.TEMA_.tab.laporan, '2.6.1: laporan per project terlihat, kelompok laporan');
  for (const n of ['Log', 'Terjemahan', 'Config', 'Form', 'KPI data']) assert.ok(ss.getSheetByName(n).isSheetHidden(), n + ' disembunyikan');
  ss.getSheets().filter(s => /^(Laporan|Rekap) \d{4}$/.test(s.getName()) && !s.getName().endsWith(' ' + y))
    .forEach(s => assert.ok(s.isSheetHidden(), s.getName() + ' (tahun lain) disembunyikan'));
  assert.strictEqual(ss.getSheetByName('Ringkasan').tabColor, ctx.TEMA_.tab.baca);
  assert.strictEqual(ss.getSheetByName('Users').tabColor, ctx.TEMA_.tab.atur);
  assert.strictEqual(ss.getSheetByName('Maintenance').tabColor, ctx.TEMA_.tab.app);
  ctx.menuTampilkanSemuaTab();
  assert.ok(ss.getSheets().every(s => !s.isSheetHidden()), 'menu → semua tab terlihat lagi');
  ctx.rapikanTampilan_({ full: true });
  assert.ok(ss.getSheetByName('Log').isSheetHidden(), 'rapikan lagi');
});

test('2.5.1 Ringkasan: rumus ke kolom Maintenance yang benar, tanggal pilihan dipertahankan, hanya sel tanggal terbuka', () => {
  const R = ring();
  assert.match(cellOf(R, 'K1'), /^=IF\(ISNUMBER\(\$C\$4\),INT\(\$C\$4\),TODAY\(\)\)$/, 'kosong = hari ini');
  const st = colL('Status'), se = colL('Selesai'), ak = colL('Total aktif (menit)'), mm = colL('Masuk MTTR');
  const selesai = findCell(R, /^Selesai 完成$/);
  assert.match(R.data[selesai.r][selesai.c - 1], new RegExp("COUNTIFS\\('Maintenance'!" + st + '2:' + st + ',"Completed",\'Maintenance\'!' + se + '2:' + se));
  const mttr = findCell(R, /^MTTR \(menit\)/);
  assert.match(R.data[mttr.r][mttr.c - 1], new RegExp("FILTER\\('Maintenance'!" + ak + '2:' + ak + ",'Maintenance'!" + mm + '2:' + mm + '="Ya"'), 'MTTR = rata-rata Masuk MTTR = Ya (seperti Rekap)');
  for (const t of ['HARI INI 今天', 'SEKARANG 现在', 'Per project', 'Jenis kerusakan', '5 line tersering', '5 line terlama', 'Masih terbuka']) assert.ok(findCell(R, new RegExp(t)), t);
  assert.ok(findCell(R, /^VF7$/) && findCell(R, /^E245$/), 'satu baris per project');
  assert.ok(findCell(R, /"Elektrikal 电气"/), 'jenis kerusakan dua bahasa');
  assert.strictEqual(R.charts.length, 2, 'grafik jenis kerusakan + selesai per hari');
  assert.ok(R.charts.every(c => JSON.stringify(c.calls.setOption).length && c.calls.setPosition), 'grafik punya posisi');
  // tanggal yang dipilih pembaca tidak hilang saat dibangun ulang (malam / setup)
  R.data[3][2] = new FakeDate(Date.UTC(2026, 8, 15, 5));
  ctx.rapikanTampilan_({});
  assert.ok(cellOf(R, 'C4') instanceof Date && cellOf(R, 'C4').getUTCDate() === 15, 'tanggal pilihan tetap');
  assert.strictEqual(R.charts.length, 2, 'grafik tidak dobel');
  assert.strictEqual(R.protections.length, 1);
  assert.strictEqual(R.protections[0].unprotected[0].a1, 'C4', 'hanya sel tanggal bebas diedit');
  R.data[3][2] = '';
});

test('2.6 Top 5 dua daftar per line: tersering (jumlah) & terlama (total waktu aktif), dengan nama line; Ringkasan memakai rumus yang sama', () => {
  as('owner@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 30 });
    assert.ok(d.linesFreq.length <= 5 && d.linesLong.length <= 5);
    for (let i = 1; i < d.linesFreq.length; i++) {
      const a = d.linesFreq[i - 1], b = d.linesFreq[i];
      assert.ok(a.count > b.count || (a.count === b.count && a.minutes >= b.minutes), 'tersering: jumlah, lalu total waktu');
    }
    for (let i = 1; i < d.linesLong.length; i++) {
      const a = d.linesLong[i - 1], b = d.linesLong[i];
      assert.ok(a.minutes > b.minutes || (a.minutes === b.minutes && a.count >= b.count), 'terlama: total waktu, lalu jumlah');
    }
    assert.ok(d.linesLong.every(l => typeof l.name === 'string' && 'mttr' in l));
    d.linesFreq.concat(d.linesLong).forEach(l => assert.strictEqual(l.name, (ctx.masterData_().lines[l.key] || { name: '' }).name));
  });
  const R = ring(), mu = colL('Mulai'), li = colL('Line'), ak = colL('Total aktif (menit)'), st = colL('Status');
  const freq = findCell(R, /^5 line tersering/), long = findCell(R, /^5 line terlama/);
  assert.strictEqual(freq.r, long.r, 'berdampingan');
  assert.strictEqual(long.c - freq.c, 4, 'kiri B, kanan F');
  const fF = R.data[freq.r + 1][freq.c - 1], fL = R.data[long.r + 1][long.c - 1];
  assert.strictEqual(R.data[freq.r][freq.c - 1 + 2], 'Total (jam) 总时长');
  const base = "=IFERROR(QUERY(FILTER({'Maintenance'!" + li + '2:' + li + ",'Maintenance'!" + mu + '2:' + mu + ",'Maintenance'!" + ak + '2:' + ak +
    "},'Maintenance'!" + mu + '2:' + mu + ">=$K$2,'Maintenance'!" + mu + '2:' + mu + "<$K$3,'Maintenance'!" + st + '2:' + st + '<>"Cancelled"';
  assert.ok(fF.startsWith(base), fF.slice(0, 160));
  assert.ok(fF.includes('order by count(Col2) desc, sum(Col3)/60 desc limit 5'));
  assert.ok(fL.startsWith(base) && fL.includes('order by sum(Col3)/60 desc, count(Col2) desc limit 5'));
  // Google QUERY: setiap kolom ORDER BY harus persis ada di SELECT (diuji di Google Sheets asli: sum(Col3) ditolak jika SELECT berisi sum(Col3)/60)
  R.data.flat().concat(Object.values(R.formulas)).filter(f => typeof f === 'string' && f.includes('QUERY(')).forEach(f => {
    const q = /"select (.*?) group by .*? order by (.*?) limit/.exec(f);
    if (!q) return;
    const sel = q[1].split(',').map(x => x.trim());
    q[2].split(',').map(x => x.trim().replace(/ (desc|asc)$/, '')).forEach(o => assert.ok(sel.includes(o), 'ORDER BY ' + o + ' ada di SELECT: ' + sel.join(' | ')));
  });
});

test('2.5.1 tabel: Maintenance belang + filter + status berwarna; kolom teknis disembunyikan; aturan warna admin tetap; idempotent', () => {
  const M = ss.getSheetByName('Maintenance'), h = ctx.headers_(M);
  assert.strictEqual(M.bandings.length, 1);
  assert.ok(M.filter, 'filter di judul');
  jeq([...M.hidden].map(c => h[c - 1]).sort(), ['Direview oleh', 'Konfirmasi terakhir', 'Mesin ID', 'Peringatan pada', 'Status sejak', 'Teknisi awal', 'Teknisi terakhir', 'Teknisi terlibat']);
  const texts = M.cfRules.map(r => r.calls.whenTextEqualTo).filter(Boolean);
  for (const s of ['Aktif', 'Pause', 'Pending', 'Completed', 'Cancelled', 'Abandoned', 'Perlu review']) assert.ok(texts.includes(s), s);
  assert.ok(M.cfRules.some(r => /NOW\(\)/.test(r.calls.whenFormulaSatisfied || '')), 'tenggat lewat merah');
  const admin = { kind: 'cf', calls: { whenTextEqualTo: 'L01', setBackground: '#ABCDEF' } };
  admin.getBooleanCondition = () => ({ getBackground: () => '#ABCDEF', getFontColor: () => null });
  M.cfRules.push(admin);
  const n = M.cfRules.length;
  ctx.rapikanTampilan_({ full: true });
  assert.strictEqual(M.cfRules.length, n, 'tidak menumpuk');
  assert.ok(M.cfRules.includes(admin), 'aturan warna buatan admin dipertahankan');
  assert.strictEqual(M.bandings.length, 1);
  const U = ss.getSheetByName('Users'), uh = ctx.headers_(U);
  const dv = (name) => U.validations.filter(v => v.range.c === uh.indexOf(name) + 1).pop().rule.calls.requireValueInList[0];
  jeq(dv('Peran'), ['Teknisi', 'Admin']); jeq(dv('Aktif'), ['Ya', 'Tidak']); jeq(dv('Bahasa'), ['id', 'zh']);
  assert.ok(U.cfRules.some(r => /="Tidak"$/.test(r.calls.whenFormulaSatisfied || '')), 'baris nonaktif dipudarkan');
});

test('2.5.1 malam: tabel hanya disentuh jika baris sheet bertambah; Laporan & Rekap tetap berwarna setelah dibangun ulang', () => {
  const M = ss.getSheetByName('Maintenance');
  const before = M.bandings[0];
  ctx.rapikanTampilan_({});
  assert.strictEqual(M.bandings[0], before, 'tanpa baris baru: tidak diulang');
  M.getMaxRows = () => 1500;
  ctx.rapikanTampilan_({});
  assert.strictEqual(M.bandings[0].range.nr, 1500, 'belang diperluas ke baris baru');
  delete M.getMaxRows;
  ctx.buildLaporan_(2026);
  const L = ss.getSheetByName('Laporan 2026');
  assert.strictEqual(L.bandings.length, 1);
  jeq(L.cfRules.map(r => r.calls.whenTextEqualTo).sort(), ['Abandoned', 'Cancel', 'Dikerjakan', 'Pause', 'Pending', 'Selesai'], 'kolom Kondisi berwarna');
  ctx.buildRekap_(2026);
  assert.strictEqual(ss.getSheetByName('Rekap 2026').bandings.length, 1);
});

test('2.5.1 cache master: edit Ringkasan / Laporan tidak menghapus cache; sheet pengaturan & perubahan struktur tetap menghapus', () => {
  cache.enabled = true; cache.store = {};
  try {
    as('budi@gmail.com', () => ctx.apiBootstrap('', '', {}));
    const has = () => Object.keys(cache.store).some(k => /:n$/.test(k));
    assert.ok(has());
    ctx.onEdit({ range: ring().getRange(4, 3) });
    ctx.onEdit({ range: ss.getSheetByName('Laporan 2026').getRange(5, 2) });
    ctx.onMasterChange({ changeType: 'EDIT' });
    ctx.onMasterChange({ changeType: 'FORMAT' });
    assert.ok(has(), 'cache tetap → buka app tetap cepat');
    ctx.onMasterChange({ changeType: 'REMOVE_ROW', source: ss });
    assert.ok(!has(), 'hapus baris → cache dihapus (onChange tidak menyebut sheet-nya)');
    as('budi@gmail.com', () => ctx.apiBootstrap('', '', {}));
    ctx.onEdit({ range: ss.getSheetByName('Lines').getRange(2, 2) });
    assert.ok(!has(), 'edit Lines → cache dihapus');
    as('budi@gmail.com', () => ctx.apiBootstrap('', '', {}));
    ctx.onMasterChange({ changeType: 'REMOVE_GRID', source: ss });
    assert.ok(!has(), 'tab dihapus → cache dihapus');
  } finally { cache.enabled = false; }
});

test('2.6 tab pengaturan boleh diganti nama: aplikasi, setup, cache, Tampilan & Baca Saya mengikuti sheetId; tab baru bernama lama diabaikan', () => {
  const store = require('./mock').docProps.store;
  ctx.setup();
  const ids = JSON.parse(store.MTTR_SHEET_IDS);
  for (const n of ['Users', 'Lines', 'Pilihan', 'Form', 'Config', 'Projects', 'Sparepart']) assert.strictEqual(ids[n][0], ss.getSheetByName(n).getSheetId(), n + ' dicatat');
  assert.ok(!ids.Maintenance, 'tab buatan aplikasi tidak dicatat (nama tetap)');
  const lines = ss.getSheetByName('Lines'), users = ss.getSheetByName('Users'), nLines = lines.data.length;
  lines.setName('Daftar Line 产线'); users.setName('Pengguna');
  cache.enabled = true; cache.store = {};
  try {
    as('budi@gmail.com', () => {
      const b = ctx.apiBootstrap('L02', '', {});
      assert.strictEqual(b.user.name, 'Budi', 'Users dibaca dari tab "Pengguna"');
      assert.strictEqual(b.lineView.line.id, 'L02', 'Lines dibaca dari tab "Daftar Line 产线"');
    });
    assert.strictEqual(JSON.parse(store.MTTR_SHEET_IDS).Lines[1], 'Daftar Line 产线', 'nama baru dicatat (pencarian berikutnya 1 langkah)');
    const has = () => Object.keys(cache.store).some(k => /:n$/.test(k));
    assert.ok(has());
    ctx.onEdit({ range: lines.getRange(2, 2) });
    assert.ok(!has(), 'edit tab yang sudah diganti nama tetap menghapus cache');
    as('budi@gmail.com', () => ctx.apiBootstrap('', '', {}));
    ctx.onEdit({ range: ring().getRange(4, 3) });
    assert.ok(has(), 'Ringkasan tetap tidak menghapus cache');
  } finally { cache.enabled = false; }
  ctx.setup();
  assert.ok(!ss.getSheetByName('Lines') && !ss.getSheetByName('Users'), 'setup tidak membuat tab Lines / Users baru');
  assert.strictEqual(lines.data.length, nLines, 'data tidak berubah');
  const names = ss.getSheets().map(x => x.getName());
  assert.ok(names.indexOf('Pengguna') < names.indexOf('Daftar Line 产线') && !ss.getSheetByName('Pengguna').isSheetHidden(), 'urutan & tampil seperti sebelumnya');
  assert.strictEqual(lines.tabColor, ctx.TEMA_.tab.atur);
  assert.ok(lines.validations.length, 'dropdown Aktif tetap dipasang');
  assert.ok(findCell(ss.getSheetByName('Baca Saya'), /^Daftar Line 产线$/), 'Baca Saya menyebut nama tab yang baru');
  // admin membuat tab baru bernama "Lines" (mis. salinan): aplikasi tetap memakai tab yang tercatat
  const fake = ss.insertSheet('Lines');
  fake.data = [['Line ID', 'Nama Line', 'Aktif'], ['ZZ', 'Palsu', 'Ya']];
  ctx.invalidateMaster_();
  as('budi@gmail.com', () => assert.ok(ctx.apiBootstrap('L02', '', {}).lineView, 'tetap tab asli'));
  assert.ok(!ctx.masterData_().lines.ZZ);
  ss.deleteSheet(fake);
  // tab pengaturan ganti nama menjadi nama bawaan tab pengaturan lain → tidak tertukar
  const spare = ss.getSheetByName('Sparepart');
  spare.setName('Katalog');
  ctx.resetMaster_();
  lines.setName('Sparepart');
  ctx.resetMaster_();
  assert.strictEqual(ctx.findSheet_('Sparepart'), spare, 'Sparepart = tab yang tercatat, walau tab lain sekarang bernama "Sparepart"');
  assert.strictEqual(ctx.findSheet_('Lines'), lines);
  lines.setName('Lines'); users.setName('Users'); spare.setName('Sparepart');
  ctx.resetMaster_(); ctx.invalidateMaster_();
  assert.strictEqual(ctx.findSheet_('Lines'), lines);
  ctx.rapikanTampilan_({ full: true });
});

test('2.5.1 tampilan gagal tidak menggagalkan setup (pesan menyebut bagian yang gagal)', () => {
  const orig = ctx.buildBacaSaya_;
  ctx.buildBacaSaya_ = () => { throw new Error('uji gagal'); };
  try { assert.match(ctx.setup(), /^Setup selesai\. Tampilan belum lengkap: Baca Saya: uji gagal/); }
  finally { ctx.buildBacaSaya_ = orig; }
});

/** Koma di luar teks "…" dan nama sheet '…' (harus 0 di locale desimal koma). */
const bareCommas = (f) => { let q = false, sq = false, n = 0; for (const ch of f) { if (ch === '"' && !sq) q = !q; else if (ch === "'" && !q) sq = !sq; else if (!q && !sq && ch === ',') n++; } return n; };
test('2.5.1 locale: en_US → rumus koma; Indonesia (desimal koma) → ; dan \\ di Ringkasan, Pending Work, tab baterai & aturan warna (diuji di Google Sheets asli)', () => {
  ctx.FX_MODE_ = null;
  ctx.rapikanTampilan_({ full: true });
  assert.strictEqual(ctx.FX_MODE_, 'en');
  assert.strictEqual(cellOf(ring(), 'K1'), '=IF(ISNUMBER($C$4),INT($C$4),TODAY())');
  ss.locale = 'in_ID'; ctx.FX_MODE_ = null;
  try {
    ctx.buildDerivedSheets_(ss);
    ctx.rapikanTampilan_({ full: true });
    assert.strictEqual(ctx.FX_MODE_, 'koma', 'uji rumus: koma ditolak, titik koma diterima');
    const R = ring(), fs_ = [];
    R.data.forEach(row => row.forEach(v => { if (typeof v === 'string' && v[0] === '=') fs_.push(v); }));
    assert.ok(fs_.length > 60);
    assert.strictEqual(cellOf(R, 'K1'), '=IF(ISNUMBER($C$4);INT($C$4);TODAY())');
    jeq(fs_.filter(f => bareCommas(f)), [], 'tidak ada koma pemisah tersisa');
    assert.ok(fs_.some(f => /^=SORT\(\{"Elektrikal 电气"\\COUNTIFS\(/.test(f)), 'array: kolom dipisah \\');
    assert.ok(fs_.some(f => f.includes('"select Col1, count(Col2), sum(Col3)/60, avg(Col3) group by Col1 order by count(Col2) desc, sum(Col3)/60 desc limit 5')), 'teks QUERY tidak diubah');
    const pw = ss.getSheetByName('Pending Work').formulas.A2;
    assert.ok(pw.includes("{'Maintenance'!A2:A\\ ") && !bareCommas(pw), 'Pending Work: ' + pw.slice(0, 60));
    ctx.buildLaporan_(ctx.yearOf_(new FakeDate()));   // sidik berisi locale → tab per baterai ditulis ulang
    const fb = ss.getSheetByName('Maintenance VF7').data[2].filter(v => typeof v === 'string' && v[0] === '=');
    assert.ok(fb.length >= 2 && fb.every(f => !bareCommas(f) && f.includes(';')), 'tab baterai: ' + fb.join(' | '));
    const late = ss.getSheetByName('Maintenance').cfRules.map(r => r.calls.whenFormulaSatisfied).filter(Boolean);
    assert.ok(late.length && late.every(f => !bareCommas(f)), 'aturan warna: ' + late.join(' | '));
  } finally {
    ss.locale = 'en_US'; ctx.FX_MODE_ = null;
    ctx.buildDerivedSheets_(ss); ctx.rapikanTampilan_({ full: true }); ctx.buildLaporan_(ctx.yearOf_(new FakeDate()));
  }
});


// ---------- 2.5.2: Discipline & tab TPM (format Excel manager) ----------
const jkRows = () => ctx.readTable_('Pilihan').filter(r => r.Jenis === 'Jenis Kerusakan');
const atNilai = (v) => (r, h) => r[h.indexOf('Jenis')] === 'Jenis Kerusakan' && r[h.indexOf('Nilai')] === v;
const cfgSet = (k, v) => setRow('Config', (r, h) => r[h.indexOf('Key')] === k, 'Value', v);
const tpm = (bat) => ss.getSheetByName('TPM ' + bat);
/** Baris data B9:K (10 kolom) yang terisi. */
const tpmData = (bat) => tpm(bat).data.slice(8).filter(r => r[1] !== '' && r[1] != null).map(r => r.slice(1, 11));
const hasFmt = (sh, m, a1, arg) => sh.fmt.some(f => f[0] === m && f[1] === a1 && (arg === undefined || JSON.stringify(f[2]).includes(JSON.stringify(arg))));

test('2.5.2 setup: jenis kerusakan Operasional/Produk/MES + Discipline bawaan; baris hilang ditambah, Aktif = Tidak tetap mati, isi admin tidak ditimpa', () => {
  jeq(jkRows().map(r => r.Nilai + '=' + r.Discipline), ['Elektrikal=Machine', 'Mekanikal=Machine', 'Pneumatik=Machine', 'Program=Machine',
    'Operasional=Operation', 'Produk=Product Item', 'MES=MES']);
  assert.strictEqual(jkRows().find(r => r.Nilai === 'Produk')['Nilai (中文)'], '产品');
  assert.strictEqual(jkRows().find(r => r.Nilai === 'Produk')['Nilai (English)'], 'Product Item');
  // seperti spreadsheet 2.5.1: Produk & MES belum ada, Discipline kosong
  const P = ss.getSheetByName('Pilihan'), h = P.data[0];
  P.data = P.data.filter((r, i) => i === 0 || !(r[h.indexOf('Jenis')] === 'Jenis Kerusakan' && ['Produk', 'MES'].includes(r[h.indexOf('Nilai')])));
  setRow('Pilihan', atNilai('Operasional'), 'Aktif', 'Tidak');
  setRow('Pilihan', atNilai('Mekanikal'), 'Discipline', '');
  setRow('Pilihan', atNilai('Pneumatik'), 'Discipline', 'Operation');   // keputusan admin
  ctx.setup();
  const by = Object.fromEntries(jkRows().map(r => [r.Nilai, r]));
  jeq(jkRows().map(r => r.Nilai), ['Elektrikal', 'Mekanikal', 'Pneumatik', 'Program', 'Operasional', 'Produk', 'MES'], 'tidak dobel');
  assert.strictEqual(by.Operasional.Aktif, 'Tidak', 'dimatikan admin → tidak ditambah lagi');
  assert.ok(by.Produk.Urutan > by.Program.Urutan && by.MES.Urutan > by.Produk.Urutan, 'baris baru di bawah');
  assert.strictEqual(by.MES['Nilai (中文)'], 'MES', 'label bawaan ikut terisi');
  assert.strictEqual(by.Mekanikal.Discipline, 'Machine', 'sel kosong diisi bawaan');
  assert.strictEqual(by.Pneumatik.Discipline, 'Operation', 'isi admin tidak ditimpa');
  assert.ok(P.validations.some(v => JSON.stringify(v.rule.calls.requireValueInList || '').includes('Product Item')), 'dropdown Discipline');
  setRow('Pilihan', atNilai('Operasional'), 'Aktif', 'Ya');
  setRow('Pilihan', atNilai('Pneumatik'), 'Discipline', 'Machine');
  ctx.invalidateMaster_();
  const md = ctx.masterData_();
  assert.strictEqual(ctx.disciplineOf_(md, 'Produk'), 'Product Item');
  assert.strictEqual(ctx.disciplineOf_(md, 'Lainnya: hidrolik'), 'Machine', 'tidak dikenal → Machine');
  assert.ok(md.options['Jenis Kerusakan'].includes('MES'), 'bisa dipilih teknisi');
});

let T1, T2;
test('2.5.2 TPM: tab per project, judul & kotak Status Overview persis Excel manager, hanya Corrective selesai, sel "中文\\n(English)"', () => {
  U.appendRow(rowOf('Users', { Email: 'tono@gmail.com', Nama: 'Tono', Peran: 'Teknisi', Aktif: 'Ya' }));
  // 2.6: line = unit → "mesin" EOL Test adalah baris Lines sendiri (Machine di TPM = nama line 中文 + English)
  L.appendRow(lineRow(['L77', 'EOL Test', 'F1', 'VF7', '', 'Hall T', 'Ya'], { 'Nama (中文)': '电性能测试', 'Nama (English)': 'EOL Test' }));
  ss.getSheetByName('Projects').appendRow(rowOf('Projects', { 'Factory ID': 'F1', Baterai: 'Kosong', Aktif: 'Ya' }));
  setRow('Pilihan', (r, h) => r[h.indexOf('Nilai')] === 'Preventive', 'Aktif', 'Ya');   // data Preventive lama (admin menyalakan lagi)
  ctx.invalidateMaster_();
  as('tono@gmail.com', () => {
    T1 = ctx.apiStart('L77', { baterai: 'VF7' }).open.id;
    advance(20);
    const x = sel('Sensor error', { parts: [{ id: FUSE, qty: 2 }] });
    x.values['Detail masalah'] = 'Kabel putus di konektor';
    x.values['Catatan'] = 'Cek ulang besok';
    ctx.apiComplete(T1, x);
    const pv = ctx.apiStart('L77', { baterai: 'VF7', tipe: 'Preventive' }).open.id;   // Preventive: tidak masuk TPM
    advance(5);
    ctx.apiComplete(pv, sel('Kebocoran', { tanpaPart: true }));
  });
  setRow('Pilihan', (r, h) => r[h.indexOf('Nilai')] === 'Preventive', 'Aktif', 'Tidak');
  ctx.invalidateMaster_();
  as('li@gmail.com', () => {
    advance(30);
    T2 = ctx.apiStart('L77', { baterai: 'VF7' }).open.id;
    advance(15);
    ctx.apiComplete(T2, { values: { 'Jenis kerusakan': 'MES', Masalah: 'Lainnya', Penyebab: 'Setting berubah', Penanganan: 'Setting ulang' },
      other: { Masalah: '工单无法下发' }, tanpaPart: true, pics: ['tono@gmail.com'] });
  });
  const open = as('tono@gmail.com', () => ctx.apiStart('L77', { baterai: 'VF7' }).open.id);   // masih Aktif: tidak masuk
  LA.fail = false;
  const res = ctx.buildTpm_();
  const y = ctx.yearOf_(new FakeDate());
  jeq(res.sheets.map(s => s.sheet), ['TPM VF7', 'TPM Limo7', 'TPM E22H', 'TPM E245', 'TPM Kosong'], 'urutan sheet Projects');
  assert.strictEqual(ctx.Utilities.formatDate(res.from, 'Asia/Jakarta', 'dd/MM/yyyy'), '01/01/' + y, 'kosong = 1 Januari tahun ini');
  const S = tpm('VF7');
  jeq(S.data[7].slice(1, 11), ['No.序号', 'Machine', 'Issue Description \n问题描述', 'Root Cause\n原因分析', 'Solution\n解决方案\n', 'End Time\n解决时间',
    'Discipline\n范围', 'Responsibility处理人', 'Date', 'Notes'], 'judul kolom B8:K8 persis Excel');
  assert.strictEqual(cellOf(S, 'G1'), 'Status Overview');
  jeq(['G2', 'G3', 'G4', 'G5'].map(a => cellOf(S, a)), ['Machine', 'Operation', 'Product Item', 'MES']);
  jeq(['I2', 'I3', 'I4', 'I5'].map(a => cellOf(S, a)), ['Machine', 'Operation', 'Product Item', 'MES'], 'sumber dropdown Discipline');
  assert.strictEqual(cellOf(S, 'H2'), '=COUNTIF(H9:H,"Machine")');
  assert.strictEqual(cellOf(S, 'H5'), '=COUNTIF(H9:H,"MES")');
  assert.strictEqual(cellOf(S, 'D5'), 'Total tasks:');
  assert.strictEqual(S.formulas['5,6'], '=COUNT(B9:B)', 'jumlah tugas benar (contoh Excel: -3)');
  assert.strictEqual(cellOf(S, 'B3'), 'PROJECT NAME ATPU');
  assert.strictEqual(cellOf(S, 'B4'), 'VF7');
  assert.strictEqual(cellOf(S, 'B6'), 'Statistical Analysis of Issues Reported from Production');
  assert.strictEqual(S.frozenRows, 8, 'baris 1–8 dibekukan');
  assert.strictEqual(S.widths[4], 184);
  assert.ok(hasFmt(S, 'setBackground', '8,2:1x10', '#00B050'), 'judul hijau');
  assert.ok(hasFmt(S, 'setBackground', '2,7:1x2', '#FF0000') && hasFmt(S, 'setBackground', '5,7:1x2', '#00B0F0'));
  assert.ok(S.validations.some(v => v.rule.calls.requireValueInRange), 'dropdown Discipline dari I2:I5');

  const rows = tpmData('VF7');
  jeq(rows.map(r => r[0]), rows.map((_, i) => i + 1), 'No. urut');
  const mine = rows.filter(r => String(r[1]).includes('电性能测试'));
  assert.strictEqual(mine.length, 2, 'Preventive & yang masih Aktif tidak ikut');
  const [a, b] = mine;
  assert.ok(a[8] < b[8], 'urut waktu mulai');
  assert.strictEqual(a[1], '电性能测试\n(EOL Test)', 'Machine dari kolom Mesin 中文 / English');
  assert.strictEqual(a[2], '传感器故障：[zh-CN] Kabel putus di konektor\n(Sensor error: [en] Kabel putus di konektor)', 'pilihan dari label sheet, detail diterjemahkan');
  assert.strictEqual(a[3], '零件磨损\n(Worn component)');
  assert.strictEqual(a[4], '更换零件\n(Replace part)\n备件 Spare parts: Fuse 10A ×2', 'sparepart: satu baris di bawah Solution');
  assert.ok(a[5] instanceof FakeDate && a[5].getTime() === rec(T1).Selesai.getTime(), 'End Time = waktu selesai');
  assert.strictEqual(a[6], 'Machine', 'Elektrikal → Machine');
  assert.strictEqual(a[7], 'Tono');
  assert.ok(a[8] instanceof FakeDate && a[8].getTime() === rec(T1).Mulai.getTime(), 'Date = waktu mulai');
  assert.match(rec(T1).Catatan, /^\[\d\d\/\d\d \d\d:\d\d Tono\] Cek ulang besok$/);
  const hm = (d) => ctx.Utilities.formatDate(d, 'Asia/Jakarta', 'HH:mm'), dur = (r) => Math.round((r.Selesai - r.Mulai) / 60000);
  assert.strictEqual(a[9], '开始：' + hm(rec(T1).Mulai) + '，影响时长：' + dur(rec(T1)) + '分钟\n(Start: ' + hm(rec(T1).Mulai) + '; Downtime: ' + dur(rec(T1)) + ' min)\n' +
    '[zh-CN] Cek ulang besok\n([en] Cek ulang besok)', '2.6.1: Notes = mulai & downtime (format manager), lalu Catatan tanpa cap waktu');
  assert.strictEqual(b[2], '工单无法下发\n([en] 工单无法下发)', 'teks Mandarin tidak diterjemahkan ke 中文 lagi');
  assert.strictEqual(b[6], 'MES');
  assert.strictEqual(b[7], 'Li Wei, Tono', '2.6: Responsibility = semua PIC, termasuk PIC tambahan');
  assert.strictEqual(b[9].split('\n').length, 2, 'tanpa catatan: hanya mulai & downtime');
  assert.match(b[9], /^开始：\d\d:\d\d，影响时长：\d+分钟\n\(Start: \d\d:\d\d; Downtime: \d+ min\)$/);
  assert.ok(hasFmt(S, 'setNumberFormat', '9,7:' + rows.length + 'x1', 'h:mm') && hasFmt(S, 'setNumberFormat', '9,10:' + rows.length + 'x1', 'm"月"d"日"'), 'Date seperti Excel manager: 10月22日');
  assert.match(cellOf(tpm('Kosong'), 'D9'), /^Belum ada pekerjaan Corrective selesai sejak 01\/01\//, 'project tanpa data: tab tetap ada');
  assert.ok(!ss.getSheetByName('Maintenance').data.some(r => r[0] === open && r[3] !== 'Aktif'), 'data tidak diubah');

  assert.strictEqual(res.untranslated, 0, 'semua terjemahan berhasil → tidak ada peringatan');
  const calls = LA.calls;
  ctx.buildTpm_();
  assert.strictEqual(LA.calls, calls, 'dibangun ulang: terjemahan dari cache / sheet Terjemahan, tanpa Google lagi');
  assert.strictEqual(tpmData('VF7').length, rows.length, 'ditulis ulang, tidak menumpuk');
  as('tono@gmail.com', () => ctx.apiCancel(open, 'Input ganda'));
});

test('2.5.2 TPM: Discipline dari sheet Pilihan, TPM_MULAI & TPM_TIPE dari Config, label 中文 dari sheet dipakai, kuota habis → teks asli + peringatan', () => {
  setRow('Pilihan', atNilai('Elektrikal'), 'Discipline', 'operation');   // huruf kecil tetap dikenali
  setRow('Lines', (r, h) => r[h.indexOf('Line ID')] === 'L77', 'Nama (中文)', '电性能测试台');
  ctx.invalidateMaster_();
  let res = ctx.buildTpm_();
  const a = tpmData('VF7').find(r => String(r[2]).includes('Kabel putus'));
  assert.strictEqual(a[6], 'Operation');
  assert.strictEqual(a[1], '电性能测试台\n(EOL Test)', 'koreksi label langsung dipakai');
  const day = (ms) => ctx.Utilities.formatDate(new FakeDate(clock.now + ms), 'Asia/Jakarta', 'dd/MM/yyyy');
  cfgSet('TPM_MULAI', day(86400e3));
  ctx.invalidateMaster_();
  assert.strictEqual(ctx.buildTpm_().sheets.find(s => s.sheet === 'TPM VF7').rows, 0, 'TPM_MULAI besok → belum ada');
  cfgSet('TPM_MULAI', day(0));
  ctx.invalidateMaster_();
  assert.strictEqual(ctx.buildTpm_().sheets.find(s => s.sheet === 'TPM VF7').rows, 2, 'TPM_MULAI hari ini → pekerjaan hari ini ikut');
  cfgSet('TPM_TIPE', 'Corrective, Preventive');
  ctx.invalidateMaster_();
  assert.strictEqual(tpmData('VF7').length + 1, (ctx.buildTpm_(), tpmData('VF7').length), 'Preventive ikut jika diminta');

  setRow('Pilihan', atNilai('Elektrikal'), 'Discipline', 'Listrik');
  cfgSet('TPM_MULAI', 'besok');
  cfgSet('TPM_TIPE', 'Corrective');
  ctx.invalidateMaster_();
  assert.ok(ctx.masterData_().warnings.some(w => /Discipline "Listrik"/.test(w)), 'Discipline salah → peringatan');
  as('tono@gmail.com', () => {
    const id = ctx.apiStart('L77', { baterai: 'VF7' }).open.id;
    advance(10);
    const x = sel('Sensor error', { tanpaPart: true });
    x.values['Detail masalah'] = 'Relay panas berasap';
    ctx.apiComplete(id, x);
  });
  LA.fail = true;
  try { res = ctx.buildTpm_(); } finally { LA.fail = false; }
  assert.match(res.warn, /TPM_MULAI "besok"/, 'tanggal salah → peringatan, dipakai 1 Januari');
  assert.strictEqual(res.untranslated, 2, 'kuota habis: teks baru (zh + en) dihitung');
  const c = tpmData('VF7').find(r => String(r[2]).includes('Relay panas'));
  assert.strictEqual(c[2], '传感器故障：Relay panas berasap\n(Sensor error: Relay panas berasap)', 'teks asli, tetap terbaca');
  assert.strictEqual(c[6], 'Machine', 'Discipline salah → bawaan');
  const st = { left: 0 };
  ctx.translate_(['uji batas satu', 'uji batas dua', 'uji batas tiga'], 'zh', { max: 1, stats: st });
  assert.strictEqual(st.left, 2, 'melewati batas sekali jalan dihitung');
  const msg = ctx.tpmSummary_(res);
  assert.match(msg, /TPM VF7: \d+ baris/);
  assert.match(msg, /teks belum diterjemahkan/);
  assert.match(msg, /blok sel B9 sampai baris terakhir kolom K/);
  setRow('Pilihan', atNilai('Elektrikal'), 'Discipline', 'Machine');
  cfgSet('TPM_MULAI', '');
  ctx.invalidateMaster_();
});

test('2.5.2 TPM ikut: Dashboard "Perbarui Laporan, Rekap & TPM" (admin), trigger malam, menu spreadsheet, setup; rumus mengikuti locale', () => {
  as('dewi@gmail.com', () => throwsMsg(() => ctx.apiBuildReports(), /tidak punya akses/));
  const out = ctx.apiBuildReports();
  assert.ok(out.tpm.some(s => s.sheet === 'TPM VF7' && s.rows > 0) && out.tpmError === '', JSON.stringify(out.tpm));
  ss.deleteSheet(tpm('VF7'));
  ctx.refreshRekap();
  assert.ok(!tpm('VF7'), '2.6.1: tab yang dihapus admin tidak dibuat lagi oleh trigger malam');
  assert.strictEqual(ctx.getConfig_('TPM_DIMATIKAN'), 'VF7', 'dicatat di Config');
  assert.ok(ctx.readTable_('Log').some(e => e.Kejadian === 'tab dimatikan' && /TPM VF7/.test(e.Detail)), 'dicatat di Log');
  ctx.menuTpm();
  assert.ok(!tpm('VF7') && /TPM_DIMATIKAN\): VF7/.test(ui.alerts[ui.alerts.length - 1]), 'menu: tetap mati, pesan menyebut Config');
  cfgSet('TPM_DIMATIKAN', ''); ctx.invalidateMaster_();
  ctx.menuTpm();
  assert.ok(tpm('VF7') && /Tab TPM diperbarui/.test(ui.alerts[ui.alerts.length - 1]), 'nama dihapus dari Config → dibuat lagi');
  as('dewi@gmail.com', () => throwsMsg(() => ctx.menuTpm(), /tidak punya akses/));
  ss.locale = 'in_ID'; ctx.FX_MODE_ = null;
  try {
    ctx.buildTpm_();
    assert.strictEqual(cellOf(tpm('VF7'), 'H2'), '=COUNTIF(H9:H;"Machine")', 'locale Indonesia: pemisah ;');
  } finally { ss.locale = 'en_US'; ctx.FX_MODE_ = null; }
  // TPM gagal tidak menggagalkan Laporan & Rekap / setup
  const keep = ctx.buildTpm_;
  ctx.buildTpm_ = () => { throw new Error('uji gagal'); };
  try {
    assert.strictEqual(ctx.apiBuildReports().tpmError, 'uji gagal');
    assert.match(ctx.setup(), /TPM: uji gagal/);
  } finally { ctx.buildTpm_ = keep; }
  assert.strictEqual(ctx.setup(), 'Setup selesai.');
});

// ---------- 2.6: revisi uji lapangan ----------
const { docProps } = require('./mock');

test('2.6 migrasi dari 2.5.2: field mesin dimatikan, Preventive dimatikan sekali, Pending keluar dari review, peringatan sheet Mesin', () => {
  // keadaan spreadsheet 2.5.2: baris Form pilih mesin aktif, Preventive aktif, Pending "Perlu review", sheet Mesin berisi data
  const F = ss.getSheetByName('Form');
  F.appendRow(rowOf('Form', { Form: 'Mulai', Field: 'Mesin ID', Label: 'Mesin', Tipe: 'sistem', Wajib: 'Ya', 'Lainnya isi sendiri': 'Ya', Urutan: 1, Aktif: 'Ya' }));
  setRow('Pilihan', (r, h) => r[h.indexOf('Nilai')] === 'Preventive', 'Aktif', 'Ya');
  const M = ss.insertSheet('Mesin');
  M.appendRow(['Mesin ID', 'Nama Mesin', 'Line ID', 'Aktif', 'Nama (中文)', 'Nama (English)']);
  M.appendRow(['M-OVEN', 'Oven', 'L05-A', 'Ya', '烘箱', 'Oven']);
  let P;
  as('dewi@gmail.com', () => { P = ctx.apiStart('L11', { baterai: 'E245' }).open.id; ctx.apiPending(P, pend('Cek', 'Menunggu part', 'BESOK')); });
  setRow('Maintenance', (r, h) => r[0] === P, 'Status review', 'Perlu review');
  delete docProps.store.MTTR_2_6_OPTIONS;
  const msg = ctx.setup();
  assert.match(msg, /^Setup selesai\. Catatan: Sheet Mesin \(1 baris\) tidak dipakai lagi/);
  const formRow = ctx.readTable_('Form').find(r => r.Form === 'Mulai' && r.Field === 'Mesin ID');
  assert.strictEqual(formRow.Aktif, 'Tidak');
  assert.strictEqual(ctx.readTable_('Pilihan').find(r => r.Nilai === 'Preventive').Aktif, 'Tidak');
  assert.strictEqual(rec(P)['Status review'], '', 'Pending keluar dari antrean review');
  assert.strictEqual(rec(P).Status, 'Pending', 'data tidak diubah');
  assert.ok(ss.getSheetByName('Mesin').isSheetHidden(), 'tab Mesin disembunyikan, tidak dihapus');
  as('sari@gmail.com', () => assert.ok(!ctx.apiDashboard({}).warnings.some(w => /Mesin ID/.test(w)), 'baris Form lama tidak memicu peringatan'));
  // admin menyalakan Preventive lagi → setup berikutnya tidak mematikannya
  setRow('Pilihan', (r, h) => r[h.indexOf('Nilai')] === 'Preventive', 'Aktif', 'Ya');
  ctx.setup();
  assert.strictEqual(ctx.readTable_('Pilihan').find(r => r.Nilai === 'Preventive').Aktif, 'Ya', 'dimatikan sekali saja');
  setRow('Pilihan', (r, h) => r[h.indexOf('Nilai')] === 'Preventive', 'Aktif', 'Tidak');
  // data lama ber-mesin tetap terbaca: label 中文 mesin dari sheet Mesin lama
  ctx.invalidateMaster_();
  assert.strictEqual(ctx.masterData_().tr.zh['Oven'], '烘箱');
  as('dewi@gmail.com', () => { ctx.apiContinue(P, 'L11'); ctx.apiCancel(P, 'Input ganda'); });
  ss.deleteSheet(M);
});

// ---------- 2.6: KPI bulanan MTTR & MTBF ----------
const W = (y, mo, d, h, mi) => new FakeDate(Date.UTC(y, mo - 1, d, h - 7, mi || 0));   // jam WIB
test('2.6 KPI hitung: MTTR, downtime stop line, jam operasi (hari operasi, libur, KPI_MULAI, bulan berjalan), MTBF per Plant / Project / Line, target', () => {
  const warn = [];
  const days = (v) => ctx.parseHariOperasi_(v, warn).map(Number).join('');   // indeks 0 = Minggu
  assert.strictEqual(days(''), '1111111');
  assert.strictEqual(days('Sen-Min'), '1111111');
  assert.strictEqual(days('Sen - Sab'), '0111111');
  assert.strictEqual(days('Jum-Sen'), '1100011', 'rentang melewati Minggu');
  assert.strictEqual(days('1-5'), '0111110');
  assert.strictEqual(days('Senin, Rabu'), '0101000');
  assert.strictEqual(warn.length, 0);
  assert.strictEqual(days('libur saja'), '1111111');
  assert.match(warn[0], /HARI_OPERASI "libur saja" tidak dikenal/);

  const md = {
    lines: { A: { active: true, batteries: ['VF7'], name: 'Line A' }, B: { active: true, batteries: ['VF7', 'Limo7'], name: 'Line B' },
      C: { active: false, batteries: ['Limo7'], name: 'Line C' }, D: { active: false, batteries: ['VF7'], name: 'Line D' } },
    projects: [{ battery: 'VF7', target: 20, targetMtbf: 500 }, { battery: 'Limo7', target: null, targetMtbf: 500 }, { battery: 'VF7', target: 99, targetMtbf: null }]
  };
  const job = (line, bat, st, mttr, mulai, selesai, aktif, stop, extra) => Object.assign({ 'Maintenance ID': line + aktif, Line: line, Baterai: bat, Status: st,
    'Masuk MTTR': mttr, Mulai: mulai, Selesai: selesai || '', 'Status sejak': selesai || mulai, 'Total aktif (menit)': aktif, 'Stop line': stop }, extra || {});
  const rows = [
    job('A', 'VF7', 'Completed', 'Ya', W(2026, 9, 5, 9), W(2026, 9, 5, 10), 40, 'Ya'),                       // downtime 1 jam
    job('B', 'Limo7', 'Completed', 'Ya', W(2026, 9, 10, 10, 30), W(2026, 9, 10, 12), 60, 'Ya'),             // 1,5 jam
    job('B', 'VF7', 'Abandoned', 'Ya', W(2026, 9, 12, 8), '', 20, 'Ya', { 'Status sejak': W(2026, 9, 12, 12) }),   // dihitung admin, tanpa Selesai
    job('C', 'Limo7', 'Completed', 'Ya', W(2026, 9, 20, 8), W(2026, 9, 20, 9), 30, 'Tidak'),                // line nonaktif tapi rusak
    job('A', 'VF7', 'Completed', 'Tidak', W(2026, 9, 6, 8), W(2026, 9, 6, 9), 500, 'Ya'),                    // tidak masuk MTTR
    job('A', 'VF7', 'Cancelled', 'Tidak', W(2026, 9, 7, 8), '', 0, 'Ya', { 'Status sejak': W(2026, 9, 7, 9) }),
    job('A', 'VF7', 'Completed', 'Ya', W(2026, 9, 30, 23), W(2026, 10, 1, 0, 30), 700, 'Ya'),               // selesai 1 Okt WIB → Oktober
    job('A', 'VF7', 'Completed', 'Ya', W(2026, 8, 31, 23, 50), W(2026, 9, 1, 0, 30), 10, 'Tidak'),          // selesai 1 Sep WIB → September
    job('A', 'OLD', 'Completed', 'Ya', W(2026, 9, 15, 8), W(2026, 9, 15, 9), 20, 'Tidak')                    // project lama (tidak di sheet Projects)
  ];
  // September 2026: 30 hari, Minggu 6/13/20/27, libur Kamis 17 → Sen-Sab = 25 hari × 24 jam = 600 jam per line
  const s = { hours: 24, days: ctx.parseHariOperasi_('Sen-Sab', []), libur: { '2026-09-17': true }, mulai: '', warn: [] };
  const now = W(2026, 10, 22, 10);
  assert.strictEqual(ctx.kpiDays_(2026, 9, s, now), 25);
  assert.strictEqual(ctx.kpiDays_(2026, 10, s, now), 19, 'bulan berjalan: 1–22 Okt tanpa Minggu 4/11/18');
  assert.strictEqual(ctx.kpiDays_(2026, 11, s, now), 0, 'bulan depan');
  const k = ctx.computeKpi_(2026, 9, rows, md, s, now);
  const pick = (lv, key) => { const x = k.find(o => o.level === lv && o.kunci === key); assert.ok(x, lv + ' ' + key); return x; };
  const val = (x) => [x.kerusakan, x.mttr, x.downtime, x.jamOperasi, x.mtbf, x.targetMttr, x.targetMtbf, x.tercapai];
  // Plant: 6 kerusakan, aktif 180 → MTTR 30; downtime 2,5; line A,B (aktif) + C (rusak) = 3 × 600; MTBF (1800 − 2,5) / 6
  jeq(val(pick('Plant', 'PLANT')), [6, 30, 2.5, 1800, 299.58, null, null, '']);
  // VF7: baris 1, 3, 8 → MTTR 70/3; line A, B → 1200 jam; target MTTR 20 & MTBF 500 (baris Projects pertama) → keduanya gagal
  jeq(val(pick('Project', 'VF7')), [3, 23.33, 1, 1200, 399.67, 20, 500, '✗ MTTR & MTBF']);
  // Limo7: line B (aktif, juga melayani VF7 → dihitung penuh) + C (nonaktif tapi rusak) → 1200 jam
  jeq(val(pick('Project', 'Limo7')), [2, 45, 1.5, 1200, 599.25, null, 500, '✓']);
  jeq(val(pick('Project', 'OLD')), [1, 20, 0, 600, 600, null, null, ''], 'project yang sudah tidak ada tetap tampil (total cocok)');
  jeq(val(pick('Line', 'A')), [3, 23.33, 1, 600, 199.67, null, null, '']);
  jeq(val(pick('Line', 'C')), [1, 30, 0, 600, 600, null, null, '']);
  assert.strictEqual(pick('Line', 'A').nama, 'A · Line A');
  assert.ok(!k.find(o => o.kunci === 'D'), 'line nonaktif tanpa kerusakan tidak tampil');
  jeq(k.map(o => o.level), ['Plant', 'Project', 'Project', 'Project', 'Proses', 'Proses', 'Line', 'Line', 'Line'], '2.6.9: + Availability per proses + rata-rata');
  // tanpa kerusakan → MTBF kosong, target dianggap tercapai
  const none = ctx.computeKpi_(2026, 8, [], md, s, now).find(o => o.kunci === 'VF7');
  jeq(val(none), [0, null, 0, 26 * 24 * 2, null, 20, 500, '✓'], 'Agustus: 31 hari − 5 Minggu');
  // KPI_MULAI 10/09: hari & kerusakan sebelum tanggal itu tidak dihitung (10–30 Sep tanpa Minggu 13/20/27 & libur 17 = 17 hari)
  const s2 = Object.assign({}, s, { mulai: '2026-09-10' });
  assert.strictEqual(ctx.kpiDays_(2026, 9, s2, now), 17);
  jeq(val(ctx.computeKpi_(2026, 9, rows, md, s2, now, { levels: ['Plant'] })[0]).slice(0, 4), [4, 32.5, 1.5, 3 * 17 * 24]);
  assert.strictEqual(ctx.computeKpi_(2026, 9, rows, md, s, now, { levels: ['Plant', 'Project'] }).length, 4, 'Dashboard: tanpa level Line');
});

test('2.6.9 Availability per factory × proses: running hour sekali per proses, downtime semua line, rata-rata, > running hour = 0 %, ejaan proses', () => {
  const md = { prosesCanon: { modulline: 'Modul Line', packline: 'Pack Line', preassy: 'Pre-Assy' }, projects: [],
    lines: { A: { active: true, factory: 'F1', proses: 'Modul Line', batteries: [], name: 'A' }, B: { active: true, factory: 'F1', proses: 'Modul Line', batteries: [], name: 'B' },
      C: { active: true, factory: 'F1', proses: 'Pack Line', batteries: [], name: 'C' }, D: { active: true, factory: 'F2', proses: 'Pre-Assy', batteries: [], name: 'D' },
      E: { active: false, factory: 'F10', proses: 'Pack Line', batteries: [], name: 'E' } } };
  const job = (line, mulai, selesai, stop, extra) => Object.assign({ 'Maintenance ID': line + mulai.getTime(), Line: line, Baterai: '', Status: 'Completed', 'Masuk MTTR': 'Ya',
    Mulai: mulai, Selesai: selesai, 'Status sejak': selesai, 'Total aktif (menit)': 30, 'Stop line': stop }, extra || {});
  const rows = [
    job('A', W(2026, 9, 2, 8), W(2026, 9, 2, 14), 'Ya'),                                        // 6 jam
    job('B', W(2026, 9, 3, 8), W(2026, 9, 3, 12), 'Ya'),                                        // 4 jam → Modul Line F1 = 10 jam
    job('C', W(2026, 9, 4, 8), W(2026, 9, 4, 9), 'Tidak'),                                      // tanpa stop line → 0
    job('D', W(2026, 9, 5, 8), W(2026, 9, 5, 8, 30), 'Ya', { Proses: 'pre assy ', Factory: 'F2' }),   // ejaan lain → kelompok Pre-Assy
    job('E', W(2026, 9, 6, 0), W(2026, 9, 28, 0), 'Ya')                                         // 528 jam > running hour (nonaktif, tetap ada)
  ];
  // September 2026: 30 hari × 16 jam = 480 jam running hour per proses (sekali, tidak × jumlah line)
  const s = { hours: 16, days: ctx.parseHariOperasi_('', []), libur: {}, mulai: '', warn: [] }, now = W(2026, 10, 22, 10);
  const k = ctx.computeKpi_(2026, 9, rows, md, s, now), P = k.filter(x => x.level === 'Proses');
  jeq(P.map(x => x.nama), ['F1 · Modul Line', 'F1 · Pack Line', 'F2 · Pre-Assy', 'F10 · Pack Line', ctx.KPI_RATA_], 'urut natural: F2 sebelum F10, rata-rata di akhir');
  const av = (n) => P.find(x => x.nama === n);
  jeq([av('F1 · Modul Line').jamOperasi, av('F1 · Modul Line').downtime, av('F1 · Modul Line').availability, av('F1 · Modul Line').kerusakan], [480, 10, 97.9, 2], '(480 − 10) ÷ 480');
  assert.strictEqual(av('F1 · Pack Line').availability, 100);
  assert.strictEqual(av('F2 · Pre-Assy').availability, 99.9, 'Proses "pre assy " dari record → Pre-Assy');
  jeq([av('F10 · Pack Line').availability, av('F10 · Pack Line').lebih], [0, true], 'downtime > running hour → 0 % + tanda');
  const rata = av(ctx.KPI_RATA_);
  jeq([rata.kunci, rata.availability, rata.kerusakan, rata.downtime, rata.jamOperasi], ['RATA', Math.round((97.9 + 100 + 99.9 + 0) / 4 * 10) / 10, 5, 538.5, 4 * 480]);
  assert.strictEqual(k.find(x => x.level === 'Line' && x.kunci === 'A').availability, 98.8, 'per line: (480 − 6) ÷ 480');
  assert.strictEqual(k.find(x => x.level === 'Plant').availability, null, 'Plant / Project tanpa availability');
  assert.ok(!ctx.computeKpi_(2026, 9, [], { lines: {}, projects: [] }, s, now).some(x => x.level === 'Proses'), 'tanpa line & data → tanpa baris Proses');
});

test('2.6 KPI Config: jam operasi, hari operasi, tanggal libur (teks / sel tanggal), KPI_MULAI; salah isi → peringatan, bukan error', () => {
  const setCfg = (k, v) => { setRow('Config', (r, h) => r[h.indexOf('Key')] === k, 'Value', v); ctx.invalidateMaster_(); };
  let s = ctx.kpiSettings_();
  jeq([s.hours, s.days.every(Boolean), Object.keys(s.libur).length, s.mulai, s.warn], [24, true, 0, '', []], 'bawaan: 24 jam × setiap hari');
  setCfg('JAM_OPERASI_PER_HARI', '16,5'); setCfg('HARI_OPERASI', 'Sen-Jum'); setCfg('TANGGAL_LIBUR', '25/12/2026; 01/01/2027, 31/02/2026'); setCfg('KPI_MULAI', '15/10/2026');
  s = ctx.kpiSettings_();
  assert.strictEqual(s.hours, 16.5);
  assert.strictEqual(s.days.map(Number).join(''), '0111110');
  jeq(Object.keys(s.libur).sort(), ['2026-12-25', '2027-01-01']);
  assert.strictEqual(s.mulai, '2026-10-15');
  assert.match(s.warn.join(' '), /TANGGAL_LIBUR "31\/02\/2026": Tanggal tidak valid/);
  setCfg('TANGGAL_LIBUR', W(2026, 12, 25, 0)); setCfg('JAM_OPERASI_PER_HARI', 30); setCfg('KPI_MULAI', 'besok');
  s = ctx.kpiSettings_();
  jeq(Object.keys(s.libur), ['2026-12-25'], 'sel berisi tanggal (diubah Sheets jadi Date)');
  assert.strictEqual(s.hours, 24);
  assert.strictEqual(s.mulai, '');
  assert.match(s.warn.join(' '), /JAM_OPERASI_PER_HARI "30" harus 1–24/);
  assert.match(s.warn.join(' '), /KPI_MULAI "besok"/);
  ['JAM_OPERASI_PER_HARI', 'HARI_OPERASI', 'TANGGAL_LIBUR', 'KPI_MULAI'].forEach(k => setCfg(k, ''));
  assert.strictEqual(ctx.kpiSettings_().warn.length, 0);
  const cfgKeys = ctx.readTable_('Config').map(r => r.Key);
  ['JAM_OPERASI_PER_HARI', 'HARI_OPERASI', 'TANGGAL_LIBUR', 'KPI_MULAI'].forEach(k => assert.ok(cfgKeys.includes(k), k + ' ada di Config'));
  assert.ok(ctx.headers_(ss.getSheetByName('Projects')).includes('Target MTBF (jam)'));
});

test('2.6 KPI tab + tutup bulan: angka = Rekap, Dashboard, tutup → terkunci walau data diedit, tutup ulang tercatat, Ringkasan & menu', () => {
  ctx.setup();
  const target = (b, mtbf) => { setRow('Projects', (r, h) => r[h.indexOf('Baterai')] === b, 'Target MTBF (jam)', mtbf); ctx.invalidateMaster_(); };
  target('E22H', 100000);
  let J;
  as('budi@gmail.com', () => {
    J = ctx.apiStart('L01', { baterai: 'E22H' }).open.id;
    advance(25);
    ctx.apiComplete(J, { ...done, tanpaPart: true, parts: [] });
  });
  const ym = ctx.ymOf_(new FakeDate()), y = ctx.yearOf_(new FakeDate()), M = ctx.monthOf_(new FakeDate());
  assert.strictEqual(rec(J)['Stop line'], 'Ya', 'Corrective = stop line');
  const built = ctx.buildKpi_();
  assert.strictEqual(built.sheet, 'KPI ' + y);
  const K = ss.getSheetByName('KPI ' + y);
  assert.strictEqual(K.data[0][0], 'Bulan\n月份');
  assert.strictEqual(K.data[0][8], 'MTBF (jam)\n平均故障间隔（小时）', 'kolom I = MTBF (dipakai Ringkasan)');
  const plantRow = () => K.data.find(r => r[0] === ym && r[1] === 'Plant');
  const P0 = plantRow();
  assert.ok(P0, 'baris Plant bulan ini');
  assert.strictEqual(P0[11], 'Berjalan');
  assert.ok(hasFmt(K, 'setNumberFormat', '2,1:' + (K.data.length - 1) + 'x1', '@'), 'Bulan = teks');
  // jumlah & MTTR Plant = Rekap bulan itu
  const rekap = ctx.computeRekap_(y).months[M - 1];
  assert.strictEqual(P0[3], rekap.mttrN);
  near(P0[4], rekap.mttrSum / rekap.mttrN);
  const proj = K.data.find(r => r[0] === ym && r[1] === 'Project' && r[2] === 'E22H');
  assert.strictEqual(proj[9], 100000);
  assert.strictEqual(proj[10], '✗ MTBF', 'target MTBF tidak tercapai');
  assert.ok(K.data.some(r => r[0] === ym && r[1] === 'Line' && /^L01 · /.test(r[2])));
  assert.ok(K.cfRules.some(r => r.calls.whenTextStartsWith === '✗'), 'Tercapai berwarna');

  // Dashboard: KPI bulan berjalan (semua line, tidak ikut filter)
  as('budi@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 7, factory: 'F2' });
    assert.strictEqual(d.kpiMonth.bulan, ym);
    jeq(d.kpiMonth.rows.map(x => x.level).filter((v, i, a) => a.indexOf(v) === i), ['Plant', 'Project', 'Proses'], '2.6.9: + Availability per proses');
    assert.strictEqual(d.kpiMonth.rows[0].kerusakan, P0[3]);
    assert.strictEqual(d.kpiMonth.prev, undefined, 'teknisi: tanpa info tutup bulan');
    assert.ok(d.kpi.downtimeMin > 0 && d.kpi.stopN > 0, 'tile downtime');
    assert.strictEqual(d.kpi.preventive, undefined);
    throwsMsg(() => ctx.apiTutupBulan(ym), /tidak punya akses|Admin/);
  });
  as('owner@gmail.com', () => {
    throwsMsg(() => ctx.apiTutupBulan(ym), /belum berakhir/);
    throwsMsg(() => ctx.apiTutupBulan('2026-13'), /Bulan tidak valid/);
  });

  // pindah ke bulan berikutnya (hari ke-2)
  const nowMs = new FakeDate().getTime(), nextStart = Date.UTC(y, M, 1) - 7 * 3600e3;
  advance(Math.ceil((nextStart - nowMs) / 60000) + 36 * 60);
  assert.notStrictEqual(ctx.ymOf_(new FakeDate()), ym);
  ctx.invalidateMaster_();
  as('owner@gmail.com', () => {
    const d = ctx.apiDashboard({});
    assert.strictEqual(d.kpiMonth.prev.bulan, ym, 'admin diingatkan menutup bulan lalu');
    assert.strictEqual(d.kpiMonth.prev.closedIso, '');
    assert.strictEqual(typeof d.kpiMonth.prev.reviews, 'number');
    const res = ctx.apiTutupBulan(ym);
    assert.strictEqual(res.reclosed, false);
    assert.strictEqual(res.plant.kerusakan, P0[3]);
    assert.ok(ctx.apiDashboard({}).kpiMonth.prev.closedIso, 'sudah ditutup');
    const store = require('./mock').docProps.store;
    assert.ok(JSON.parse(store.MTTR_KPI_CLOSED)[ym], 'daftar bulan tertutup di DocumentProperties (Dashboard tanpa baca sheet KPI data)');
    delete store.MTTR_KPI_CLOSED;
    assert.ok(ctx.apiDashboard({}).kpiMonth.prev.closedIso, 'daftar hilang → dibangun ulang dari sheet KPI data');
    assert.ok(store.MTTR_KPI_CLOSED);
  });
  const Ky = ss.getSheetByName('KPI ' + y), P1 = Ky.data.find(r => r[0] === ym && r[1] === 'Plant');
  assert.match(P1[11], /^Ditutup \d\d\/\d\d\/\d{4} oleh owner$/);
  assert.ok(P1[7] >= P0[7], 'ditutup setelah bulan berakhir: jam operasi sebulan penuh');
  const snap = ctx.readTable_('KPI data').filter(r => r.Bulan === ym);
  assert.ok(snap.length >= 3 && snap.every(r => r['Ditutup oleh'] === 'owner@gmail.com'));
  assert.match(ctx.readTable_('Log').filter(e => e.Kejadian === 'tutup bulan').pop().Detail, new RegExp('^' + ctx.ymLabel_(ym) + ': ' + P0[3] + ' kerusakan, MTTR'));
  assert.ok(ss.getSheetByName('KPI data').protections.length, 'KPI data diproteksi');

  // data lama diedit setelah ditutup → KPI bulan itu tetap
  setRow('Maintenance', (r) => r[0] === J, 'Total aktif (menit)', 9999);
  ctx.buildKpi_(y);
  jeq(ss.getSheetByName('KPI ' + y).data.find(r => r[0] === ym && r[1] === 'Plant').slice(3, 11), P1.slice(3, 11), 'terkunci');
  // tutup ulang: angka baru + Log menyebut angka lama
  as('owner@gmail.com', () => assert.strictEqual(ctx.apiTutupBulan(ym).reclosed, true));
  assert.ok(ss.getSheetByName('KPI ' + y).data.find(r => r[0] === ym && r[1] === 'Plant')[4] > P0[4], 'angka baru dipakai');
  assert.match(ctx.readTable_('Log').filter(e => e.Kejadian === 'tutup bulan').pop().Detail, /ditutup ulang; sebelumnya .*: \d+ kerusakan/);
  assert.strictEqual(ctx.readTable_('KPI data').filter(r => r.Bulan === ym).length, snap.length, 'diganti, tidak menumpuk');
  setRow('Maintenance', (r) => r[0] === J, 'Total aktif (menit)', 25);

  // menu spreadsheet: kosong = bulan lalu; Cancel = tidak apa-apa
  ui.answers = [null];
  as('owner@gmail.com', () => ctx.menuTutupBulan());
  ui.answers = [''];
  as('owner@gmail.com', () => ctx.menuTutupBulan());
  assert.match(ui.alerts.pop(), new RegExp('^' + ctx.ymLabel_(ym) + ' ditutup ulang\\.'));
  ui.answers = [];

  // Ringkasan: Downtime & MTBF (dari tab KPI) menggantikan Corrective / Preventive
  ctx.rapikanTampilan_({});
  const R = ring(), dt = findCell(R, /^Downtime \(jam\)/), mb = findCell(R, /^MTBF \(jam\)/);
  assert.ok(dt && mb && !findCell(R, /^Preventive/));
  const se = colL('Selesai'), mu = colL('Mulai'), sl = colL('Stop line');
  assert.ok(R.data[dt.r][dt.c - 1].startsWith("=IFERROR(ROUND(SUM(FILTER('Maintenance'!" + se + '2:' + se + "-'Maintenance'!" + mu + '2:' + mu + ",'Maintenance'!" + sl + '2:' + sl + '="Ya"'));
  assert.strictEqual(R.data[mb.r][mb.c - 1], '=IFERROR(INDEX(FILTER(INDIRECT("\'KPI "&YEAR($K$2)&"\'!I2:I"),INDIRECT("\'KPI "&YEAR($K$2)&"\'!A2:A")=YEAR($K$2)&"-"&TEXT(MONTH($K$2),"00"),' +
    'INDIRECT("\'KPI "&YEAR($K$2)&"\'!B2:B")="Plant",INDIRECT("\'KPI "&YEAR($K$2)&"\'!I2:I")<>""),1),"–")');
  assert.ok(findCell(R, /^Target MTBF/), 'tabel project: kolom MTBF & target MTBF');
  assert.ok(findCell(ss.getSheetByName('Baca Saya'), new RegExp('^KPI ' + y + '$')), 'Baca Saya menjelaskan tab KPI');
  target('E22H', '');
});

test('2.6 Statistik: sama dengan KPI (MTTR / downtime / MTBF), Pareto %, lihat per teknisi (semua PIC) / sparepart / bulan, tap batang → daftar, batas', () => {
  const now = new FakeDate(), ymd = (d) => ctx.ymdOf_(d);
  const y = ctx.yearOf_(now), M = ctx.monthOf_(now), py = M === 1 ? y - 1 : y, pm = M === 1 ? 12 : M - 1;
  const pk = ctx.ymKey_(py, pm), last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const month = { from: pk + '-01', to: pk + '-' + String(last).padStart(2, '0') };
  const kpi = ctx.computeKpi_(py, pm, ctx.rekapRows_(py), ctx.masterData_(), ctx.kpiSettings_(), now);
  as('budi@gmail.com', () => {
    const st = ctx.apiStats({ ...month, by: 'project', measure: 'mtbf' });
    assert.ok(st.groups.length);
    st.groups.forEach(g => {
      const k = kpi.find(x => x.level === 'Project' && x.kunci === g.key);
      jeq([g.n, g.mttr, g.downtime, g.jamOperasi, g.mtbf], [k.kerusakan, k.mttr, k.downtime, k.jamOperasi, k.mtbf], 'project ' + g.key + ' = KPI');
    });
    const plant = kpi.find(x => x.level === 'Plant');
    jeq([st.total.n, st.total.mttr, st.total.downtime, st.total.jamOperasi, st.total.mtbf], [plant.kerusakan, plant.mttr, plant.downtime, plant.jamOperasi, plant.mtbf], 'total = Plant');
    for (let i = 1; i < st.groups.length; i++) assert.ok(st.groups[i - 1].mtbf <= st.groups[i].mtbf, 'MTBF: terburuk dulu');
    const ln = ctx.apiStats({ ...month, by: 'line', measure: 'mtbf' }).groups[0];
    const kl = kpi.find(x => x.level === 'Line' && x.kunci === ln.key);
    jeq([ln.n, ln.mtbf, ln.jamOperasi], [kl.kerusakan, kl.mtbf, kl.jamOperasi], 'line = KPI');

    const from = ymd(new FakeDate(now.getTime() - 700 * 86400000)), to = ymd(now);
    const fr = ctx.apiStats({ from, to, by: 'line', measure: 'frek' });
    assert.strictEqual(fr.pareto, true);
    assert.strictEqual(fr.groups.reduce((a, g) => a + g.n, 0) + 0, fr.more ? fr.groups.reduce((a, g) => a + g.n, 0) : fr.total.n, 'jumlah per line = total');
    assert.strictEqual(fr.groups[fr.groups.length - 1].cum, fr.more ? fr.groups[fr.groups.length - 1].cum : 100, 'Pareto berakhir 100%');
    for (let i = 1; i < fr.groups.length; i++) assert.ok(fr.groups[i - 1].value >= fr.groups[i].value && fr.groups[i - 1].cum <= fr.groups[i].cum);
    assert.strictEqual(ctx.apiStats({ from, to, by: 'line', measure: 'mttr' }).pareto, false, 'rata-rata: tanpa Pareto');
    // teknisi: pekerjaan bersama dihitung untuk setiap PIC (PIC tambahan 2.6)
    const tk = ctx.apiStats({ from, to, by: 'teknisi', measure: 'frek' });
    assert.ok(tk.groups.reduce((a, g) => a + g.n, 0) > tk.total.n, 'satu pekerjaan, beberapa teknisi');
    assert.ok(tk.groups.find(g => g.key === 'tono@gmail.com' && g.label === 'Tono'), 'PIC tambahan (TPM: Li + Tono)');
    // sparepart: nilai = jumlah dipakai
    const sp = ctx.apiStats({ from, to, by: 'sparepart', measure: 'mtbf' });
    assert.strictEqual(sp.measure, 'frek', 'sparepart: hanya jumlah');
    const fuse = sp.groups.find(g => g.key === 'Fuse 10A');
    assert.ok(fuse && fuse.value === fuse.qty && fuse.qty >= fuse.n);
    // per bulan: kronologis, bulan kosong tetap ada
    const bl = ctx.apiStats({ from, to, by: 'bulan', measure: 'frek' });
    assert.strictEqual(bl.groups[0].key, from.slice(0, 7));
    assert.strictEqual(bl.groups[bl.groups.length - 1].key, to.slice(0, 7));
    for (let i = 1; i < bl.groups.length; i++) assert.ok(bl.groups[i].key > bl.groups[i - 1].key);
    assert.strictEqual(bl.groups.reduce((a, g) => a + g.n, 0), bl.total.n);
    // tap batang → daftar pekerjaan
    const g0 = fr.groups[0], it = ctx.apiStatsItems({ from, to, by: 'line' }, g0.key);
    assert.strictEqual(it.total, g0.n);
    assert.ok(it.items.every(x => x.line === g0.key));
    const fusesJobs = ctx.apiStatsItems({ from, to, by: 'sparepart' }, 'Fuse 10A');
    assert.strictEqual(fusesJobs.total, fuse.n);
    // filter Dashboard ikut
    const f1 = ctx.apiStatsItems({ from, to, by: 'project', factory: 'F1' }, 'VF7');
    assert.ok(f1.items.every(x => x.factory === 'F1'));
    // batas & salah isi
    throwsMsg(() => ctx.apiStats({ from, to, by: 'hari' }), /maksimal 3 bulan/);
    throwsMsg(() => ctx.apiStats({ from, to, by: 'teknisi', measure: 'mtbf' }), /MTBF hanya bisa dilihat per line, proses, atau project/);
    throwsMsg(() => ctx.apiStats({ from: to, to: from }), /sesudah tanggal/);
    throwsMsg(() => ctx.apiStats({ from: '2026-02-30', to }), /Tanggal tidak valid: 2026-02-30/);
    throwsMsg(() => ctx.apiStats({ from: '2020-01-01', to }), /maksimal 2 tahun/);
    const hr = ctx.apiStats({ ...month, by: 'hari', measure: 'downtime' });
    assert.strictEqual(hr.groups.length, last, 'satu batang per hari');
  });
});

test('2.6 Download Riwayat: kolom tab Laporan, teknisi hanya pekerjaannya, admin semua, Cancelled hanya jika dipilih, tanggal asli, batas baris', () => {
  const now = new FakeDate(), from = ctx.ymdOf_(new FakeDate(now.getTime() - 700 * 86400000)), to = ctx.ymdOf_(now);
  const cols = ctx.masterData_().report.map(c => c.kolom);
  const mine = as('budi@gmail.com', () => ctx.apiExport({ from, to }));
  jeq(mine.columns.map(c => c.name), cols, 'kolom = Format Laporan');
  const idCol = mine.columns.findIndex(c => c.source === 'Maintenance ID');
  const maint = ctx.readTable_('Maintenance');
  const ids = (res) => res.rows.map(r => idCol >= 0 ? r[idCol] : null);
  assert.ok(mine.total > 0);
  if (idCol >= 0) assert.ok(ids(mine).every(id => ctx.isInvolved_(maint.find(r => r['Maintenance ID'] === id), 'budi@gmail.com')), 'teknisi: hanya yang ia ikuti');
  const notAll = as('budi@gmail.com', () => ctx.apiExport({ from, to, scope: 'all' }));
  assert.strictEqual(notAll.total, mine.total, 'teknisi tidak bisa scope all');
  const all = as('owner@gmail.com', () => ctx.apiExport({ from, to, scope: 'all' }));
  assert.ok(all.total > mine.total);
  const nonCancel = maint.concat(ss.getSheetByName('Arsip 2026') ? ctx.readTable_('Arsip 2026') : []).filter(r => r.Status !== 'Cancelled' && r.Mulai >= ctx.statsRange_({ from, to }).from);
  assert.strictEqual(all.total, new Set(nonCancel.map(r => r['Maintenance ID'])).size, 'semua kecuali Cancelled');
  const canc = as('owner@gmail.com', () => ctx.apiExport({ from, to, scope: 'all', status: 'Cancelled' }));
  assert.ok(canc.total > 0 && canc.total === maint.filter(r => r.Status === 'Cancelled').length, 'Cancelled jika dipilih');
  const tg = all.columns.findIndex(c => c.source === 'Tanggal');
  assert.ok(tg >= 0 && all.rows.every(r => r[tg] && typeof r[tg].d === 'string'), 'tanggal dikirim sebagai tanggal (bukan teks)');
  assert.ok(all.rows.every(r => r.every(v => typeof v !== 'object' || v === null || typeof v.d === 'string')));
  const lim = ctx.APP.EXPORT_LIMIT;
  ctx.APP.EXPORT_LIMIT = 3;
  try {
    const cut = as('owner@gmail.com', () => ctx.apiExport({ from, to, scope: 'all' }));
    assert.strictEqual(cut.rows.length, 3);
    assert.strictEqual(cut.truncated, true);
    assert.strictEqual(cut.total, all.total);
  } finally { ctx.APP.EXPORT_LIMIT = lim; }
  const day = as('owner@gmail.com', () => ctx.apiExport({ from: to, to, scope: 'all' }));
  assert.ok(day.rows.length <= all.rows.length);
  throwsMsg(() => as('owner@gmail.com', () => ctx.apiExport({})), /Pilih periode/);
});

test('2.6.1 terjemahan Inggris: teks Indonesia & 中文 tidak digabung dalam satu panggilan; bahasa asal selalu disebut (temuan uji Apps Script asli)', () => {
  LA.log = [];
  const src = ['Kabel sensor putus di konektor 261', '传送带打滑 261', 'lampu indikator mati 261', 'Timing belt putus 261'];
  const out = as('budi@gmail.com', () => ctx.apiTranslate(src, 'en'));
  jeq(out, src.map(t => '[en] ' + t), 'semua diterjemahkan, termasuk teks Indonesia');
  assert.ok(LA.log.length >= 2, 'satu panggilan per bahasa asal');
  LA.log.forEach(c => {
    assert.ok(c.src === 'id' || c.src === 'zh-CN', 'bahasa asal disebut: ' + JSON.stringify(c));
    const lines = c.text.split('\n'), han = lines.filter(l => /[㐀-鿿]/.test(l)).length;
    assert.ok(han === 0 || han === lines.length, 'tidak campur: ' + c.text);
  });
  // TPM: kolom English untuk detail berbahasa Indonesia benar-benar diterjemahkan, walau ada teks 中文 di pembangunan yang sama
  const T = ctx.readTable_('Terjemahan');
  assert.ok(!T.some(r => /^\[en\] /.test(String(r.zh))), 'tidak ada hasil Inggris di kolom 中文');
  const hdr = T.length ? Object.keys(T[0]) : [];
  assert.ok(hdr.indexOf('en') !== -1);
  const dup = {}; T.forEach(r => { dup[r.Teks] = (dup[r.Teks] || 0) + 1; });
  assert.ok(!Object.keys(dup).some(k => dup[k] > 1 && /261$/.test(k)), 'zh lalu en untuk teks yang sama = satu baris Terjemahan');
  // setelah migrasi: ratusan baris lama mendapat Inggris baru → satu tulisan per kolom, bukan per sel
  const tsh = ss.getSheetByName('Terjemahan'), many = Array.from({ length: 40 }, (_, i) => 'baris lama nomor ' + i + ' 261');
  many.forEach(t => tsh.appendRow(rowOf('Terjemahan', { Teks: t, 'Bahasa asal': 'id', zh: '旧' + t, Sumber: 'Google' })));
  ctx.TR_MEMO_ = null;
  const RP = Object.getPrototypeOf(tsh.getRange(1, 1)), orig = { v: RP.setValue, vs: RP.setValues };
  let writes = 0;
  RP.setValue = function () { writes++; return orig.v.apply(this, arguments); };
  RP.setValues = function () { writes++; return orig.vs.apply(this, arguments); };
  try { ctx.translate_(many, 'en', { max: 300 }); } finally { RP.setValue = orig.v; RP.setValues = orig.vs; }
  assert.ok(writes <= 3, writes + ' tulisan untuk 40 baris');
  const T2 = ctx.readTable_('Terjemahan');
  assert.ok(many.every(t => T2.find(r => r.Teks === t).en === '[en] ' + t), 'Inggris masuk ke baris yang sama');
  assert.strictEqual(T2.filter(r => /^baris lama nomor/.test(r.Teks)).length, 40, 'tidak ada baris baru');
});

test('2.6.1 setup: terjemahan Inggris lama dari Google untuk teks Indonesia dikosongkan sekali; koreksi admin & arah lain tetap', () => {
  const sh = ss.getSheetByName('Terjemahan');
  const add = (o) => sh.appendRow(rowOf('Terjemahan', o));
  add({ Teks: 'lampu indikator mati X', 'Bahasa asal': 'id', zh: '指示灯熄灭', en: 'Laminator mati', Sumber: 'Google' });
  add({ Teks: 'pintu safety X', 'Bahasa asal': 'id', en: 'pintu safety X', Sumber: 'Google' });          // baris khusus Inggris lama
  add({ Teks: 'selang bocor X', 'Bahasa asal': 'id', en: 'Leaking hose (koreksi)', Sumber: 'Admin' });
  add({ Teks: '传送带打滑 X', 'Bahasa asal': 'zh', en: 'Conveyor belt slippage', Sumber: 'Google' });
  delete docProps.store.MTTR_TR_EN_261;
  const msg = as('owner@gmail.com', () => ctx.setup());
  assert.match(msg, /terjemahan Inggris lama \(tab Terjemahan\) dikosongkan/);
  const T = () => ctx.readTable_('Terjemahan'), row = (t) => T().find(r => r.Teks === t);
  assert.strictEqual(row('lampu indikator mati X').en, '', 'hasil Google lama dikosongkan');
  assert.strictEqual(row('lampu indikator mati X').zh, '指示灯熄灭', '中文 tidak disentuh');
  assert.ok(!row('pintu safety X'), 'baris yang jadi kosong dibuang');
  assert.strictEqual(row('selang bocor X').en, 'Leaking hose (koreksi)', 'koreksi admin tetap');
  assert.strictEqual(row('传送带打滑 X').en, 'Conveyor belt slippage', 'dari 中文 sudah benar → tetap');
  assert.ok(docProps.store.MTTR_TR_EN_261, 'penanda migrasi');
  sh.appendRow(rowOf('Terjemahan', { Teks: 'baru X', 'Bahasa asal': 'id', en: '[en] baru X', Sumber: 'Google' }));
  assert.doesNotMatch(as('owner@gmail.com', () => ctx.setup()), /terjemahan Inggris lama/, 'hanya sekali');
  assert.strictEqual(row('baru X').en, '[en] baru X', 'terjemahan sesudah 2.6.1 tidak dikosongkan lagi');
});

test('2.6.1 Users: email ditulis dua kali → peran & nama dari baris yang sama (aktif pertama), peringatan di Dashboard & setup', () => {
  const U = ss.getSheetByName('Users'), n0 = U.data.length;
  U.appendRow(rowOf('Users', { Email: 'budi@gmail.com', Nama: 'Budi Dobel', Peran: 'Admin', Aktif: 'Ya' }));
  ctx.invalidateMaster_();
  try {
    const first = ctx.readTable_('Users').find(r => r.Email === 'budi@gmail.com');
    const me = as('budi@gmail.com', () => ctx.getCurrentUser_());
    assert.strictEqual(me.role, ctx.APP.ROLE_ALIASES[String(first.Peran).toLowerCase()], 'peran dari baris pertama');
    assert.strictEqual(me.name, first.Nama);
    assert.strictEqual(ctx.userNameMap_()['budi@gmail.com'], first.Nama, 'nama dari baris yang sama dengan peran');
    const w = as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 })).warnings;
    assert.ok(w.some(x => /^Users: email budi@gmail.com ditulis lebih dari sekali/.test(x)), 'peringatan di Dashboard admin');
    assert.match(as('owner@gmail.com', () => ctx.setup()), /Users: email budi@gmail.com/);
    const people = as('budi@gmail.com', () => ctx.apiBootstrap('')).master.people.filter(p => p.email === 'budi@gmail.com');
    assert.strictEqual(people.length, 1, 'pilihan PIC tidak dobel');
    setRow('Users', (r, h) => r[h.indexOf('Email')] === 'budi@gmail.com' && r[h.indexOf('Nama')] === first.Nama, 'Aktif', 'Tidak');
    ctx.invalidateMaster_();
    const now = as('budi@gmail.com', () => ctx.getCurrentUser_());
    assert.ok(now.authorized && now.role === 'Admin' && now.name === 'Budi Dobel', 'baris lama nonaktif → baris aktif berikutnya dipakai');
    assert.strictEqual(ctx.userNameMap_()['budi@gmail.com'], 'Budi Dobel');
  } finally {
    setRow('Users', (r, h) => r[h.indexOf('Email')] === 'budi@gmail.com', 'Aktif', 'Ya');
    U.data.splice(n0);
    ctx.invalidateMaster_();
  }
  assert.strictEqual(as('budi@gmail.com', () => ctx.getCurrentUser_()).name, ctx.readTable_('Users').find(r => r.Email === 'budi@gmail.com').Nama);
});

test('2.6.1 tab Maintenance <baterai> = Laporan per project: sama dengan Laporan, malam tanpa tulis ulang, format berubah → dibangun ulang', () => {
  const y = ctx.yearOf_(new FakeDate()), lap = ss.getSheetByName('Laporan ' + y);
  ctx.buildLaporan_(y);
  const B = ss.getSheetByName('Maintenance VF7'), cols = ctx.masterData_().report;
  jeq(B.data[1], lap.data[1].slice(0, cols.length), 'header sama');
  const tg = cols.findIndex(c => c.sumber === 'Tanggal') + 1;
  const n = lap.data.slice(2).filter(r => r[2] === 'VF7').length;
  assert.ok(hasFmt(B, 'setNumberFormat', '3,' + tg + ':' + (n + ctx.LAP_SPARE_) + 'x1', 'dd/mm/yyyy'), 'Tanggal dd/mm/yyyy');
  assert.ok(B.getBandings().length === 1 && B.tabColor === ctx.TEMA_.tab.laporan, 'belang & warna tab seperti Laporan');
  const w0 = B.formulaWrites || 0;
  ctx.refreshRekap();
  assert.strictEqual(ss.getSheetByName('Maintenance VF7').formulaWrites || 0, w0, 'malam: tidak ada yang berubah → tidak ditulis ulang');
  // Format Laporan diubah admin → sidik beda → dibangun ulang dengan judul kolom baru
  const stName = ctx.readTable_('Format Laporan').find(r => r.Sumber === 'Station').Kolom;
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Station', 'Kolom', 'Station 工位 (uji)');
  ctx.invalidateMaster_();
  ctx.buildLaporan_(y);
  assert.ok(ss.getSheetByName('Maintenance VF7').data[1].includes('Station 工位 (uji)'), 'judul kolom ikut');
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Project', 'Aktif', 'Tidak');
  ctx.invalidateMaster_(); ctx.buildLaporan_(y);
  assert.match(String(ss.getSheetByName('Maintenance VF7').data[2][0]), /Aktifkan kolom Project/, 'tanpa kolom Project → pesan, bukan rumus salah');
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Project', 'Aktif', 'Ya');
  setRow('Format Laporan', (r, h) => r[h.indexOf('Sumber')] === 'Station', 'Kolom', stName);
  ctx.invalidateMaster_(); ctx.buildLaporan_(y);
  assert.match(String(ss.getSheetByName('Maintenance VF7').data[2][1]), /^=IFERROR\(FILTER\(/);
  assert.ok(ss.getSheetByName('Maintenance VF7').data[1].includes(stName), 'Format Laporan dikembalikan');
});

test('2.6.1 tab per project boleh dihapus / dimatikan: TPM & Maintenance <baterai> tidak dibuat lagi, Config + Log, nyalakan lagi, "Semua", nama salah', () => {
  const bat = (b) => ss.getSheetByName('Maintenance ' + b);
  ctx.setup();
  ss.deleteSheet(bat('E245'));
  ctx.refreshRekap();
  assert.ok(!bat('E245'), 'dihapus → tidak dibuat lagi');
  assert.strictEqual(ctx.getConfig_('TAB_BATERAI_DIMATIKAN'), 'E245');
  assert.ok(ctx.readTable_('Log').some(e => e.Kejadian === 'tab dimatikan' && /Maintenance E245/.test(e.Detail)));
  ctx.setup();
  assert.ok(!bat('E245'), 'setup juga tidak membuatnya lagi');
  cfgSet('TAB_BATERAI_DIMATIKAN', 'E245, limo7'); ctx.invalidateMaster_();
  ctx.buildLaporan_(ctx.yearOf_(new FakeDate()));
  assert.ok(!bat('Limo7') && bat('VF7'), 'diisi manual (huruf kecil) → tab buatan aplikasi dihapus');
  cfgSet('TAB_BATERAI_DIMATIKAN', ''); ctx.invalidateMaster_();
  ctx.refreshRekap();
  assert.ok(bat('E245') && bat('Limo7'), 'nama dihapus dari Config → dibuat lagi');
  // tab yang diganti nama admin = salinan miliknya: tidak disentuh
  bat('E22H').setName('Salinan E22H');
  ctx.refreshRekap();
  assert.ok(ss.getSheetByName('Salinan E22H') && !bat('E22H') && ctx.getConfig_('TAB_BATERAI_DIMATIKAN') === 'E22H');
  ss.deleteSheet(ss.getSheetByName('Salinan E22H'));
  cfgSet('TAB_BATERAI_DIMATIKAN', ''); ctx.invalidateMaster_(); ctx.refreshRekap();
  assert.ok(bat('E22H'));
  // TPM "Semua": tanpa baca data & tanpa Google Translate, semua tab TPM dihapus
  cfgSet('TPM_DIMATIKAN', 'Semua'); ctx.invalidateMaster_();
  LA.calls = 0;
  const res = ctx.buildTpm_();
  assert.ok(res.off && !res.sheets.length && LA.calls === 0, 'mati total');
  assert.ok(!ss.getSheets().some(s => /^TPM /.test(s.getName())), 'tab TPM dihapus');
  assert.match(ctx.tpmSummary_(res), /TPM_DIMATIKAN = Semua/);
  cfgSet('TPM_DIMATIKAN', 'VF 7'); ctx.invalidateMaster_();
  assert.ok(as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 })).warnings.some(x => /TPM_DIMATIKAN: project "VF 7" tidak ada/.test(x)), 'salah ketik → peringatan');
  cfgSet('TPM_DIMATIKAN', ''); ctx.invalidateMaster_();
  ctx.buildTpm_();
  ['VF7', 'Limo7', 'E22H', 'E245'].forEach(b => assert.ok(tpm(b), 'TPM ' + b + ' kembali'));
});

test('2.6.1 Laporan mudah dibaca: sparepart ①② (1 part tanpa nomor), Catatan tanpa cap, jam teks, rata & tanpa pindah baris, lebar sekali per format', () => {
  const y = ctx.yearOf_(new FakeDate());
  let id;
  as('dewi@gmail.com', () => {
    id = ctx.apiStart('L10', { baterai: 'E22H' }).open.id;
    advance(25);
    const x = sel('Sensor error', { parts: [{ id: FUSE, qty: 2 }, { manual: true, jenis: 'Mekanikal', nama: 'Bearing', model: '6205', qty: 1 }] });
    x.values.Catatan = 'Cek lagi minggu depan';
    ctx.apiComplete(id, x);
  });
  ctx.buildLaporan_(y);
  const a = lapRow(y, r => r._id === id)[0];
  assert.strictEqual(a['Nama Sparepart'], '① Fuse\n② Bearing');
  assert.strictEqual(a['Model Sparepart'], '① 10A\n② 6205');
  assert.strictEqual(a['Jumlah Sparepart'], '① 2\n② 1');
  assert.strictEqual(a['Catatan'], 'Cek lagi minggu depan', 'tanpa [dd/MM HH:mm Nama]');
  assert.match(rec(id).Catatan, /^\[\d\d\/\d\d \d\d:\d\d Dewi\] Cek lagi minggu depan$/, 'cap tetap di Maintenance');
  const one = lapRow(y, r => r['Nama Sparepart'] && !/①/.test(r['Nama Sparepart']))[0];
  assert.ok(one && typeof one['Jumlah Sparepart'] === 'number', '1 part: tanpa nomor, jumlah tetap angka');
  const L = ss.getSheetByName('Laporan ' + y), cols = ctx.masterData_().report, col = (src) => cols.findIndex(c => c.sumber === src) + 1;
  const n = L.data.length - 2;
  ['Jam mulai', 'Jam selesai'].forEach(c => assert.ok(L.fmt.some(f => f[0] === 'setNumberFormat' && f[1] === '3,' + col(c) + ':' + (n + ctx.LAP_SPARE_) + 'x1' && f[2][0] === '@'), c + ' teks (07.30 tidak jadi 7.3)'));
  const A = (src) => ctx.colLetter_(col(src)) + '3:' + ctx.colLetter_(col(src)) + (n + 2 + ctx.LAP_SPARE_);
  assert.ok(L.fmt.some(f => f[0] === 'setWrapStrategy' && f[1] === A('Nama sparepart') && f[2][0] === 'CLIP'), 'sparepart tanpa pindah baris');
  assert.ok(L.fmt.some(f => f[0] === 'setHorizontalAlignment' && f[1] === A('Tanggal') && f[2][0] === 'center'), 'kolom pendek rata tengah');
  assert.strictEqual(L.widths[col('Masalah + detail')], 240);
  assert.strictEqual(L.widths[col('Nama sparepart')], 170);
  L.setColumnWidth(col('Catatan'), 333);   // admin mengubah lebar → dibiarkan
  ctx.buildLaporan_(y);
  assert.strictEqual(L.widths[col('Catatan')], 333, 'lebar dari admin tidak ditimpa');
  assert.strictEqual(ss.getSheetByName('Maintenance E22H').widths[col('Masalah + detail')], 240, 'tab per baterai ikut');
  // TPM Solution: >1 part = satu baris bernomor per part
  ctx.buildTpm_();
  const t = tpmData('E22H').find(r => /Bearing 6205 ×1/.test(r[4]));
  assert.ok(t && /备件 Spare parts:\n① Fuse 10A ×2\n② Bearing 6205 ×1$/.test(t[4]), String(t && t[4]));
});

test('2.6.1 pangkas: Cancel tanpa review (antrian lama dibersihkan setup), Dashboard menandai cancel >30 menit, tutup bulan otomatis', () => {
  // antrian Cancel lama (sebelum 2.6.1) → setup menandai Direview oleh SYSTEM
  const old = ctx.readTable_('Maintenance').find(r => r.Status === 'Cancelled');
  setRow('Maintenance', (r, h) => r[0] === old['Maintenance ID'], 'Status review', 'Perlu review');
  const msg = as('owner@gmail.com', () => ctx.setup());
  assert.match(msg, /Cancelled keluar dari antrian review/);
  const after = rec(old['Maintenance ID']);
  assert.ok(after['Status review'] === 'Direview' && after['Direview oleh'] === 'SYSTEM', JSON.stringify(after['Status review']));
  assert.doesNotMatch(as('owner@gmail.com', () => ctx.setup()), /antrian review/, 'sekali saja');
  // cancel setelah lama bekerja → terlihat di kartu KPI admin
  let id;
  as('dewi@gmail.com', () => { id = ctx.apiStart('L11', { baterai: 'E245' }).open.id; });
  advance(35);
  as('dewi@gmail.com', () => ctx.apiCancel(id, 'Input ganda'));
  assert.strictEqual(rec(id)['Status review'], '');
  const k = as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 })).kpiMonth;
  assert.ok(k.audit.cancelLong >= 1 && k.autoDay === 5, JSON.stringify(k.audit));
  // tutup bulan otomatis
  const t0 = clock.now, now = new FakeDate(), y = ctx.yearOf_(now), m = ctx.monthOf_(now);
  const pk = m === 1 ? ctx.ymKey_(y - 1, 12) : ctx.ymKey_(y, m - 1);
  clock.now = Date.UTC(+pk.slice(0, 4), +pk.slice(5) - 1, 15, 2, 0, 0);   // satu pekerjaan di bulan lalu
  let pid;
  as('dewi@gmail.com', () => { pid = ctx.apiStart('L11', { baterai: 'E245' }).open.id; });
  advance(20);
  as('dewi@gmail.com', () => ctx.apiComplete(pid, sel('Sensor error', { tanpaPart: true })));
  clock.now = t0;
  ctx.kpiReopen_();
  const day = +ctx.Utilities.formatDate(new FakeDate(), 'Asia/Jakarta', 'dd');
  cfgSet('KPI_TUTUP_OTOMATIS', 0); ctx.invalidateMaster_();
  assert.strictEqual(ctx.kpiTutupOtomatis_(), '', '0 = mati');
  if (day < 28) { cfgSet('KPI_TUTUP_OTOMATIS', day + 1); ctx.invalidateMaster_(); assert.strictEqual(ctx.kpiTutupOtomatis_(), '', 'belum tanggalnya'); }
  cfgSet('KPI_TUTUP_OTOMATIS', 1); ctx.invalidateMaster_();
  setRow('Maintenance', (r, h) => r[0] === pid, 'Status', 'Abandoned');
  setRow('Maintenance', (r, h) => r[0] === pid, 'Status review', 'Perlu review');
  assert.strictEqual(ctx.kpiTutupOtomatis_(), '', 'ada Abandoned menunggu review → tidak ditutup');
  setRow('Maintenance', (r, h) => r[0] === pid, 'Status', 'Completed');
  setRow('Maintenance', (r, h) => r[0] === pid, 'Status review', '');
  assert.strictEqual(ctx.kpiTutupOtomatis_(), pk, 'ditutup otomatis');
  assert.strictEqual(ctx.kpiClosed_()[pk].by, 'system');
  assert.ok(ctx.readTable_('Log').some(e => e['Maintenance ID'] === 'KPI ' + pk && /otomatis/.test(e.Detail)));
  assert.strictEqual(ctx.kpiTutupOtomatis_(), '', 'tidak dobel');
  ctx.buildKpi_(+pk.slice(0, 4));
  const st = ss.getSheetByName('KPI ' + pk.slice(0, 4)).data.find(r => r[0] === pk && r[1] === 'Plant');
  assert.match(String(st[11]), / oleh otomatis$/);
  // nilai Config salah → mati, Dashboard tidak menjanjikan tanggal itu, admin diperingatkan
  for (const bad of [30, '5 Nov', -1]) {
    cfgSet('KPI_TUTUP_OTOMATIS', bad); ctx.invalidateMaster_();
    assert.strictEqual(ctx.kpiAutoDay_(), 0, String(bad));
    const d = as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 }));
    assert.strictEqual(d.kpiMonth.autoDay, 0, 'Dashboard: tidak menulis "ditutup otomatis tanggal ' + bad + '"');
    assert.ok(d.warnings.some(w => /KPI_TUTUP_OTOMATIS = ".*": harus tanggal 1–28/.test(w)), 'peringatan untuk ' + bad);
  }
  cfgSet('KPI_TUTUP_OTOMATIS', ''); ctx.invalidateMaster_();
  assert.strictEqual(ctx.kpiAutoDay_(), 5, 'kosong = bawaan 5');
  assert.ok(!as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 })).warnings.some(w => /KPI_TUTUP_OTOMATIS/.test(w)));
  cfgSet('KPI_TUTUP_OTOMATIS', 5); ctx.invalidateMaster_();
});

test('2.6.1 Input Manual: periksa → konfirmasi → Maintenance / Pemakaian / Log / Laporan; baris salah diberi alasan; tidak dobel; hanya Admin', () => {
  as('owner@gmail.com', () => ctx.setup());
  const M = ss.getSheetByName('Input Manual');
  jeq(M.data[0].slice(0, 15), ['Tanggal', 'Jam mulai', 'Jam selesai', 'Line', 'Baterai', 'Stop line', 'Jenis kerusakan', 'Masalah', 'Penyebab',
    'Penanganan', 'Sparepart', 'PIC', 'PIC tambahan', 'Catatan', 'Hasil']);
  assert.ok(M.fmt.some(f => f[0] === 'setNote' && f[1] === '1,8:1x1' && /setelah tanda –/.test(f[2][0])), 'catatan cara isi di judul');
  assert.ok(M.fmt.some(f => f[0] === 'setNumberFormat' && /^2,1:/.test(f[1]) && f[2][0] === '@'), 'tanggal = teks (tidak ditafsir locale)');
  const tech = ctx.readTable_('Users').filter(u => u.Peran === 'Teknisi' && u.Aktif === 'Ya' && u.Nama);
  const A = tech[0], B = tech[1];
  const day = (n) => new FakeDate(new FakeDate().getTime() + n * 86400000);
  const dmy = (d) => ctx.Utilities.formatDate(d, 'Asia/Jakarta', 'dd/MM/yyyy'), ymd = (d) => ctx.Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
  const add = (o) => M.appendRow(rowOf('Input Manual', o));
  const ok1 = { Tanggal: dmy(day(-2)), 'Jam mulai': '22:10', 'Jam selesai': '00:40', Line: 'L10', Baterai: 'e22h', 'Stop line': 'ya',
    'Jenis kerusakan': 'elektrikal', Masalah: 'Sensor error – kabel putus di konektor', Penyebab: 'Komponen aus', Penanganan: 'Ganti part',
    Sparepart: 'Fuse 10A x2; Bearing 6205-2RS', PIC: A.Nama, 'PIC tambahan': B.Email, Catatan: 'Dari laporan WeChat' };
  add(ok1);
  add({ ...ok1, Line: 'LX9' });
  add({ ...ok1, 'Jam mulai': '08:00', PIC: 'Orang Asing' });
  add({ ...ok1, Tanggal: dmy(day(2)), 'Jam mulai': '09:00' });
  add({ ...ok1, 'Jam mulai': '10:00', Masalah: '' });
  add({ ...ok1, 'Jam mulai': '11:00', 'Jenis kerusakan': 'Listrik' });
  add({ Tanggal: ymd(day(-2)), 'Jam mulai': '7.30', 'Jam selesai': '0815', Line: 'L11', Baterai: 'E245', 'Stop line': 'Tidak', 'Jenis kerusakan': 'Mekanikal',
    Masalah: 'Robot macet total', Penyebab: 'Komponen aus', Penanganan: 'Ganti part', PIC: A.Email });
  const n0 = ctx.readTable_('Maintenance').length;
  as(A.Email, () => throwsMsg(() => ctx.apiInputManual({}), /tidak punya akses/));
  const chk = as('owner@gmail.com', () => ctx.apiInputManual({ periksa: true }));
  assert.ok(chk.ok === 2 && chk.bad === 5, chk.summary);
  assert.strictEqual(ctx.readTable_('Maintenance').length, n0, 'periksa = tidak menulis data');
  const hasil = () => ctx.readTable_('Input Manual').map(r => String(r.Hasil));
  const h1 = hasil();
  assert.match(h1[1], /^✗ Line "LX9" tidak ada/);
  assert.match(h1[2], /^✗ PIC "Orang Asing" tidak ada/);
  assert.match(h1[3], /^✗ Jam selesai di masa depan/);
  assert.match(h1[4], /^✗ .*wajib/);
  assert.match(h1[5], /^✗ Jenis kerusakan "Listrik" tidak ada di daftar/);
  assert.ok(h1[0] === '' && h1[6] === '', 'baris benar belum ditandai sebelum dimasukkan');
  const res = as('owner@gmail.com', () => ctx.apiInputManual({}));
  assert.strictEqual(res.ok, 2, res.summary);
  const r1 = rec(res.ids[0]), r2 = rec(res.ids[1]);
  assert.strictEqual(r1.Status, 'Completed');
  assert.strictEqual(r1['Total aktif (menit)'], 150, '22:10 → 00:40 = lewat tengah malam');
  assert.strictEqual(ctx.Utilities.formatDate(r1.Mulai, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'), ymd(day(-2)) + ' 22:10');
  assert.strictEqual(r1.Baterai, 'E22H');
  assert.strictEqual(r1['Stop line'], 'Ya');
  assert.ok(r1.Masalah === 'Sensor error' && r1['Detail masalah'] === 'kabel putus di konektor', 'pilihan + detail dipisah dari "–"');
  assert.strictEqual(r1['Jenis kerusakan'], 'Elektrikal');
  assert.ok(r1['Teknisi terlibat'].includes(A.Email) && r1['Teknisi terlibat'].includes(B.Email) && r1['Teknisi awal'] === A.Email);
  assert.match(r1.Catatan, new RegExp('^\\[\\d\\d/\\d\\d 00:40 ' + A.Nama + '\\] Dari laporan WeChat$'), 'cap = jam selesai + nama PIC');
  assert.strictEqual(r1['Input manual oleh'], 'owner@gmail.com');
  assert.strictEqual(r1['Masuk MTTR'], 'Ya');
  assert.strictEqual(r2.Masalah, 'Lainnya: Robot macet total', 'teks bebas = Lainnya');
  assert.ok(r2['Stop line'] === 'Tidak' && r2.Part === 'Tidak ada pergantian' && r2['Total aktif (menit)'] === 45, '7.30 → 0815');
  const use = ctx.readTable_('Pemakaian Sparepart').filter(u => u['Maintenance ID'] === res.ids[0]);
  jeq(use.map(u => [u['Nama Sparepart'], u.Jumlah, u.Manual]), [['Fuse', 2, 'Tidak'], ['Bearing', 1, 'Tidak']], 'sparepart dari katalog');
  const log = ctx.readTable_('Log').filter(e => res.ids.includes(e['Maintenance ID']));
  assert.ok(log.length === 2 && log.every(e => e.Kejadian === 'input manual' && e.User === 'owner@gmail.com'));
  const y = ctx.yearOf_(r1.Mulai);
  assert.ok(lapRow(y, r => r._id === res.ids[0]).length === 1, 'Laporan langsung diperbarui');
  const h2 = hasil();
  assert.ok(new RegExp('^✓ ' + res.ids[0]).test(h2[0]) && new RegExp('^✓ ' + res.ids[1]).test(h2[6]));
  const again = as('owner@gmail.com', () => ctx.apiInputManual({ periksa: true }));
  assert.strictEqual(again.ok, 0, 'baris ✓ dilewati');
  add(ok1);   // baris sama diketik lagi
  as('owner@gmail.com', () => ctx.apiInputManual({ periksa: true }));
  assert.match(hasil().slice(-1)[0], new RegExp('^✗ Sudah ada: ' + res.ids[0]));
  // batas per jalan
  const keep = ctx.MANUAL_MAX_;
  ctx.MANUAL_MAX_ = 1;
  try { assert.ok(as('owner@gmail.com', () => ctx.apiInputManual({ periksa: true })).more >= 1); } finally { ctx.MANUAL_MAX_ = keep; }
  // menu spreadsheet: periksa → tanya → NO = tidak ada yang ditulis, YES = dimasukkan
  add({ ...ok1, 'Jam mulai': '12:00', 'Jam selesai': '12:30' });
  const n1 = ctx.readTable_('Maintenance').length;
  ui.yesNo = ['NO'];
  as('owner@gmail.com', () => ctx.menuInputManual());
  assert.strictEqual(ctx.readTable_('Maintenance').length, n1, 'konfirmasi NO → tidak ditulis');
  assert.match(ui.alerts.slice(-1)[0], /Masukkan 1 pekerjaan/);
  ui.yesNo = ['YES'];
  as('owner@gmail.com', () => ctx.menuInputManual());
  assert.strictEqual(ctx.readTable_('Maintenance').length, n1 + 1, 'YES → dimasukkan');
  assert.match(ui.alerts.slice(-1)[0], /1 pekerjaan dimasukkan/);
  // Dashboard admin: porsi input manual bulan ini
  const k = as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 })).kpiMonth;
  const inMonth = res.ids.filter(id => ctx.ymOf_(rec(id).Selesai) === k.bulan).length;
  assert.ok(k.audit.manual >= inMonth && k.audit.done >= k.audit.manual, JSON.stringify(k.audit));
});

test('2.6.1 format tanggal baris baru (appendRow) dipasang ulang tiap malam, tanpa tambahan di tombol teknisi', () => {
  const L = ss.getSheetByName('Log');
  L.fmt = [];
  ctx.rapikanTampilan_({});   // jalur malam
  const c = ctx.headers_(L).indexOf('Timestamp') + 1;
  assert.ok(L.fmt.some(f => f[0] === 'setNumberFormat' && f[1] === '2,' + c + ':' + (L.getMaxRows() - 1) + 'x1' && f[2][0] === ctx.DATE_FMT_), 'Log Timestamp');
  const M = ss.getSheetByName('Maintenance'), mh = ctx.headers_(M);
  ['Mulai', 'Selesai'].forEach(n => assert.ok(M.fmt.some(f => f[0] === 'setNumberFormat' && f[1] === '2,' + (mh.indexOf(n) + 1) + ':' + (M.getMaxRows() - 1) + 'x1'), 'Maintenance ' + n));
});

test('2.6.2 fmtTz_ = zona waktu asli (Intl Asia/Jakarta) untuk semua pola dipakai; sebelum 1970 & pola lain lewat Utilities', () => {
  const p2 = (n) => String(n).padStart(2, '0');
  const ref = (t, fmt) => {   // basis data zona waktu sungguhan (ICU), bukan aritmetika +7 seperti mock
    const o = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(t)).forEach(x => { o[x.type] = x.value; });
    const u = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday];
    return fmt.replace(/'([^']*)'|yyyy|yy|MM|dd|HH|mm|ss|u/g, (m, lit) => lit !== undefined ? lit
      : { yyyy: o.year, yy: o.year.slice(2), MM: o.month, dd: o.day, HH: o.hour, mm: o.minute, ss: o.second, u: String(u) }[m]);
  };
  const pola = ['HH.mm', 'HH:mm', 'MM', 'dd', 'dd/MM HH:mm', 'dd/MM', 'dd/MM/yyyy HH:mm', 'dd/MM/yyyy', 'u', 'yyMMdd', 'yyMMddHHmmss', 'yyyy', 'yyyy-MM',
    'yyyy-MM-dd', ctx.APP.DATE_FMT, "dd'月'"];
  let x = 12345;
  for (let i = 0; i < 1500; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const t = Date.UTC(1971, 0, 1) + (x / 2147483648) * (Date.UTC(2045, 0, 1) - Date.UTC(1971, 0, 1));
    pola.forEach(p => assert.strictEqual(ctx.fmtTz_(new FakeDate(t), p), ref(t, p), p + ' @ ' + new Date(t).toISOString()));
  }
  // batas hari WIB: 16:59:59Z = 23:59:59 WIB, 17:00Z = 00:00 hari berikutnya
  assert.strictEqual(ctx.fmtTz_(new FakeDate(Date.UTC(2026, 11, 31, 16, 59, 59)), 'yyyy-MM-dd HH:mm:ss'), '2026-12-31 23:59:59');
  assert.strictEqual(ctx.fmtTz_(new FakeDate(Date.UTC(2026, 11, 31, 17, 0, 0)), 'yyyy-MM-dd HH:mm'), '2027-01-01 00:00');
  const real = ctx.Utilities.formatDate;
  let calls = 0;
  ctx.Utilities.formatDate = function () { calls++; return real.apply(this, arguments); };
  try {
    ctx.fmtTz_(new FakeDate(Date.UTC(1899, 11, 30, 9, 53)), 'HH:mm');   // jam tanpa tanggal dari Sheets (Jakarta 1899 = +07:07)
    ctx.fmtTz_(new FakeDate(Date.UTC(2026, 0, 1)), 'yyyy');
    assert.strictEqual(calls, 1, 'hanya tanggal sebelum 1970 yang lewat Utilities');
  } finally { ctx.Utilities.formatDate = real; }
});

test('2.6.2 cache master 6 jam; edit sel tab pengaturan (juga yang diganti nama) menghapus cache, tab lain tidak', () => {
  assert.strictEqual(ctx.MD_CACHE_TTL_, 21600);
  cache.enabled = true;
  try {
    const key = ctx.MD_CACHE_KEY_ + ':n', warm = () => { ctx.invalidateMaster_(); ctx.masterData_(); assert.ok(cache.store[key], 'cache terisi'); };
    warm();
    ctx.onEdit({ range: ss.getSheetByName('Laporan 2026').getRange(3, 1) });
    assert.ok(cache.store[key], 'edit Laporan tidak menghapus cache');
    ctx.onEdit({ range: ss.getSheetByName('Users').getRange(2, 2) });
    assert.ok(!cache.store[key], 'edit Users menghapus cache');
    warm();
    const L = ctx.findSheet_('Lines'), old = L.getName();
    L.setName('Daftar Mesin');
    try { ctx.resetMaster_(); ctx.onEdit({ range: L.getRange(2, 2) }); assert.ok(!cache.store[key], 'tab pengaturan yang diganti nama tetap dikenali'); }
    finally { L.setName(old); ctx.resetMaster_(); }
  } finally { cache.enabled = false; cache.store = {}; ctx.invalidateMaster_(); }
});

test('2.6.2 teks bebas tidak diubah Sheets: "16:53", "- ganti", "+62…" disimpan sebagai teks; data lama Date tampil "16:53"', () => {
  const q = ctx.cellText_;
  ['16:53', '16:53:00', '10.30', '3/4', '1-2', '2026-10-01', '- ganti sensor', '+62 812 1234', '=SUM(A1)', '@budi', 'TRUE', "'kutip", '50%']
    .forEach(s => assert.strictEqual(q(s), "'" + s, s));
  ['Sensor 3/4 kendur', 'L01-261022-02', 'GX-YN-01-4109', 'Ganti fuse 10A', '', 'Lainnya: 16:53'].forEach(s => assert.strictEqual(q(s), s, s));
  [12, null, true].forEach(v => assert.strictEqual(q(v), v));
  const M = ss.getSheetByName('Maintenance'), q0 = M.quoted || 0;
  const id = as('budi@gmail.com', () => ctx.apiStart('L01', { baterai: 'E22H' })).open.id;
  as('budi@gmail.com', () => ctx.apiComplete(id, sel('Sensor error', { tanpaPart: true,
    values: { 'Jenis kerusakan': 'Elektrikal', Masalah: 'Sensor error', Penyebab: 'Komponen aus', Penanganan: 'Ganti part',
      'Detail masalah': '16:53', 'Detail penyebab': '- konektor longgar', 'Detail penanganan': 'Kencangkan konektor' } })));
  assert.ok((M.quoted || 0) - q0 >= 2, 'ditulis dengan awalan \' (Sheets menyimpannya sebagai teks)');
  const r = rec(id);
  assert.strictEqual(r['Detail masalah'], '16:53');
  assert.strictEqual(r['Detail penyebab'], '- konektor longgar');
  // data lama: Sheets sudah mengubah "16:53" menjadi jam 30/12/1899
  r['Detail penyebab'] = new FakeDate(Date.UTC(1899, 11, 30, 9, 53));
  const md = ctx.masterData_();
  assert.strictEqual(ctx.laporanValue_('Penyebab + detail', r, 0, [], md, {}), 'Komponen aus – 16:53');
  assert.strictEqual(ctx.textOf_(new FakeDate(Date.UTC(2026, 2, 3, 17))), '04/03/2026');
  assert.strictEqual(ctx.textOf_(new FakeDate(Date.UTC(2026, 2, 3, 3, 30))), '03/03/2026 10:30');
});

test('2.6.2 setup tidak melewati batas waktu: bila waktu habis, struktur & trigger selesai, bangun ulang dilewati dengan catatan', () => {
  const real = ctx.SETUP_BATAS_MS_, realTpm = ctx.buildTpm_;
  let tpmOpts = null;
  ctx.buildTpm_ = function (opts) { tpmOpts = opts; return realTpm.apply(this, arguments); };
  try {
    as('owner@gmail.com', () => ctx.setup());
    assert.strictEqual(tpmOpts && tpmOpts.trMax, ctx.SETUP_TR_MAX_, 'TPM di dalam setup memakai batas terjemahan kecil');
    ctx.SETUP_BATAS_MS_ = { laporan: -1, tpm: -1, kpi: -1, tampilan: -1 };
    tpmOpts = null;
    const msg = as('owner@gmail.com', () => ctx.setup());
    assert.match(msg, /Waktu hampir habis .*Laporan & Rekap, tab TPM, tab KPI, rapikan tampilan dilewati/, msg);
    assert.strictEqual(tpmOpts, null, 'TPM tidak dibangun');
    ['checkTimeouts', 'refreshRekap', 'onMasterChange'].forEach(fn => assert.ok(triggers.some(t => t.getHandlerFunction() === fn), fn));
  } finally { ctx.SETUP_BATAS_MS_ = real; ctx.buildTpm_ = realTpm; }
});

test('2.6.2 Input Manual tidak membangun TPM (trigger malam); Laporan & KPI tetap', () => {
  const realTpm = ctx.buildTpm_, M = ss.getSheetByName('Input Manual');
  let n = 0;
  ctx.buildTpm_ = function () { n++; return realTpm.apply(this, arguments); };
  try {
    const A = ctx.readTable_('Users').filter(u => u.Peran === 'Teknisi' && u.Aktif === 'Ya' && u.Nama)[0];
    const d = new FakeDate(new FakeDate().getTime() - 3 * 86400000);
    M.appendRow(rowOf('Input Manual', { Tanggal: ctx.Utilities.formatDate(d, 'Asia/Jakarta', 'dd/MM/yyyy'), 'Jam mulai': '05:10', 'Jam selesai': '05:40',
      Line: 'L10', Baterai: 'E22H', 'Stop line': 'Ya', 'Jenis kerusakan': 'Elektrikal', Masalah: 'Sensor error', Penyebab: 'Komponen aus',
      Penanganan: 'Ganti part', PIC: A.Nama }));
    const res = as('owner@gmail.com', () => ctx.apiInputManual({}));
    assert.strictEqual(res.ok, 1, res.summary);
    assert.strictEqual(n, 0, 'TPM tidak dibangun di Input Manual');
    assert.match(res.summary, /tab TPM menyusul malam ini/);
    const lap = ss.getSheetByName(ctx.laporanName_(ctx.yearOf_(new FakeDate()))).data;
    assert.ok(lap.some(r => r[r.length - 1] === res.ids[0]), 'langsung ada di Laporan');
  } finally { ctx.buildTpm_ = realTpm; }
});

test('2.6.2 Download: batas 12000 baris (setahun penuh); file Excel tanpa warna teks / isian eksplisit (mode gelap HP)', () => {
  assert.strictEqual(ctx.APP.EXPORT_LIMIT, 12000);
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'App.html'), 'utf8');
  const i = html.indexOf('  function xlsxOf('), src = html.slice(i, html.indexOf('\n  }\n', i));
  assert.ok(i > 0 && !/argb|fgColor|color\s*:/.test(src), 'xlsxOf tanpa warna eksplisit');
  assert.match(src, /row\.font = plain/);
  assert.match(src, /head\.height = /);
});

test('2.6.3 readHot_: ekor + baris lama terbuka / pending / menunggu review = baca penuh; ID di luar set itu → pesan status benar', () => {
  const hotStatus = (r) => ['Aktif', 'Pause', 'Pending'].indexOf(r.Status) !== -1 || r['Status review'] === 'Perlu review';
  const P = as('budi@gmail.com', () => ctx.apiStart('L03', 'E22H')).open.id;
  as('budi@gmail.com', () => ctx.apiPending(P, pend('Cek wiring', 'Menunggu part', 'BESOK')));
  const ids = [];
  for (let i = 0; i < 3; i++) {   // menutupi pending tadi dari ekor kecil
    const id = as('andi@gmail.com', () => ctx.apiStart('L02', 'E22H')).open.id;
    as('andi@gmail.com', () => ctx.apiComplete(id, done));
    ids.push(id);
  }
  const M = ss.getSheetByName('Maintenance'), f0 = M.finds || 0, full = ctx.readTable_('Maintenance');
  const hot = ctx.readHot_(3);
  jeq(hot, full.filter((r, i) => i >= full.length - 3 || hotStatus(r)), 'isi & _row sama dengan baca penuh difilter');
  assert.ok(full.length - full.findIndex(r => r['Maintenance ID'] === P) > 3 && hot.some(r => r['Maintenance ID'] === P), 'pending di luar ekor tetap ada');
  assert.ok((M.finds || 0) > f0, 'baris lama dicari di server (TextFinder), bukan baca seluruh tab');
  jeq(ctx.readHot_(), full.filter((r, i) => i >= full.length - ctx.HOT_TAIL_ || hotStatus(r)), 'ekor bawaan');
  const maxB = ctx.HOT_BLOCKS_MAX_;
  ctx.HOT_BLOCKS_MAX_ = 0;   // terlalu banyak blok lama → baca penuh (tidak lebih lambat dari 2.6.2)
  try { jeq(ctx.readHot_(3), full); } finally { ctx.HOT_BLOCKS_MAX_ = maxB; }
  const tail = ctx.HOT_TAIL_;
  ctx.HOT_TAIL_ = 2;
  try {
    assert.ok(!ctx.readHot_().some(r => r['Maintenance ID'] === ids[0]), 'ids[0] di luar ekor 2 → jalur cadangan (cari ID di server) terpakai');
    throwsMsg(() => as('andi@gmail.com', () => ctx.apiComplete(ids[0], done)), /berstatus Completed; aksi ini tidak bisa dilakukan/);
    const v = as('budi@gmail.com', () => ctx.apiContinue(P, 'L03'));
    assert.ok(v.open && v.open.id === P && v.openIsMine, 'pending lama dilanjutkan dengan ekor kecil');
    as('budi@gmail.com', () => ctx.apiComplete(P, done));
    const d = as('budi@gmail.com', () => ctx.apiGetDetail(P));
    jeq(d.events.map(e => e.event), logOf(P), 'Detail: Log dicari lewat TextFinder = baca penuh');
    assert.strictEqual(d.record.status, 'Completed');
  } finally { ctx.HOT_TAIL_ = tail; }
});

test('2.6.3 baris baru Maintenance / Log di dalam kunci lewat setValues (tanpa appendRow), di luar kunci tetap appendRow; Laporan lewat TextFinder', () => {
  const proto = Object.getPrototypeOf(ss.getSheetByName('Log')), orig = proto.appendRow, n = {};
  proto.appendRow = function () { n[this.getName()] = (n[this.getName()] || 0) + 1; return orig.apply(this, arguments); };
  const L = ss.getSheetByName('Log'), M = ss.getSheetByName('Maintenance'), S = ss.getSheetByName(ctx.laporanName_(ctx.yearOf_(new FakeDate())));
  const l0 = L.getLastRow(), m0 = M.getLastRow(), s0 = S.finds || 0;
  try {
    const id = as('budi@gmail.com', () => ctx.apiStart('L01', 'E22H')).open.id;
    as('budi@gmail.com', () => ctx.apiPause(id, { values: { 'Alasan pause': 'Istirahat' } }));
    as('budi@gmail.com', () => ctx.apiResume(id));
    as('budi@gmail.com', () => ctx.apiComplete(id, done));
    assert.ok(!n.Log && !n.Maintenance && !n['Pemakaian Sparepart'], 'tanpa appendRow: ' + JSON.stringify(n));
    assert.strictEqual(M.getLastRow(), m0 + 1);
    assert.strictEqual(M.data[m0][0], id, 'pekerjaan baru tepat di bawah baris terakhir');
    assert.strictEqual(rec(id).Status, 'Completed');
    assert.strictEqual(L.getLastRow(), l0 + 4, 'tidak menimpa, tidak ada baris kosong');
    jeq(logOf(id), ['start', 'pause', 'resume', 'complete']);
    assert.ok((S.finds || 0) - s0 >= 3, 'baris Laporan dicari lewat TextFinder');
    assert.strictEqual(ctx.LOCK_DEPTH_, 0);
    ctx.log_(new FakeDate(), 'UJI-263', 'uji', 'SYSTEM', 'di luar kunci');
    assert.strictEqual(n.Log, 1, 'di luar kunci: appendRow (atomik, tidak bentrok dengan penulis lain)');
    assert.strictEqual(L.data[L.getLastRow() - 1][1], 'UJI-263');
    L.data.splice(L.getLastRow() - 1, 1);
  } finally { proto.appendRow = orig; }
});

test('2.6.3 setup: batas mulai bangun ulang + lama terlama yang terukur ≤ 300 dtk (batas Apps Script 360)', () => {
  const B = ctx.SETUP_BATAS_MS_;
  // terukur di Apps Script asli dengan data setahun: Laporan+Rekap 30 dtk, TPM s/d 113 (dengan terjemahan), KPI 13, rapikan 38
  // 2.6.6: uji 2 tahun (±24/hari): setup 309 dtk → rapikan tampilan di dalam setup ±60 dtk
  const terlama = { laporan: 30000, tpm: 113000, kpi: 13000, tampilan: 60000 };
  Object.keys(terlama).forEach(k => assert.ok(B[k] + terlama[k] <= 300000, k + ': ' + B[k] + ' + ' + terlama[k]));
});

test('2.6.4 ketuk ulang tanpa dobel: rid sama → aksi sekali (ulang), rid berjalan ditunggu, gagal → boleh diulang, aksi lain tidak tertahan', () => {
  cache.enabled = true;
  const realSleep = ctx.Utilities.sleep;
  try {
    const m0 = ctx.readTable_('Maintenance').length, P = { values: { 'Alasan pause': 'Istirahat' } };
    const a = as('budi@gmail.com', () => ctx.apiAct('apiStart', ['L01', { baterai: 'E22H' }], 'r-start-1'));
    const id = a.open.id;
    assert.ok(!a.ulang);
    // sinyal putus sesudah server menyimpan → HP mengirim ulang rid yang sama
    const b = as('budi@gmail.com', () => ctx.apiAct('apiStart', ['L01', { baterai: 'E22H' }], 'r-start-1'));
    assert.strictEqual(b.ulang, true);
    assert.strictEqual(b.open && b.open.id, id, 'halaman line terbaru, pekerjaan yang sama');
    assert.strictEqual(ctx.readTable_('Maintenance').length, m0 + 1, 'tidak dobel');
    as('budi@gmail.com', () => ctx.apiAct('apiPause', [id, P], 'r-p1'));
    assert.strictEqual(as('budi@gmail.com', () => ctx.apiAct('apiPause', [id, P], 'r-p1')).ulang, true);
    as('budi@gmail.com', () => ctx.apiAct('apiResume', [id], 'r-r1'));
    as('budi@gmail.com', () => ctx.apiAct('apiPause', [id, P], 'r-p2'));   // Pause kedua: rid baru, tidak tertahan rid Pause pertama
    as('budi@gmail.com', () => ctx.apiAct('apiResume', [id], 'r-r2'));
    jeq(logOf(id), ['start', 'pause', 'resume', 'pause', 'resume']);
    // gagal (isian kurang) → rid dilepas, ketuk ulang sesudah diperbaiki benar-benar dijalankan
    throwsMsg(() => as('budi@gmail.com', () => ctx.apiAct('apiComplete', [id, sel('Sensor error')], 'r-c1')), /Pilih sparepart/);
    assert.ok(!('mttr-rid:r-c1' in cache.store), 'gagal → rid dihapus');
    const c = as('budi@gmail.com', () => ctx.apiAct('apiComplete', [id, done], 'r-c1'));
    assert.ok(!c.ulang && rec(id).Status === 'Completed');
    const c2 = as('budi@gmail.com', () => ctx.apiAct('apiComplete', [id, done], 'r-c1'));
    assert.ok(c2.ulang && c2.line.id === 'L01' && !c2.open, 'Selesai diulang → halaman line, bukan error "berstatus Completed"');
    jeq(logOf(id), ['start', 'pause', 'resume', 'pause', 'resume', 'complete']);
    assert.strictEqual(ctx.readTable_('Pemakaian Sparepart').filter(r => r['Maintenance ID'] === id).length, 1, 'sparepart tidak dobel');
    // rid masih berjalan (ketukan pertama belum selesai di server) → ditunggu, lalu hasilnya
    let slept = 0;
    ctx.Utilities.sleep = (ms) => { slept += ms; advance(ms / 60000); if (slept >= 1500) cache.store['mttr-rid:r-x'] = 'L01'; };
    cache.store['mttr-rid:r-x'] = ctx.RID_RUN_;
    const w = as('budi@gmail.com', () => ctx.apiAct('apiStart', ['L01', { baterai: 'E22H' }], 'r-x'));
    assert.ok(w.ulang && !w.open && slept === 1500, 'menunggu ketukan pertama, tidak memulai lagi');
    slept = -1e9;
    cache.store['mttr-rid:r-y'] = ctx.RID_RUN_;
    throwsMsg(() => as('budi@gmail.com', () => ctx.apiAct('apiStart', ['L01', { baterai: 'E22H' }], 'r-y')), /masih diproses/);
    assert.strictEqual(ctx.readTable_('Maintenance').length, m0 + 1, 'tidak ada pekerjaan baru');
    ctx.Utilities.sleep = realSleep;
    // aksi lain di pekerjaan yang sama memakai rid lain; aksi di luar daftar ditolak
    const j = as('andi@gmail.com', () => ctx.apiAct('apiStart', ['L02', { baterai: 'E22H' }], 'r-a1')).open.id;
    as('andi@gmail.com', () => ctx.apiAct('apiCancel', [j, { values: { 'Alasan cancel': 'Lainnya' }, other: { 'Alasan cancel': 'uji rid' } }], 'r-a2'));
    assert.strictEqual(rec(j).Status, 'Cancelled');
    throwsMsg(() => as('owner@gmail.com', () => ctx.apiAct('setup', [], 'r-z')), /Aksi tidak dikenal/);
    throwsMsg(() => as('owner@gmail.com', () => ctx.apiAct('apiReview', [], 'r-z')), /Aksi tidak dikenal/);
    // tanpa rid (klien lama) = langsung, tanpa cache
    const k = Object.keys(cache.store).length;
    const n = as('andi@gmail.com', () => ctx.apiAct('apiStart', ['L02', { baterai: 'E22H' }])).open.id;
    as('andi@gmail.com', () => ctx.apiAct('apiComplete', [n, done]));
    assert.strictEqual(Object.keys(cache.store).length, k);
    // rid aneh dari klien dibersihkan jadi kunci aman
    const q = as('andi@gmail.com', () => ctx.apiAct('apiStart', ['L02', { baterai: 'E22H' }], 'a b/c:<d>')).open.id;
    assert.strictEqual(cache.store['mttr-rid:abcd'], 'L02');
    as('andi@gmail.com', () => ctx.apiComplete(q, done));
    // CacheService gangguan: aksi tetap tersimpan & sukses (bukan "gagal" palsu sesudah menyimpan)
    const sc = ctx.CacheService.getScriptCache(), realGet = sc.get, realPut = sc.put;
    sc.get = () => { throw new Error('Service error: CacheService'); };
    sc.put = () => { throw new Error('Service error: CacheService'); };
    try {
      const g = as('andi@gmail.com', () => ctx.apiAct('apiStart', ['L02', { baterai: 'E22H' }], 'r-gangguan'));
      assert.ok(g.open && rec(g.open.id).Status === 'Aktif');
      as('andi@gmail.com', () => ctx.apiAct('apiComplete', [g.open.id, done], 'r-gangguan2'));
      assert.strictEqual(rec(g.open.id).Status, 'Completed');
    } finally { sc.get = realGet; sc.put = realPut; }
  } finally { ctx.Utilities.sleep = realSleep; cache.enabled = false; cache.store = {}; }
});

test('2.6.4 batas: PIC tambahan 15, sparepart 20 jenis (sesudah digabung), Log 3000; 15 PIC + 20 part utuh di Log, Laporan, TPM, Download', () => {
  const names = Array.from({ length: 16 }, (_, i) => 'Teknisi ' + String(i + 1).padStart(2, '0'));
  const mails = names.map((n, i) => 'pic' + String(i + 1).padStart(2, '0') + '@example.com');
  names.forEach((n, i) => U.appendRow(rowOf('Users', { Email: mails[i], Nama: n, Peran: 'Teknisi', Aktif: 'Ya' })));
  ctx.invalidateMaster_();
  const b = as('budi@gmail.com', () => ctx.apiBootstrap(''));
  assert.strictEqual(b.limits.picMax, 15);
  assert.strictEqual(b.limits.partMax, 20);
  const part = (i) => ({ manual: true, jenis: 'Mekanikal', nama: 'Part uji ' + (i + 1), model: 'M-' + (i + 1), qty: 1 });
  const parts20 = Array.from({ length: 20 }, (_, i) => part(i));
  const y = ctx.yearOf_(new FakeDate());
  let id;
  as('budi@gmail.com', () => {
    id = ctx.apiStart('L03', { baterai: 'E22H' }).open.id;
    advance(40);
    throwsMsg(() => ctx.apiComplete(id, sel('Sensor error', { parts: parts20, pics: mails })), /PIC tambahan maksimal 15 orang/);
    throwsMsg(() => ctx.apiComplete(id, sel('Sensor error', { parts: parts20.concat([part(20)]), pics: mails.slice(0, 15) })), /Sparepart maksimal 20 jenis/);
    assert.strictEqual(rec(id).Status, 'Aktif', 'ditolak sebelum menulis apa pun');
    // part yang sama dua kali → digabung dulu (21 baris = 20 jenis)
    ctx.apiComplete(id, sel('Sensor error', { parts: parts20.concat([part(19)]), pics: mails.slice(0, 15).concat(['budi@gmail.com']) }));
  });
  const r = rec(id);
  assert.strictEqual(r['Teknisi terlibat'].split(', ').length, 16, 'PIC utama + 15');
  const use = ctx.readTable_('Pemakaian Sparepart').filter(u => u['Maintenance ID'] === id);
  assert.strictEqual(use.length, 20);
  assert.strictEqual(use[19].Jumlah, 2, 'part ke-20 dipilih dua kali → jumlah 2');
  const det = ctx.readTable_('Log').find(e => e['Maintenance ID'] === id && e.Kejadian === 'complete').Detail;
  assert.ok(det.length < 3000 && det.includes('Part uji 20 M-20 ×2 (manual)') && det.includes('Teknisi 15'), 'Log utuh: ' + det.length + ' karakter');
  ctx.log_(new FakeDate(), 'UJI-264', 'uji', 'SYSTEM', 'x'.repeat(5000));
  const L = ss.getSheetByName('Log');
  assert.strictEqual(String(L.data[L.getLastRow() - 1][L.data[0].indexOf('Detail')]).length, 3000, 'Detail dipotong 3000');
  L.data.splice(L.getLastRow() - 1, 1);
  // Laporan (langsung) & bangun ulang: ①..⑳ di tiap kolom sparepart, nama PIC lengkap
  const check = (a, where) => {
    const nm = a['Nama Sparepart'].split('\n');
    assert.strictEqual(nm.length, 20, where);
    assert.strictEqual(nm[0], '① Part uji 1', where);
    assert.strictEqual(nm[19], '⑳ Part uji 20', where);
    assert.strictEqual(a['Jumlah Sparepart'].split('\n')[19], '⑳ 2', where);
  };
  check(lapRow(y, x => x._id === id)[0], 'Laporan langsung');
  ctx.buildLaporan_(y);
  const a = lapRow(y, x => x._id === id)[0];
  check(a, 'Laporan dibangun ulang');
  const picCol = ctx.masterData_().report.find(c => c.sumber === 'PIC');
  assert.ok(picCol, 'kolom PIC ada');
  assert.strictEqual(a[picCol.kolom.split('\n').pop()].split(', ').length, 16, 'Laporan: nama PIC lengkap');
  ctx.buildTpm_();
  const t = tpmData('E22H').find(x => /Part uji 20 M-20 ×2/.test(x[4]));
  assert.ok(t && /\n① Part uji 1 M-1 ×1\n/.test(t[4]) && /⑳ Part uji 20 M-20 ×2 \(manual\)$|⑳ Part uji 20 M-20 ×2$/.test(t[4]), 'TPM: ' + String(t && t[4]).slice(-60));
  const now = new FakeDate(), ex = as('owner@gmail.com', () => ctx.apiExport({ from: ctx.ymdOf_(now), to: ctx.ymdOf_(now), scope: 'all' }));
  const nmCol = ex.columns.findIndex(c => c.source === 'Nama sparepart'), picCol2 = ex.columns.findIndex(c => c.source === 'PIC');
  const row = ex.rows.find(x => /⑳ Part uji 20/.test(x[nmCol]));
  assert.ok(row && String(row[nmCol]).split('\n').length === 20, 'Download: 20 baris sparepart dalam satu sel');
  assert.strictEqual(String(row[picCol2]).split(', ').length, 16, 'Download: nama PIC lengkap');
  // klien: batas dari server, bukan angka tetap
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'App.html'), 'utf8');
  assert.match(html, /limits\.picMax/);
  assert.match(html, /limits\.partMax/);
  assert.match(html, /height = 15 \* Math\.min\(lines, 25\)/);
});

test('2.6.5 kapasitas: tab data tanpa kolom kosong sesudah setup; trimSheet_ menyisakan baris cadangan, tidak menyentuh isi', () => {
  ['Maintenance', 'Log', 'Pemakaian Sparepart'].forEach(n => { const sh = ss.getSheetByName(n);
    assert.strictEqual(sh.getMaxColumns(), sh.getLastColumn(), n + ': ' + sh.getMaxColumns() + ' kolom = judul'); });
  assert.strictEqual(ss.getSheetByName('Log').getMaxColumns(), 5, 'Log 26 → 5 kolom');
  const T = ss.insertSheet('Uji Trim');
  for (let i = 0; i < 10; i++) T.appendRow(['a' + i, i, '']);
  const isi = JSON.stringify(T.data);
  ctx.trimSheet_(T, 5);
  assert.strictEqual(T.getMaxRows(), 15);
  assert.strictEqual(T.getMaxColumns(), 3);
  assert.strictEqual(JSON.stringify(T.data), isi, 'isi tidak berubah');
  ctx.trimSheet_(T);
  assert.strictEqual(T.getMaxRows(), 15, 'tanpa spareRows: baris tidak disentuh');
  ss.deleteSheet(T);
  // baris baru sesudah dipangkas tetap bisa ditulis (ensureRows_ menambah baris)
  const id = as('budi@gmail.com', () => ctx.apiStart('L01', { baterai: 'E22H' })).open.id;
  as('budi@gmail.com', () => ctx.apiCancel(id, { values: { 'Alasan cancel': 'Lainnya' }, other: { 'Alasan cancel': 'uji trim' } }));
  assert.strictEqual(rec(id).Status, 'Cancelled');
});

test('2.6.6 tab backup: Senin = minggu lalu, tanggal 3 = bulan lalu, isi = Download Riwayat, sekali per periode, dihapus admin tidak dibuat lagi, Dashboard mengingatkan', () => {
  const W = (y, m, d, h) => new FakeDate(Date.UTC(y, m - 1, d, h - 7));   // jam WIB
  const per = (t) => ctx.backupPeriods_(t).map(p => p.name + ' ' + p.from + '..' + p.to);
  jeq(per(W(2026, 11, 2, 3)), ['Backup minggu 2026-10-26 2026-10-26..2026-11-01'], 'Senin 2 Nov: minggu 26 Okt–1 Nov, bulan belum (tgl < 3)');
  jeq(per(W(2026, 11, 3, 3)), ['Backup minggu 2026-10-26 2026-10-26..2026-11-01', 'Backup bulan 2026-10 2026-10-01..2026-10-31']);
  jeq(per(W(2027, 1, 4, 3)), ['Backup minggu 2026-12-28 2026-12-28..2027-01-03', 'Backup bulan 2026-12 2026-12-01..2026-12-31'], 'lewat tahun');
  jeq(per(W(2026, 11, 8, 23)), ['Backup minggu 2026-10-26 2026-10-26..2026-11-01', 'Backup bulan 2026-10 2026-10-01..2026-10-31'], 'Minggu malam: masih minggu lalu');
  assert.ok(triggers.some(t => t.getHandlerFunction() === 'backupTerjadwal' && t.every === 'hari:1@3'), 'trigger harian 03:00');
  // data di minggu lalu (jam mock sekarang) → tab berisi baris yang sama dengan Download Riwayat admin untuk periode itu
  const p = ctx.backupPeriods_(new FakeDate())[0], props = require('./mock').docProps;
  delete props.store.MTTR_BACKUP_DONE;
  ['Backup minggu ' + p.from].forEach(n => { const t = ss.getSheetByName(n); if (t) ss.deleteSheet(t); });
  const exp = as('owner@gmail.com', () => ctx.apiExport({ from: p.from, to: p.to, scope: 'all' }));
  const made = ctx.backupJalan_(new FakeDate(), false);
  const B = ss.getSheetByName(p.name);
  assert.ok(exp.total > 0, 'data uji punya pekerjaan minggu lalu (' + p.name + ')');
  {
    assert.ok(B && made.some(x => x.indexOf(p.name) === 0), 'tab dibuat: ' + JSON.stringify(made));
    assert.match(String(B.data[0][0]), /pekerjaan \(tanpa Cancelled\).*HAPUS tab ini/);
    jeq(B.data[1], exp.columns.map(c => c.name), 'kolom = Format Laporan');
    assert.strictEqual(B.data.length - 2, exp.total, 'jumlah baris = Download Riwayat');
    const norm = (v) => (v && v.d ? new Date(v.d).getTime() : (v instanceof Date ? v.getTime() : String(v).replace(/^'/, '')));
    jeq(B.data.slice(2).map(r => r.map(norm)), exp.rows.map(r => r.map(norm)), 'isi sel = Download Riwayat');
    assert.strictEqual(B.getMaxRows(), B.data.length, 'tab dipangkas pas isi');
    assert.strictEqual(B.getMaxColumns(), exp.columns.length);
    assert.strictEqual(B.frozenRows, 2);
  }
  // sekali per periode: trigger berikutnya tidak membuat ulang; admin menghapus tab → tetap tidak dibuat lagi
  jeq(ctx.backupJalan_(new FakeDate(), false), [], 'tidak dobel');
  if (B) ss.deleteSheet(B);
  jeq(ctx.backupJalan_(new FakeDate(), false), [], 'sudah dihapus admin: tidak dibuat lagi');
  assert.ok(!ss.getSheetByName(p.name));
  // menu admin: paksa buat ulang; Config Tidak → tidak ada
  assert.ok(ctx.backupJalan_(new FakeDate(), true).length >= 1 && ss.getSheetByName(p.name), 'menu: dibuat ulang');
  setRow('Config', (x, h) => x[h.indexOf('Key')] === 'BACKUP_TAB', 'Value', 'Tidak');
  ctx.invalidateMaster_();
  delete props.store.MTTR_BACKUP_DONE;
  if (ss.getSheetByName(p.name)) ss.deleteSheet(ss.getSheetByName(p.name));
  jeq(ctx.backupJalan_(new FakeDate(), false), [], 'BACKUP_TAB = Tidak');
  setRow('Config', (x, h) => x[h.indexOf('Key')] === 'BACKUP_TAB', 'Value', 'Mingguan, Bulanan');
  ctx.invalidateMaster_();
  assert.strictEqual(ctx.buatTabBackup_({ name: 'Backup minggu 2020-01-06', from: '2020-01-06', to: '2020-01-12', label: 'x' }, new FakeDate()), 0, 'periode kosong');
  assert.ok(!ss.getSheetByName('Backup minggu 2020-01-06'), 'periode kosong: tidak ada tab');
  // Dashboard: tab backup > 35 hari belum dihapus
  const T = ss.insertSheet('Backup minggu 2026-01-05');
  const w = as('owner@gmail.com', () => ctx.apiDashboard({ periode: 30 })).warnings;
  assert.ok(w.some(x => /tab backup lebih dari 35 hari belum dihapus \(Backup minggu 2026-01-05\)/.test(x)), w.join(' | '));
  assert.ok(!as('budi@gmail.com', () => ctx.apiDashboard({ periode: 30 })).warnings.some(x => /tab backup/.test(x)), 'hanya admin');
  assert.ok(ctx.tabPlan_(ss).some(x => x[0] === 'Backup minggu 2026-01-05' && !x[2]), 'tab backup terlihat (tidak disembunyikan)');
  ss.deleteSheet(T);
});

test('2.6.6 Config tanggal (KPI_MULAI, TPM_MULAI, TANGGAL_LIBUR) berformat teks: locale en_US tidak membalik dd/mm', () => {
  const C = ss.getSheetByName('Config'), h = C.data[0], k = h.indexOf('Key'), v = h.indexOf('Value');
  const fmt0 = C.fmt.length;
  ctx.configDateText_();
  const rows = C.data.map((r, i) => [String(r[k]), i + 1]).filter(([key]) => ['KPI_MULAI', 'TPM_MULAI', 'TANGGAL_LIBUR'].includes(key));
  assert.strictEqual(rows.length, 3);
  rows.forEach(([key, row]) => assert.ok(C.fmt.slice(fmt0).some(f => f[0] === 'setNumberFormat' && f[1] === row + ',' + (v + 1) + ':1x1' && f[2][0] === '@'), key + ' teks'));
  const before = C.fmt.length;
  const r = C.data.findIndex(x => x[k] === 'TPM_MULAI'), old = C.data[r][v];
  C.data[r][v] = new FakeDate(Date.UTC(2026, 0, 1));   // tanggal asli yang sudah ada: tidak diubah
  ctx.configDateText_();
  assert.ok(!C.fmt.slice(before).some(f => f[1] === (r + 1) + ',' + (v + 1) + ':1x1'), 'sel tanggal asli dibiarkan');
  C.data[r][v] = old;
});

// "Kirim terpaksa" (K8): Apps Script menahan tulisan dalam antrean; baca berikutnya memaksa antrean dikirim dulu (±0,3–0,8 dtk).
// Dihitung di mock: baca saat masih ada tulisan tertunda. Panggilan bersarang di dalam mock tidak dihitung.
function kirimTerpaksa(fn) {
  const R = Object.getPrototypeOf(ss.getSheetByName('Log').getRange(1, 1)), S = Object.getPrototypeOf(ss.getSheetByName('Log'));
  const READ = [[R, 'getValues'], [R, 'getValue'], [R, 'createTextFinder'], [S, 'getLastRow'], [S, 'getMaxRows'], [S, 'getLastColumn'], [S, 'getDataRange']];
  const WRITE = [[R, 'setValues'], [R, 'setValue'], [R, 'setNumberFormat'], [S, 'insertRowsAfter'], [S, 'deleteRow'], [S, 'deleteRows']];
  const NETRAL = [[S, 'getRange']];   // getRange di Google tidak membaca server (mock memanggil getMaxRows di dalamnya)
  let depth = 0, pending = 0, forced = 0, at = [];
  const orig = [];
  const wrap = (o, n, kind) => {
    const f = o[n]; orig.push([o, n, f]);
    o[n] = function () {
      if (!depth) {
        if (kind === 'w') pending++;
        else if (pending) { forced++; pending = 0; at.push(n + ' ' + (this.getName ? this.getName() : (this.sh && this.sh.getName()))); }
      }
      depth++;
      try { return f.apply(this, arguments); } finally { depth--; }
    };
  };
  NETRAL.forEach(([o, n]) => { const f = o[n]; orig.push([o, n, f]); o[n] = function () { depth++; try { return f.apply(this, arguments); } finally { depth--; } }; });
  READ.forEach(([o, n]) => wrap(o, n, 'r'));
  WRITE.forEach(([o, n]) => wrap(o, n, 'w'));
  const SA = ctx.SpreadsheetApp, fl = SA.flush;
  SA.flush = function () { pending = 0; return fl.apply(this, arguments); };
  try { const v = fn(); return { forced, at, v }; } finally { orig.forEach(([o, n, f]) => { o[n] = f; }); SA.flush = fl; }
}

test('2.6.8 K8 satu kali kirim per tombol: semua baca sebelum tulis (Mulai, Pause, Resume, Pending, Lanjut, Selesai + part + PIC, Cancel, Masih lanjut)', () => {
  const free = ctx.readTable_('Lines').map(l => l['Line ID']).filter(id => /^L\d+$/.test(id) && !ctx.readTable_('Maintenance').some(r => r.Line === id && ['Aktif', 'Pause', 'Pending'].includes(r.Status)));
  const who = ['budi@gmail.com', 'andi@gmail.com', 'sari@gmail.com', 'dewi@gmail.com'].filter(e => !ctx.readTable_('Maintenance').some(r => String(r['Teknisi terakhir']).toLowerCase() === e && ['Aktif', 'Pause'].includes(r.Status)));
  assert.ok(free.length >= 2 && who.length >= 1, 'line & teknisi bebas: ' + free + ' / ' + who);
  const line = free[0], line2 = free[1], tech = who[0], hasil = {};
  const ukur = (nama, fn) => { const k = kirimTerpaksa(() => as(tech, fn)); hasil[nama] = k.forced + (k.at.length ? ' (' + k.at.join(', ') + ')' : ''); return k.v; };
  const id = ukur('Mulai', () => ctx.apiStart(line, { baterai: 'E22H' })).open.id;
  ukur('Pause', () => ctx.apiPause(id, { values: { 'Alasan pause': 'Istirahat' } }));
  ukur('Resume', () => ctx.apiResume(id));
  ukur('Masih lanjut', () => ctx.apiConfirmStillWorking(id));
  ukur('Pending', () => ctx.apiPending(id, pend('Cek awal', 'Menunggu part', 'BESOK')));
  ukur('Lanjut (QR)', () => ctx.apiContinue(id, line));
  ukur('Selesai + part + PIC', () => ctx.apiComplete(id, { ...done, parts: [{ id: FUSE, qty: 2 }, { manual: true, jenis: 'Mekanikal', nama: 'Bearing uji K8', model: '6205', qty: 1 }], pics: ['sari@gmail.com'].filter(e => e !== tech) }));
  const j = ukur('Mulai (untuk cancel)', () => ctx.apiStart(line2, { baterai: 'E22H' })).open.id;
  ukur('Cancel', () => ctx.apiCancel(j, { values: { 'Alasan cancel': 'Lainnya' }, other: { 'Alasan cancel': 'uji K8' } }));
  jeq(Object.values(hasil).map(String), Object.keys(hasil).map(() => '0'), 'kirim terpaksa per tombol: ' + JSON.stringify(hasil));
  assert.strictEqual(rec(id).Status, 'Completed');
  jeq(logOf(id), ['start', 'pause', 'resume', 'masih lanjut', 'pending', 'lanjut', 'complete']);
});

test('2.6.9 KPI tab kolom M Availability + baris Proses, salinan KPI data pulang-pergi, Ringkasan tabel Availability', () => {
  const y = ctx.yearOf_(new FakeDate());
  ctx.buildKpi_(y);
  const K = ss.getSheetByName('KPI ' + y);
  assert.strictEqual(K.data[0].length, 13);
  assert.strictEqual(K.data[0][12], 'Availability (%)\n可用率（%）');
  const pr = K.data.filter(r => r[1] === 'Proses');
  assert.ok(pr.length >= 2 && pr.some(r => r[2] === ctx.KPI_RATA_), 'baris Proses + rata-rata');
  assert.ok(pr.every(r => r[12] === '' || (typeof r[12] === 'number' && r[12] >= 0 && r[12] <= 100)), 'availability 0–100');
  assert.ok(K.data.filter(r => r[1] === 'Plant' || r[1] === 'Project').every(r => r[12] === ''), 'Plant / Project tanpa availability');
  // bulan yang sudah ditutup (test sebelumnya): salinan berisi Availability dan dibaca kembali sama
  const closed = ctx.kpiClosed_(), ym = Object.keys(closed).sort().pop();
  assert.ok(ym, 'ada bulan tertutup');
  const snap = ctx.readTable_('KPI data').filter(r => r.Bulan === ym && r.Level === 'Proses');
  assert.ok(snap.length && snap.every(r => r['Availability (%)'] !== ''), 'KPI data: kolom Availability terisi');
  jeq(closed[ym].rows.filter(x => x.level === 'Proses').map(x => x.availability), snap.map(r => r['Availability (%)']));
  // Ringkasan: tabel Availability per proses membaca kolom M tab KPI (B = "Proses", C = nama kelompok)
  ctx.rapikanTampilan_({});
  const R = ss.getSheetByName('Ringkasan'), head = findCell(R, /^Availability per proses bulan ini/);
  assert.ok(head, 'judul tabel');
  const fx = Object.values(R.formulas || {}).concat(R.data.flat()).map(String).filter(v => /M2:M/.test(v) && /"Proses"/.test(v));
  assert.ok(fx.length >= 2, 'rumus FILTER kolom M');
  assert.ok(findCell(R, new RegExp('^' + ctx.KPI_RATA_.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')), 'baris rata-rata');
});

test('2.6.9 integritas: tab Maintenance diurutkan admin → ID baru tetap unik; malam mengurutkan ulang + Log', () => {
  const sh = ss.getSheetByName('Maintenance'), h = sh.data[0], cid = h.indexOf('Maintenance ID'), cl = h.indexOf('Line'), cm = h.indexOf('Mulai');
  const open = (id) => ctx.readTable_('Maintenance').some(r => r.Line === id && ['Aktif', 'Pause', 'Pending'].includes(r.Status));
  const line = ctx.readTable_('Lines').map(l => l['Line ID']).filter(id => /^L\d+$/.test(id) && !open(id))[0];
  const tech = ['budi@gmail.com', 'andi@gmail.com', 'sari@gmail.com', 'dewi@gmail.com'].filter(e => !ctx.readTable_('Maintenance').some(r => String(r['Teknisi terakhir']).toLowerCase() === e && ['Aktif', 'Pause'].includes(r.Status)))[0];
  const ids = [];
  for (let i = 0; i < 2; i++) { const id = as(tech, () => ctx.apiStart(line, { baterai: 'E22H' })).open.id; ids.push(id); as(tech, () => ctx.apiComplete(id, done)); advance(3); }
  // admin mengurutkan tab: pekerjaan hari ini di line itu pindah ke atas, jauh dari ekor yang dibaca tombol
  const body = sh.data.slice(1), mine = body.filter(r => ids.includes(r[cid]));
  sh.data = [h].concat(mine, body.filter(r => !ids.includes(r[cid])));
  const keep = ctx.HOT_TAIL_;
  ctx.HOT_TAIL_ = 2;
  let id3;
  try { id3 = as(tech, () => ctx.apiStart(line, { baterai: 'E22H' })).open.id; } finally { ctx.HOT_TAIL_ = keep; }
  assert.ok(!ids.includes(id3), 'ID baru ' + id3 + ' tidak memakai ulang ' + ids.join(', '));
  assert.strictEqual(sh.data.filter(r => r[cid] === id3).length, 1, 'ID unik');
  assert.strictEqual(Number(id3.slice(-2)), Math.max(...ids.map(x => Number(x.slice(-2)))) + 1, 'urutan berikutnya');
  as(tech, () => ctx.apiCancel(id3, { values: { 'Alasan cancel': 'Lainnya' }, other: { 'Alasan cancel': 'uji urut' } }));
  // malam: tab tidak urut → diurutkan ulang menurut Mulai + dicatat
  const sorts = sh.sorts || 0;
  ctx.refreshRekap();
  assert.strictEqual(sh.sorts, sorts + 1, 'diurutkan sekali');
  const t = sh.data.slice(1).filter(r => r[cm] instanceof Date).map(r => r[cm].getTime());
  assert.ok(t.every((v, i) => !i || t[i - 1] <= v), 'Mulai urut naik');
  assert.ok(ctx.readTable_('Log').some(r => r.Kejadian === 'urut ulang'), 'Log: urut ulang');
  ctx.refreshRekap();
  assert.strictEqual(sh.sorts, sorts + 1, 'sudah urut → tidak diurutkan lagi');
});

test('2.6.9 integritas: kolom disisipkan admin di kiri (Maintenance & Users) → data, login, tombol, laporan tetap benar', () => {
  const ins = (name) => { const sh = ss.getSheetByName(name); sh.data = sh.data.map((r, i) => [i ? (i % 3 ? i : '') : 'No.'].concat(r)); ctx.resetHeaders_(); ctx.invalidateMaster_(); };
  const del = (name) => { const sh = ss.getSheetByName(name); sh.data = sh.data.map(r => r.slice(1)); ctx.resetHeaders_(); ctx.invalidateMaster_(); };
  const n0 = ctx.readTable_('Maintenance').length, u0 = ctx.masterData_().users.length;
  ins('Maintenance'); ins('Users');
  try {
    assert.strictEqual(ctx.readTable_('Maintenance').length, n0, 'tidak ada baris "hilang" walau kolom A kosong');
    assert.strictEqual(ctx.masterData_().users.length, u0, 'semua user tetap terbaca (login)');
    const line = ctx.readTable_('Lines').map(l => l['Line ID']).filter(id => /^L\d+$/.test(id) && !ctx.readTable_('Maintenance').some(r => r.Line === id && ['Aktif', 'Pause', 'Pending'].includes(r.Status)))[0];
    const tech = ['budi@gmail.com', 'andi@gmail.com', 'sari@gmail.com', 'dewi@gmail.com'].filter(e => !ctx.readTable_('Maintenance').some(r => String(r['Teknisi terakhir']).toLowerCase() === e && ['Aktif', 'Pause'].includes(r.Status)))[0];
    const id = as(tech, () => ctx.apiStart(line, { baterai: 'E22H' })).open.id;
    as(tech, () => ctx.apiComplete(id, done));
    const r = ctx.readTable_('Maintenance').find(x => x['Maintenance ID'] === id);
    jeq([r.Line, r.Status, r['No.']], [line, 'Completed', ''], 'nilai masuk kolom yang benar menurut nama');
    ctx.refreshRekap();
    assert.ok(findCell(ss.getSheetByName('Laporan ' + ctx.yearOf_(new FakeDate())), new RegExp('^' + id + '$')), 'Laporan memuat pekerjaan baru');
  } finally { del('Maintenance'); del('Users'); }
  assert.strictEqual(ctx.APP.LOCK_TIMEOUT_MS, 25000, 'lock menunggu 25 dtk (±6 tombol bersamaan)');
});

test('2.6.9 kesehatan sistem: malam / cek timeout / backup gagal, tidak selesai, atau tidak jalan → peringatan Dashboard admin', () => {
  const props = () => ctx.PropertiesService.getDocumentProperties().getProperties();
  ctx.checkTimeouts(); ctx.backupTerjadwal(); ctx.refreshRekap();
  const now = new FakeDate();
  jeq(ctx.sehatPeringatan_(props(), now), [], 'sehat → tanpa peringatan');
  // langkah gagal: langkah lain tetap jalan, dicatat, trigger berakhir error (Google mengirim email kegagalan ke pemilik)
  const tpm = ctx.buildTpm_;
  ctx.buildTpm_ = () => { throw new Error('kuota terjemahan habis'); };
  try { throwsMsg(() => ctx.refreshRekap(), /gagal sebagian: TPM: kuota terjemahan habis/); } finally { ctx.buildTpm_ = tpm; }
  const m = JSON.parse(props().MTTR_SEHAT_malam);
  assert.ok(m.selesai && m.gagal.length === 1, 'tetap selesai, satu langkah gagal');
  assert.match(ctx.sehatPeringatan_(props(), now).join(' '), /pembaruan malam .* gagal sebagian — TPM: kuota terjemahan habis/);
  as('owner@gmail.com', () => assert.match(ctx.apiDashboard({ periode: 7 }).warnings[0], /^Sistem: pembaruan malam/));
  as('budi@gmail.com', () => assert.ok(!ctx.apiDashboard({ periode: 7 }).warnings.some(w => /^Sistem/.test(w)), 'teknisi tidak melihat'));
  // tidak selesai (lewat 6 menit) & tidak jalan > 36 jam & cek timeout > 2 jam
  const set = (k, o) => ctx.PropertiesService.getDocumentProperties().setProperty('MTTR_SEHAT_' + k, JSON.stringify(o));
  set('malam', { mulai: new Date(now.getTime() - 20 * 60000).toISOString(), selesai: '', gagal: [] });
  assert.match(ctx.sehatPeringatan_(props(), now).join(' '), /tidak selesai \(kemungkinan lewat batas waktu/);
  set('malam', { mulai: new Date(now.getTime() - 40 * 3600000).toISOString(), selesai: new Date(now.getTime() - 40 * 3600000).toISOString(), gagal: [] });
  set('timeout', { at: new Date(now.getTime() - 3 * 3600000).toISOString(), gagal: '' });
  const w = ctx.sehatPeringatan_(props(), now).join(' ');
  assert.match(w, /lebih dari sehari lalu/);
  assert.match(w, /cek pekerjaan lewat waktu terakhir jalan/);
  ctx.checkTimeouts(); ctx.refreshRekap();
  jeq(ctx.sehatPeringatan_(props(), new FakeDate()), [], 'pulih sendiri sesudah jalan lagi');
});

console.log('\n' + passed + ' test lulus' + (process.exitCode ? ', ADA YANG GAGAL' : ''));
