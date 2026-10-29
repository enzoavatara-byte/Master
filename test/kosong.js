/**
 * 2.6.9: spreadsheet BARU yang diserahkan kosong (3 user, tanpa line & sparepart, baris CONTOH) — proses mock sendiri,
 * karena test/run.js memakai isi bawaan versi lama. Jalankan: node test/kosong.js (ikut `npm test`).
 */
'use strict';
const assert = require('assert');
const { ctx, ss, user, advance, FakeDate, docProps } = require('./mock');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
}
const as = (email, fn) => { const p = user.email; user.email = email; try { return fn(); } finally { user.email = p; } };
const jeq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const rows = (n) => ss.getSheetByName(n).data.slice(1).filter(r => r.some(v => v !== ''));
const rowOf = (sheet, obj) => ctx.objToRow_(ss.getSheetByName(sheet).data[0].map(h => String(h).trim()), obj);

console.log('MTTR 2.6.9 spreadsheet kosong siap pakai');

test('setup di spreadsheet kosong: 3 baris CONTOH per tab master (abu-abu, diabaikan), tanpa project / part palsu, tanpa tab per project', () => {
  ctx.setup();
  ['Factory', 'Projects', 'Lines', 'Sparepart'].forEach(n => {
    const h = ss.getSheetByName(n).data[0], a = h.indexOf('Aktif');
    assert.strictEqual(rows(n).length, 3, n + ': 3 contoh');
    assert.ok(rows(n).every(r => r[a] === 'Contoh'), n + ': Aktif = Contoh');
  });
  const md = ctx.masterData_();
  jeq([md.factories.length, md.projects.length, Object.keys(md.lines).length, md.spareparts.length, md.allBatteries], [0, 0, 0, 0, []], 'contoh tidak masuk master');
  assert.ok(!md.warnings.some(w => /contoh/i.test(w)), 'contoh asli tanpa peringatan: ' + md.warnings.join(' | '));
  assert.ok(!ss.sheets.some(s => /^(Maintenance|TPM) (VF7|Limo7|E22H|E245|CONTOH)/.test(s.getName())), 'tanpa tab per project palsu');
  jeq(md.options['Proses'], ['Modul Line', 'Pack Line', 'Pre-Assy'], 'Pilihan Proses bawaan');
  // tampilan: contoh abu-abu miring + catatan di header Aktif; dropdown Proses / Jenis Sparepart
  const L = ss.getSheetByName('Lines');
  assert.ok(L.cfRules.some(r => r.calls.setItalic === true), 'aturan miring untuk Aktif = Contoh');
  assert.ok(L.fmt.some(f => f[0] === 'setNote' && /CONTOH|Contoh/.test(f[2][0])), 'catatan header');
  assert.ok(L.validations.some(v => (v.rule.calls.requireValueInList || [])[0] && v.rule.calls.requireValueInList[0].includes('Pre-Assy')), 'dropdown Proses');
});

test('setup ulang: contoh tidak ditulis lagi (juga sesudah dihapus admin)', () => {
  const S = ss.getSheetByName('Sparepart');
  S.data = [S.data[0]];   // admin menghapus contoh sparepart
  ctx.setup();
  assert.strictEqual(rows('Sparepart').length, 0, 'sparepart tetap kosong');
  assert.strictEqual(rows('Lines').length, 3, 'contoh lines tidak dobel');
  assert.ok(JSON.parse(docProps.getProperty('MTTR_CONTOH_DONE')).Sparepart);
});

test('3 user awal; layar kosong yang memandu: semua api, malam, backup, KPI, tutup bulan tanpa error', () => {
  const U = ss.getSheetByName('Users');
  U.data = [U.data[0], rowOf('Users', { Email: 'owner@gmail.com', Nama: 'Admin Cikarang', Peran: 'Admin', Aktif: 'Ya' }),
    rowOf('Users', { Email: 'tek1@example.com', Nama: 'Teknisi Satu', Peran: 'Teknisi', Aktif: 'Ya' }),
    rowOf('Users', { Email: 'tek2@example.com', Nama: 'Teknisi Dua', Peran: 'Teknisi', Aktif: 'Ya', Bahasa: 'zh' })];
  ctx.invalidateMaster_();
  as('tek1@example.com', () => {
    const b = ctx.apiBootstrap('');
    jeq([b.master.lines.length, b.master.spareparts.length, b.myOpen], [0, 0, null]);
    assert.strictEqual(ctx.apiGetLine('CONTOH-F1-ML-01').found, false, 'line contoh tidak bisa di-scan');
    ctx.apiHistory({ scope: 'all' }); ctx.apiListPending(); ctx.apiDashboard({ periode: 7 });
    ctx.apiStats({ from: '2026-09-01', to: '2026-09-30', by: 'proses', measure: 'frek' });
  });
  as('owner@gmail.com', () => {
    const d = ctx.apiDashboard({ periode: 30 });
    jeq(d.kpiMonth.rows.map(x => x.level), ['Plant'], 'KPI: hanya Plant (0 line, tanpa baris Proses)');
    assert.strictEqual(ctx.apiListLinesForQr().lines.length, 0, 'QR: contoh tidak dicetak');
    ctx.apiExport({ from: '2026-09-01', to: '2026-09-30' });
    ctx.apiBuildReports();
  });
  ctx.checkTimeouts(); ctx.backupTerjadwal(); ctx.refreshRekap();
  const now0 = new FakeDate(), pm = ctx.monthOf_(now0) === 1 ? ctx.ymKey_(ctx.yearOf_(now0) - 1, 12) : ctx.ymKey_(ctx.yearOf_(now0), ctx.monthOf_(now0) - 1);
  as('owner@gmail.com', () => assert.strictEqual(ctx.apiTutupBulan(pm).plant.kerusakan, 0, 'tutup bulan tanpa data'));
  const y = ctx.yearOf_(new FakeDate());
  const K = ss.getSheetByName('KPI ' + y);
  assert.ok(K && K.data.slice(1).every(r => r[1] !== 'Proses'), 'tab KPI tanpa baris Proses');
  assert.ok(ss.getSheetByName('Ringkasan'), 'Ringkasan dibuat');
  assert.ok(ss.getSheetByName('Ringkasan').data.flat().some(v => /belum ada line aktif/.test(String(v))), 'Ringkasan: tabel Availability kosong dengan keterangan');
  jeq(ctx.sehatPeringatan_(ctx.PropertiesService.getDocumentProperties().getProperties(), new FakeDate()), [], 'sistem sehat');
});

test('admin mengisi sendiri: paste katalog berantakan, Proses beda ejaan, contoh diubah tanpa Aktif = Ya → peringatan jelas, tidak error', () => {
  const add = (sheet, o) => ss.getSheetByName(sheet).appendRow(rowOf(sheet, o));
  add('Factory', { 'Factory ID': 'F1', Nama: 'Factory 1', Aktif: 'Ya' });
  add('Projects', { 'Factory ID': 'F1', Baterai: 'VF7', Aktif: 'Ya' });
  // Lines: ejaan Proses beda-beda; satu proses baru di luar Pilihan; contoh ditimpa tapi Aktif masih "Contoh"
  add('Lines', { 'Line ID': 'F1-ML-01', 'Nama Line': 'Modul 1', Proses: 'modul line ', 'Factory ID': 'F1', Aktif: 'Ya' });
  add('Lines', { 'Line ID': 'F1-ML-02', 'Nama Line': 'Modul 2', Proses: 'Modul Line', 'Factory ID': 'F1', Aktif: 'Ya' });
  add('Lines', { 'Line ID': 'F1-PA-01', 'Nama Line': 'Pre 1', Proses: 'Pre Assy', 'Factory ID': 'F1', Aktif: 'Ya' });
  add('Lines', { 'Line ID': 'F1-FM-01', 'Nama Line': 'Formation 1', Proses: 'Formation', 'Factory ID': 'F1', Aktif: 'Ya' });
  const L = ss.getSheetByName('Lines'), lh = L.data[0];
  L.data[1][lh.indexOf('Line ID')] = 'F1-PL-01'; L.data[1][lh.indexOf('Nama Line')] = 'Pack 1';   // contoh ditimpa, Aktif lupa diganti
  // Sparepart: baris kosong di tengah, header ikut ter-paste, spasi, Model angka, duplikat, tanpa Aktif
  const S = ss.getSheetByName('Sparepart'), sh = S.data[0];
  const part = (j, n, m, a) => rowOf('Sparepart', { 'Jenis Sparepart': j, 'Nama Sparepart': n, Model: m, Satuan: 'pcs', Aktif: a === undefined ? 'Ya' : a });
  S.data.push(part('Mekanikal', 'Bearing', 6205), sh.map(() => ''), part('Elektrikal', ' Sensor proximity ', 'E2E-X5 ', ''), sh.slice(),
    part('Mekanikal', 'Bearing', '6205'), part('Mekanikal', 'Bearing', '6206 · P001', 'Contoh'));
  ctx.invalidateMaster_();
  const md = ctx.masterData_(), w = md.warnings.join(' | ');
  jeq(Object.keys(md.lines).sort(), ['F1-FM-01', 'F1-ML-01', 'F1-ML-02', 'F1-PA-01'], 'line asli saja');
  jeq(['F1-ML-01', 'F1-ML-02', 'F1-PA-01', 'F1-FM-01'].map(k => md.lines[k].proses), ['Modul Line', 'Modul Line', 'Pre-Assy', 'Formation'], 'ejaan dibakukan');
  assert.match(w, /Proses "modul line" \(1 line\) dianggap "Modul Line"/);
  assert.match(w, /Proses "Pre Assy" \(1 line\) dianggap "Pre-Assy"/);
  assert.match(w, /Proses "Formation" \(1 line\) belum ada di Pilihan → Proses/);
  assert.match(w, /Lines: line F1-PL-01 ditandai contoh/, 'contoh diubah tanpa Aktif = Ya');
  jeq(md.spareparts.map(p => p.nama + '|' + p.model).sort(), ['Bearing|6205', 'Sensor proximity|E2E-X5'], 'part unik, spasi dirapikan, Model angka = teks');
  assert.match(w, /Sparepart: "Bearing 6205" ditulis dua kali/);
  assert.match(w, /1 baris judul .* ikut ter-paste/);
  assert.match(w, /Sparepart: "Bearing 6206 · P001" \(baris \d+\) Aktif = Contoh/);
  // KPI: kelompok Availability tidak pecah karena ejaan
  const y = ctx.yearOf_(new FakeDate()), m = ctx.monthOf_(new FakeDate());
  const k = ctx.computeKpi_(y, m, [], md, ctx.kpiSettings_(), new FakeDate()).filter(x => x.level === 'Proses').map(x => x.nama);
  jeq(k, ['F1 · Formation', 'F1 · Modul Line', 'F1 · Pre-Assy', ctx.KPI_RATA_]);
  // pekerjaan pertama dari HP di line asli
  as('tek1@example.com', () => {
    const id = ctx.apiStart('F1-ML-01', { baterai: 'VF7' }).open.id;
    advance(30);
    ctx.apiComplete(id, { values: { 'Jenis kerusakan': 'Mekanikal', Masalah: 'Mesin berhenti', Penyebab: 'Komponen aus', Penanganan: 'Ganti part' }, other: {},
      parts: [{ id: md.spareparts[0].id, qty: 1 }] });
    assert.strictEqual(ctx.readTable_('Maintenance').find(r => r['Maintenance ID'] === id).Proses, 'Modul Line', 'Proses baku tersimpan');
  });
});

console.log('\n' + passed + ' test lulus' + (process.exitCode ? ', ADA YANG GAGAL' : ''));
