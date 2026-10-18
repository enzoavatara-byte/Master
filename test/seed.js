/**
 * Data contoh bersama untuk test/preview.js dan test/perf.js: 2 factory, proses, alias, sub-line A/B, mesin,
 * katalog sparepart, ±70 pekerjaan 4 minggu terakhir. Jam mock mengikuti jam asli setelah seeding.
 */
'use strict';
const { ctx, ss, clock, user } = require('./mock');

const RealNow = Date.now;
let shiftMs = 0;
Object.defineProperty(clock, 'now', { get: () => RealNow() + shiftMs, set: (v) => { shiftMs = v - RealNow(); } });
const at = (minutesAgo) => { shiftMs = -minutesAgo * 60000; };
const as = (email, fn) => { const p = user.email; user.email = email; try { return fn(); } finally { user.email = p; } };

// ---------- data contoh ----------
at(8 * 24 * 60);
ctx.setup();
const U = ss.getSheetByName('Users');
U.data[1] = ['owner@gmail.com', 'Radya Pradipta', 'Admin', 'Ya'];
U.appendRow(['budi@gmail.com', 'Budi Santoso', 'Teknisi', 'Ya']);
U.appendRow(['andi@gmail.com', 'Andi Wijaya', 'Teknisi', 'Ya']);
U.appendRow(['sari@gmail.com', 'Sari Lestari', 'Teknisi', 'Ya']);
const L = ss.getSheetByName('Lines');
const rowOf = (sheet, obj) => ctx.objToRow_(ss.getSheetByName(sheet).data[0].map(h => String(h).trim()), obj);
// Factory 1 (VF7, Limo7) & Factory 2 (E22H, E245). L03 punya sub-line A/B (Grup L03).
// [Line ID, Nama, Factory, Baterai, Grup, Area, Proses, Alias]
[['L01', 'Assy Cell 1', 'F1', '', '', 'Hall A', 'Assembly', 'AC1, Cell satu'], ['L02', 'Assy Cell 2', 'F1', '', '', 'Hall A', 'Assembly', 'AC2'],
 ['L03-A', 'Formation 1A', 'F1', '', 'L03', 'Hall B', 'Formation', ''], ['L03-B', 'Formation 1B', 'F1', '', 'L03', 'Hall B', 'Formation', ''],
 ['L11', 'Assy E22H', 'F2', 'E22H', '', 'Gedung 2', 'Modul Line', 'E22 assy'], ['L12', 'Assy E245', 'F2', 'E245', '', 'Gedung 2', 'Modul Line', ''],
 ['L13', 'Packing', 'F2', '', '', 'Gedung 2', 'Packing', 'Wrapping']].forEach(l => L.appendRow(rowOf('Lines', {
  'Line ID': l[0], 'Nama Line': l[1], 'Factory ID': l[2], 'Baterai': l[3], 'Grup': l[4], 'Area': l[5], 'Proses': l[6], 'Alias': l[7], 'Aktif': 'Ya' })));
const F = ss.getSheetByName('Factory');
F.data[1][2] = 'Bogor'; F.data[2][2] = 'Cikarang';
const P = ss.getSheetByName('Projects'), ph = P.data[0];
P.data.slice(1).forEach(r => {
  const b = r[ph.indexOf('Baterai')];
  r[ph.indexOf('Fase')] = { VF7: 'Trial', Limo7: 'Mass Production', E22H: 'Mass Production', E245: 'Ramp-up' }[b];
  r[ph.indexOf('Target MTTR (menit)')] = { VF7: 45, Limo7: 30, E22H: 30, E245: 40 }[b];
});
const MS = ss.getSheetByName('Mesin');
[['M-STK', 'Stacking', 'L01'], ['M-WLD', 'Welding', 'L01'], ['M-HPR', 'Heat press', 'L02'], ['M-CHG', 'Charger', 'L03'], ['M-AGE', 'Aging rack', 'L03-A'],
 ['M-E1', 'Filling', 'L11'], ['M-E2', 'Sealing', 'L11'], ['M-E3', 'Filling', 'L12'], ['M-PK', 'Wrapping', 'L13']].forEach(m => MS.appendRow([...m, 'Ya']));
ss.getSheetByName('Catatan Panduan').appendRow(rowOf('Catatan Panduan', { Untuk: 'Teknisi', Judul: 'Kunci panel listrik', Isi: 'Ambil di pos security Hall A.\nTulis nama & jam di buku kunci.', Urutan: 1, Aktif: 'Ya' }));
const pid = (j, n, m) => ctx.partId_(j, n, m);
const PARTS = [[{ id: pid('Elektrikal', 'Fuse', '10A'), qty: 1 }], [{ id: pid('Mekanikal', 'Bearing', '6205-2RS'), qty: 2 }, { id: pid('Mekanikal', 'Timing Belt', 'HTD 5M-450'), qty: 1 }],
  [{ id: pid('Pneumatik', 'Selang PU', '8 mm'), qty: 3 }], [{ id: pid('Elektrikal', 'Sensor Proximity', 'Omron E2E-X5ME1'), qty: 1 }, { manual: true, jenis: 'Elektrikal', nama: 'Kabel NYAF', model: '1.5mm', qty: 2 }]];
const JENIS = ['Elektrikal', 'Mekanikal', 'Pneumatik', 'Elektrikal'];

const techs = ['budi@gmail.com', 'andi@gmail.com', 'sari@gmail.com'];
const probs = ['Sensor error', 'Mesin berhenti', 'Kebocoran', 'Suara/getaran abnormal'];
const jobs = [['L01', 'M-STK', 'VF7'], ['L01', 'M-WLD', 'Limo7'], ['L02', 'M-HPR', 'VF7'], ['L03-A', 'M-AGE', 'VF7'], ['L11', 'M-E1', 'E22H'],
  ['L12', 'M-E3', 'E245'], ['L01', 'M-STK', 'Limo7'], ['L11', 'M-E2', 'E22H'], ['L13', 'M-PK', 'E245']];
const sel = (m, extra) => ({ values: { Masalah: m, Penyebab: 'Komponen aus', Penanganan: 'Ganti part' }, ...extra });
const done = (k) => {
  const x = sel(k % 11 === 4 ? 'Lainnya' : probs[k % 4], { other: { Masalah: 'konektor gosong' }, parts: k % 2 ? PARTS[k % 4] : [], tanpaPart: !(k % 2) });
  x.values['Jenis kerusakan'] = JENIS[k % 4];
  if (k % 3 === 1) x.values['Detail masalah'] = 'Conveyor ' + 'ABC'[k % 3] + ' berhenti mendadak';
  return x;
};
let k = 0;
for (let day = 27; day >= 1; day--) {
  const n = [2, 4, 1, 3, 5, 2, 0][day % 7];
  for (let i = 0; i < n; i++) {
    const t = techs[k % 3], j = jobs[(k * 5) % jobs.length], start = day * 1440 - 8 * 60 - i * 90;
    const activeMin = 20 + ((k * 17) % 50);
    at(start);
    as(t, () => {
      const id = ctx.apiStart(j[0], { mesin: j[1], baterai: j[2], tipe: k % 6 === 5 ? 'Preventive' : 'Corrective' }).open.id;
      if (k % 3 === 0) { at(start - 10); ctx.apiPause(id, 'Ambil part/alat'); at(start - 18); ctx.apiResume(id); }
      at(start - activeMin - (k % 3 === 0 ? 8 : 0));
      ctx.apiComplete(id, done(k));
    });
    k++;
  }
}
// cancelled (perlu review)
at(26 * 60); as('sari@gmail.com', () => { const id = ctx.apiStart('L13', { mesin: 'M-PK', baterai: 'E245' }).open.id; at(26 * 60 - 3); ctx.apiCancel(id, 'Salah line'); });
// abandoned
at(20 * 60); as('budi@gmail.com', () => ctx.apiStart('L12', { mesin: 'M-E3', baterai: 'E245' }));
at(20 * 60 - 185); ctx.checkTimeouts(); at(20 * 60 - 250); ctx.checkTimeouts();
// pending lewat tenggat
at(30 * 60); as('andi@gmail.com', () => {
  const id = ctx.apiStart('L03-A', { mesin: 'M-CHG', baterai: 'VF7' }).open.id; at(30 * 60 - 40);
  ctx.apiPending(id, { values: { 'Pekerjaan dilakukan': 'Cek wiring & konektor, kabel charger putus', 'Yang tertunda': 'Menunggu part', Catatan: 'Part sudah di-PO' }, tenggat: 'HARI_INI' });
});
// pending belum lewat tenggat
at(3 * 60); as('sari@gmail.com', () => {
  const id = ctx.apiStart('L11', { mesin: 'M-E2', baterai: 'E22H' }).open.id; at(3 * 60 - 25);
  ctx.apiPending(id, { values: { 'Pekerjaan dilakukan': 'Bongkar cover, seal aus', 'Yang tertunda': 'Menunggu jadwal stop produksi' }, tenggat: 'BESOK' });
});
// sedang berjalan: 2 teknisi di 2 mesin pada line yang sama (L01)
at(50); as('budi@gmail.com', () => ctx.apiStart('L01', { mesin: 'M-WLD', baterai: 'VF7' }));
at(25); as('owner@gmail.com', () => ctx.apiStart('L01', { mesin: 'M-STK', baterai: 'Limo7' }));
at(0);


module.exports = { as };
