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
const { ctx } = require('./mock');

const { as } = require('./seed');

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
    ? render('Index', { lineId: r.vars.lineId, mesinId: r.vars.mesinId, boot: r.vars.boot }).replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">')
    : render('Message', r.vars));
}).listen(Number(process.env.PORT || 8787), () => console.log('Preview: http://localhost:' + (process.env.PORT || 8787) + '/?as=owner@gmail.com'));
