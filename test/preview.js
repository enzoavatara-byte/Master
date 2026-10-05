/**
 * Preview lokal UI tanpa Google: server HTTP kecil yang merender Index.html dan menjalankan
 * fungsi api* di atas mock Sheets (test/mock.js) dengan data contoh.
 *
 *   node test/preview.js            → http://localhost:8787/?as=owner@gmail.com
 *   tambah &line=L01 untuk simulasi scan QR.
 *
 * Hanya untuk melihat tampilan & alur. Bukan pengganti uji di Apps Script sungguhan.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
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
// Factory 1 (VF7, Limo7) & Factory 2 (E22H, E245). L03 punya sub-line A/B (Grup L03).
[['L01', 'Assy Cell 1', 'F1', '', '', 'Hall A'], ['L02', 'Assy Cell 2', 'F1', '', '', 'Hall A'], ['L03-A', 'Formation 1A', 'F1', '', 'L03', 'Hall B'],
 ['L03-B', 'Formation 1B', 'F1', '', 'L03', 'Hall B'], ['L11', 'Assy E22H', 'F2', 'E22H', '', 'Gedung 2'], ['L12', 'Assy E245', 'F2', 'E245', '', 'Gedung 2'],
 ['L13', 'Packing', 'F2', '', '', 'Gedung 2']].forEach(l => L.appendRow([...l, 'Ya']));
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
const BOM = ss.getSheetByName('BOM');
[['L01', 'M-STK', 'SN-100', 'Sensor proximity M12', 4, 'pcs', 'Rak A-01', 2], ['L01', 'M-WLD', 'WT-20', 'Welding tip', 6, 'pcs', 'Rak A-03', 10],
 ['L01', '', 'BL-1200', 'Belt conveyor 1200', 1, 'pcs', 'Rak B-03', 1], ['L03', 'M-CHG', 'CH-5', 'Kabel charger 5A', 12, 'pcs', 'Rak C-02', 6],
 ['L11', 'M-E1', 'NZ-3', 'Nozzle filling', 8, 'pcs', 'Gudang 2', 4], ['*', '', 'FU-10', 'Fuse 10A', 10, 'pcs', 'Rak Umum', 20]].forEach(b => BOM.appendRow([...b, 'Ya']));

const techs = ['budi@gmail.com', 'andi@gmail.com', 'sari@gmail.com'];
const probs = ['Sensor error', 'Mesin berhenti', 'Kebocoran', 'Suara/getaran abnormal'];
const jobs = [['L01', 'M-STK', 'VF7'], ['L01', 'M-WLD', 'Limo7'], ['L02', 'M-HPR', 'VF7'], ['L03-A', 'M-AGE', 'VF7'], ['L11', 'M-E1', 'E22H'],
  ['L12', 'M-E3', 'E245'], ['L01', 'M-STK', 'Limo7'], ['L11', 'M-E2', 'E22H'], ['L13', 'M-PK', 'E245']];
const sel = (m, extra) => ({ values: { Masalah: m, Penyebab: 'Komponen aus', Penanganan: 'Ganti part' }, ...extra });
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
      ctx.apiComplete(id, sel(k % 11 === 4 ? 'Lainnya' : probs[k % 4], { other: { Masalah: 'konektor gosong' }, parts: k % 2 ? [{ nama: 'FU-10 Fuse 10A', jumlah: 1 }] : [], tanpaPart: !(k % 2) }));
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

// ---------- server ----------
const src = path.join(__dirname, '..', 'src');
const read = (n) => fs.readFileSync(path.join(src, n + '.html'), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function render(name, vars) {
  return read(name)
    .replace(/<\?!= include\('(\w+)'\); \?>/g, (m, n) => n === 'App' ? STUB + read(n) : read(n))
    .replace(/<\?!= JSON\.stringify\(lineId\) \?>/g, JSON.stringify(vars.lineId || ''))
    .replace(/<\?!= JSON\.stringify\(mesinId\) \?>/g, JSON.stringify(vars.mesinId || ''))
    .replace(/<\?= (\w+) \?>/g, (m, v) => esc(vars[v] || ''))
    .replace(/<\?!= (\w+) \?>/g, (m, v) => vars[v] || '');
}
const STUB = `<script>
(function () {
  var who = new URLSearchParams(location.search).get('as') || 'owner@gmail.com';
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, fn) {
      if (fn === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (fn === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: fn, args: args, as: who }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { setTimeout(function () { j.error ? fail && fail(new Error(j.error)) : ok && ok(j.result); }, 150); });
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>`;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { fn, args, as: who } = JSON.parse(body);
      let out;
      try {
        if (!/^api[A-Z]\w+$/.test(fn) || typeof ctx[fn] !== 'function') throw new Error('Unknown fn ' + fn);
        out = { result: JSON.parse(JSON.stringify(as(who, () => ctx[fn](...args)))) };
      } catch (e) { out = { error: 'Exception: ' + e.message }; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  const who = url.searchParams.get('as') || 'owner@gmail.com';
  const r = as(who, () => ctx.doGet({ parameter: { line: url.searchParams.get('line') || '', mesin: url.searchParams.get('mesin') || '' } }));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(r.template === 'Index'
    ? render('Index', { lineId: r.vars.lineId, mesinId: r.vars.mesinId }).replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">')
    : render('Message', r.vars));
}).listen(Number(process.env.PORT || 8787), () => console.log('Preview: http://localhost:' + (process.env.PORT || 8787) + '/?as=owner@gmail.com'));
