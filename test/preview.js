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
[['L01', 'Assy Cell 1', 'Hall A'], ['L02', 'Assy Cell 2', 'Hall A'], ['L03', 'Formation 1', 'Hall B'],
 ['L04', 'Formation 2', 'Hall B'], ['L05', 'Packing', 'Hall C'], ['L06', 'Charging', 'Hall C']].forEach(l => L.appendRow([...l, 'Ya']));

const techs = ['budi@gmail.com', 'andi@gmail.com', 'sari@gmail.com'];
const probs = ['Sensor error', 'Mesin berhenti', 'Kebocoran', 'Suara/getaran abnormal'];
let k = 0;
for (let day = 6; day >= 1; day--) {
  const n = [2, 4, 1, 3, 5, 2][6 - day];
  for (let i = 0; i < n; i++) {
    const t = techs[k % 3], line = 'L0' + ((k % 6) + 1), start = day * 1440 - 8 * 60 - i * 90;
    const activeMin = 20 + ((k * 17) % 50);
    at(start);
    as(t, () => {
      const id = ctx.apiStart(line, k % 2 ? 'E245' : 'E22H').open.id;
      if (k % 3 === 0) { at(start - 10); ctx.apiPause(id, 'Ambil part/alat'); at(start - 18); ctx.apiResume(id); }
      at(start - activeMin - (k % 3 === 0 ? 8 : 0));
      ctx.apiComplete(id, { masalah: probs[k % 4], penyebab: 'Komponen aus', penanganan: 'Ganti part', parts: k % 2 ? [{ nama: 'Fuse', jumlah: 1 }] : [], tanpaPart: !(k % 2) });
    });
    k++;
  }
}
// cancelled (perlu review)
at(26 * 60); as('sari@gmail.com', () => { const id = ctx.apiStart('L06', 'E245').open.id; at(26 * 60 - 3); ctx.apiCancel(id, 'Salah line'); });
// abandoned
at(20 * 60); as('budi@gmail.com', () => ctx.apiStart('L05', 'E22H'));
at(20 * 60 - 185); ctx.checkTimeouts(); at(20 * 60 - 250); ctx.checkTimeouts();
// pending lewat tenggat
at(30 * 60); as('andi@gmail.com', () => {
  const id = ctx.apiStart('L03', 'E22H').open.id; at(30 * 60 - 40);
  ctx.apiPending(id, { dikerjakan: 'Cek wiring & konektor, sensor proximity rusak', tertunda: 'Menunggu part', tenggat: 'HARI_INI', catatan: 'Part sudah di-PO' });
});
// pending belum lewat tenggat
at(3 * 60); as('sari@gmail.com', () => {
  const id = ctx.apiStart('L05', 'E245').open.id; at(3 * 60 - 25);
  ctx.apiPending(id, { dikerjakan: 'Bongkar cover, belt aus', tertunda: 'Menunggu jadwal stop produksi', tenggat: 'BESOK' });
});
// sedang berjalan
at(50); as('budi@gmail.com', () => ctx.apiStart('L04', 'E22H'));
at(25); as('owner@gmail.com', () => ctx.apiStart('L02', 'E245'));
at(0);

// ---------- server ----------
const src = path.join(__dirname, '..', 'src');
const read = (n) => fs.readFileSync(path.join(src, n + '.html'), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function render(name, vars) {
  return read(name)
    .replace(/<\?!= include\('(\w+)'\); \?>/g, (m, n) => n === 'App' ? STUB + read(n) : read(n))
    .replace(/<\?!= JSON\.stringify\(lineId\) \?>/g, JSON.stringify(vars.lineId || ''))
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
  const r = as(who, () => ctx.doGet({ parameter: { line: url.searchParams.get('line') || '' } }));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(r.template === 'Index'
    ? render('Index', { lineId: r.vars.lineId }).replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">')
    : render('Message', r.vars));
}).listen(Number(process.env.PORT || 8787), () => console.log('Preview: http://localhost:' + (process.env.PORT || 8787) + '/?as=owner@gmail.com'));
