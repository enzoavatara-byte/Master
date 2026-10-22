/**
 * UJI 2.6 DI APPS SCRIPT ASLI — hanya untuk spreadsheet uji. JANGAN disalin ke spreadsheet produksi.
 * Dibuat oleh test/gas-uji.js: UJI_ (di atas file ini) = data 104 pekerjaan + angka harapan, dihitung dari kode yang sama
 * di atas mock. Di sini angka itu dibandingkan dengan hasil runtime Apps Script asli.
 *   1. Run ujiIsiData   → setup, tulis data, setup ulang (Laporan, Rekap, TPM, KPI, Ringkasan), tutup bulan lalu
 *   2. Run ujiPeriksa   → bandingkan + uji alur & kecepatan nyata → tab "Uji 2.6"
 */

var UJI_SHEET_ = 'Uji 2.6';

function ujiMe_() {
  var me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!me) throw new Error('Email pelaksana tidak terbaca. Jalankan dari editor Apps Script dengan akun pemilik spreadsheet.');
  return me;
}

/** {d: ms} → Date; email admin placeholder → email pelaksana. */
function ujiVal_(v, me) {
  if (v && typeof v === 'object' && v.d != null) return new Date(v.d);
  return typeof v === 'string' ? v.split(UJI_.meta.admin).join(me) : v;
}

function ujiTulis_(ss, name, rows, me) {
  var sh = findSheet_(name, ss) || ss.insertSheet(name);
  var w = rows[0].length;
  var vals = rows.map(function (r) { var x = r.map(function (v) { return ujiVal_(v, me); }); while (x.length < w) x.push(''); return x; });
  sh.clearContents();
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  if (sh.getMaxRows() < vals.length + 5) sh.insertRowsAfter(sh.getMaxRows(), vals.length + 5 - sh.getMaxRows());
  sh.getRange(1, 1, vals.length, w).setValues(vals);
  forgetHeaders_(name);
}

function ujiIsiData() {
  var t0 = Date.now(), me = ujiMe_(), ss = SpreadsheetApp.getActive(), log = [];
  var s1 = setup();                                   // spreadsheet kosong → semua tab & judul kolom
  log.push('setup 1: ' + s1);
  var D = UJI_.data;
  ['Users', 'Factory', 'Projects', 'Lines', 'Maintenance', 'Log', 'Pemakaian Sparepart'].forEach(function (n) { ujiTulis_(ss, n, D[n], me); });
  var cfg = findSheet_('Config', ss), cv = cfg.getDataRange().getValues(), ck = cv[0].indexOf('Key'), cval = cv[0].indexOf('Value');
  Object.keys(UJI_.meta.config).forEach(function (k) {
    for (var i = 1; i < cv.length; i++) if (String(cv[i][ck]).trim() === k) cfg.getRange(i + 1, cval + 1).setValue(UJI_.meta.config[k]);
  });
  log.push('data: ' + (D.Maintenance.length - 1) + ' pekerjaan, ' + (D.Log.length - 1) + ' baris Log, ' + (D['Pemakaian Sparepart'].length - 1) + ' sparepart');
  invalidateMaster_(); resetMaster_();
  var s2 = setup();                                   // bangun ulang dari data: Laporan, Rekap, TPM, KPI, Ringkasan, tab per baterai
  log.push('setup 2: ' + s2);
  var c = apiTutupBulan(UJI_.meta.prevKey);
  log.push('tutup bulan ' + c.label + ': ' + kpiBrief_(c.plant));
  log.push('waktu total ' + Math.round((Date.now() - t0) / 1000) + ' dtk');
  ujiHasil_([[1, 'ujiIsiData', 'SELESAI', log.join('\n'), Date.now() - t0]], 'Data diisi. Sekarang Run ujiPeriksa.');
  return log.join('\n');
}

// ---------- pembanding ----------

function ujiNorm_(v, kind) {
  if (v && typeof v === 'object' && v.d != null) v = new Date(v.d);
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, kind === 'jam' ? 'HH:mm' : (kind === 'tgl' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'));
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Bandingkan tabel per kunci. exp/act: {kunci: [nilai…]}. Laporan per kolom: nilai ATAU tampilan sama → cocok. */
function ujiTabel_(ok, cek, exp, act, actDisp, cols, opts) {
  opts = opts || {};
  var keys = Object.keys(exp), miss = [], extra = [], diff = [], perCol = {};
  keys.forEach(function (k) {
    if (!act[k]) { miss.push(k); return; }
    exp[k].forEach(function (e, j) {
      if (opts.skip && opts.skip(k, j)) return;
      var en = ujiNorm_(e, opts.kind && opts.kind[j]), an = ujiNorm_(act[k][j], opts.kind && opts.kind[j]);
      var ad = actDisp && actDisp[k] ? String(actDisp[k][j]).trim() : null;
      if (en === an || (ad !== null && ad === en)) return;
      if (opts.loose && opts.loose(j, en, an)) return;
      perCol[cols[j]] = (perCol[cols[j]] || 0) + 1;
      if (diff.length < 12) diff.push(k + ' · ' + cols[j] + ': harap "' + en + '" ≠ dapat "' + an + '"' + (ad !== null && ad !== an ? ' (tampil "' + ad + '")' : ''));
    });
  });
  Object.keys(act).forEach(function (k) { if (!exp[k]) extra.push(k); });
  var n = Object.keys(perCol).reduce(function (a, c) { return a + perCol[c]; }, 0);
  ok(cek, !miss.length && !extra.length && !n, keys.length + ' baris dibanding' + (miss.length ? ' · hilang: ' + miss.slice(0, 5).join(', ') : '') +
    (extra.length ? ' · lebih: ' + extra.slice(0, 5).join(', ') : '') + (n ? ' · ' + n + ' sel beda per kolom ' + JSON.stringify(perCol) + '\n' + diff.join('\n') : ''));
}

/** Baris harapan berisi terjemahan palsu mock ("[en] …" / "[zh-CN] …") = teks Google: cukup terisi, baris lain harus sama. */
function ujiTerjemahanSama_(e, a) {
  if (!/\[(en|zh-CN)\] /.test(e)) return false;
  var el = e.split('\n'), al = a.split('\n');
  return el.length === al.length && el.every(function (x, i) { return /\[(en|zh-CN)\] /.test(x) ? al[i].replace(/[()\s]/g, '').length > 0 : x === al[i]; });
}

function ujiCari_(vals, re) {
  for (var i = 0; i < vals.length; i++) for (var j = 0; j < vals[i].length; j++) if (re.test(String(vals[i][j]))) return { r: i, c: j };
  return null;
}

function ujiPeriksa() {
  var T0 = Date.now(), me = ujiMe_(), ss = SpreadsheetApp.getActive(), y = UJI_.meta.year, res = [], waktu = [];
  var ok = function (cek, pass, detail, ms) { res.push([res.length + 1, cek, pass ? 'LULUS' : 'GAGAL', String(detail || '').slice(0, 2000), ms == null ? '' : ms]); return pass; };
  var safe = function (cek, fn) { try { fn(); } catch (e) { ok(cek, false, 'Error: ' + (e && e.message || e) + (e && e.stack ? '\n' + String(e.stack).slice(0, 600) : '')); } };
  var timed = function (label, fn) { var t = Date.now(), v = fn(); var ms = Date.now() - t; waktu.push([label, ms]); return { v: v, ms: ms }; };
  var todayKey = Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'), sameDay = todayKey === UJI_.meta.todayKey;
  var curKey = todayKey.slice(0, 7);
  resetMaster_();

  // ---- tab buatan Apps Script dibanding hasil kode yang sama di mock ----
  safe('Laporan ' + y + ': 100 baris, isi sama', function () {
    var sh = ss.getSheetByName(laporanName_(y)), v = sh.getDataRange().getValues(), d = sh.getDataRange().getDisplayValues();
    var w = v[1].length - 1, act = {}, disp = {};
    for (var i = 2; i < v.length; i++) if (v[i][w]) { act[v[i][w]] = v[i].slice(0, w); disp[v[i][w]] = d[i].slice(0, w); }
    var exp = {}; UJI_.expect.laporan.forEach(function (r) { exp[r[r.length - 1]] = r.slice(0, r.length - 1); });
    var kinds = UJI_.expect.laporanHead.map(function (h) { return /Tanggal/.test(h) ? 'tgl' : ''; });
    ok('Laporan ' + y + ': jumlah baris', Object.keys(act).length === 100, Object.keys(act).length + ' baris (harap 100)');
    ujiTabel_(ok, 'Laporan ' + y + ': isi sel', exp, act, disp, UJI_.expect.laporanHead, { kind: kinds });
  });
  safe('Rekap ' + y, function () {
    var v = ss.getSheetByName(rekapName_(y)).getDataRange().getValues(), act = {}, exp = {};
    v.forEach(function (r, i) { if (i >= 3 && r[0]) act[String(r[0])] = r; });
    UJI_.expect.rekap.forEach(function (r, i) { if (i >= 3 && r[0]) exp[String(r[0])] = r; });
    ujiTabel_(ok, 'Rekap ' + y + ': semua bulan & total', exp, act, null, UJI_.expect.rekap[3]);
  });
  safe('KPI ' + y, function () {
    var v = ss.getSheetByName(kpiName_(y)).getDataRange().getValues(), act = {}, exp = {}, head = v[0];
    var key = function (r) { return ujiNorm_(r[0]) + ' · ' + r[1] + ' · ' + r[2]; };
    v.slice(1).forEach(function (r) { if (r[0]) act[key(r)] = r; });
    UJI_.expect.kpi.forEach(function (r) { exp[key(r)] = r; });
    ujiTabel_(ok, 'KPI ' + y + ': semua bulan × Plant / Project / Line', exp, act, null, head, {
      skip: function (k, j) {
        if (j === 11) return true;                                                     // Status: dicek terpisah
        return !sameDay && k.indexOf(curKey) === 0 && (j === 7 || j === 8 || j === 10); // bulan berjalan dihitung s/d hari ini
      }
    });
    var st = v.slice(1).filter(function (r) { return ujiNorm_(r[0]) === UJI_.meta.prevKey && r[1] === 'Plant'; })[0];
    ok('KPI ' + UJI_.meta.prevKey + ' berstatus ditutup', st && /^Ditutup \d\d\/\d\d\/\d{4} oleh /.test(st[11]), st ? st[11] : 'baris Plant tidak ada');
    var cur = v.slice(1).filter(function (r) { return ujiNorm_(r[0]) === curKey && r[1] === 'Plant'; })[0];
    ok('KPI bulan berjalan "Berjalan"', cur && cur[11] === 'Berjalan', cur ? cur[11] : '-');
    ok('KPI: kolom Bulan tetap teks (bukan tanggal)', v.slice(1).every(function (r) { return !r[0] || typeof r[0] === 'string'; }),
      'tipe: ' + v.slice(1, 4).map(function (r) { return typeof r[0] + (r[0] instanceof Date ? ' (Date)' : ''); }).join(', '));
    if (!sameDay) ok('KPI bulan berjalan: jam operasi & MTBF', true, 'dilewati: data dibuat ' + UJI_.meta.todayKey + ', diuji ' + todayKey);
  });
  safe('TPM', function () {
    Object.keys(UJI_.expect.tpm).forEach(function (sheet) {
      var sh = ss.getSheetByName(sheet);
      if (!ok(sheet + ': tab ada', !!sh, '')) return;
      var exp = UJI_.expect.tpm[sheet], last = sh.getLastRow();
      var v = last >= 9 ? sh.getRange(9, 2, last - 8, 10).getValues() : [];
      v = v.filter(function (r) { return r[0] !== '' && r[0] !== null; });
      ok(sheet + ': jumlah baris', v.length === exp.length, v.length + ' (harap ' + exp.length + ')');
      var bad = [], han = /[一-鿿]/, untranslated = 0;
      exp.forEach(function (e, i) {
        var a = v[i]; if (!a) return;
        [[0, ''], [1, ''], [5, 'jam'], [6, ''], [7, ''], [8, 'tgl']].forEach(function (p) {
          var en = ujiNorm_(e[p[0]], p[1]), an = ujiNorm_(a[p[0]], p[1]);
          if (en === an || ujiTerjemahanSama_(en, an)) return;
          if (bad.length < 8) bad.push('baris ' + (i + 1) + ' kolom ' + (p[0] + 2) + ': harap "' + en + '" ≠ "' + an + '"');
        });
        [2, 3].forEach(function (j) {
          var s = String(a[j] || '');
          if (!/\n\(/.test(s) || !han.test(s.split('\n')[0])) untranslated++;
        });
      });
      ok(sheet + ': No, Machine, Discipline, Responsibility, End Time, Date', !bad.length, bad.join('\n') || exp.length + ' baris cocok');
      ok(sheet + ': Issue & Root Cause berformat 中文 + (English)', untranslated === 0, untranslated ? untranslated + ' sel belum 中文/English (kuota Google?)' :
        'contoh: ' + String(v[0] ? v[0][2] : '').replace(/\n/g, ' ⏎ '));
    });
  });
  safe('Ringkasan', function () {
    var sh = ss.getSheetByName('Ringkasan'), d = sh.getDataRange().getDisplayValues(), errs = [];
    d.forEach(function (r, i) { r.forEach(function (x, j) { if (/^#(N\/A|VALUE!|REF!|ERROR!|NAME\?|DIV\/0!|NUM!)/.test(x)) errs.push(colLetter_(j + 1) + (i + 1) + ' ' + x); }); });
    ok('Ringkasan: tanpa sel error (locale ' + ss.getSpreadsheetLocale() + ')', !errs.length, errs.slice(0, 10).join(', ') || d.length + ' baris dicek');
    var kv = ss.getSheetByName(kpiName_(y)).getDataRange().getValues().filter(function (r) { return ujiNorm_(r[0]) === curKey && r[1] === 'Plant'; })[0];
    var v = sh.getDataRange().getValues();
    var dt = ujiCari_(v, /^Downtime \(jam\)/), mb = ujiCari_(v, /^MTBF \(jam\)/);
    ok('Ringkasan: Downtime bulan ini = KPI', dt && kv && Math.abs(Number(v[dt.r + 1][dt.c]) - kv[6]) < 0.06, (dt ? v[dt.r + 1][dt.c] : '?') + ' vs KPI ' + (kv ? kv[6] : '?'));
    ok('Ringkasan: MTBF bulan ini = tab KPI', mb && kv && (String(v[mb.r + 1][mb.c]) === String(kv[8]) || Math.abs(Number(v[mb.r + 1][mb.c]) - kv[8]) < 0.01), (mb ? v[mb.r + 1][mb.c] : '?') + ' vs KPI ' + (kv ? kv[8] : '?'));
    var t5 = ujiCari_(v, /^5 line tersering/);
    ok('Ringkasan: Top 5 tersering & terlama terisi', t5 && v[t5.r + 2][1] && v[t5.r + 2][1] !== '–' && v[t5.r + 2][5] && v[t5.r + 2][5] !== '–',
      t5 ? 'tersering: ' + v[t5.r + 2].slice(1, 5).join(' / ') + ' · terlama: ' + v[t5.r + 2].slice(5, 9).join(' / ') : 'judul tidak ketemu');
  });
  safe('Spreadsheet', function () {
    var names = ss.getSheets().map(function (s) { return s.getName(); }).filter(function (n) { return n !== UJI_SHEET_; });
    ok('Urutan tab', names.slice(0, 5).join(' | ') === ['Ringkasan', 'Baca Saya', laporanName_(y), rekapName_(y), kpiName_(y)].join(' | '), names.slice(0, 8).join(' | '));
    var tr = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).sort();
    ok('Trigger terpasang', ['checkTimeouts', 'onMasterChange', 'refreshRekap'].every(function (h) { return tr.indexOf(h) !== -1; }), tr.join(', '));
    var ids = JSON.parse(PropertiesService.getDocumentProperties().getProperty('MTTR_SHEET_IDS') || '{}');
    ok('ID tab pengaturan tercatat', !!(ids.Lines && ids.Users), Object.keys(ids).join(', '));
    var kd = findSheet_(APP.SHEETS.KPI_DATA, ss);
    var rows = kd ? readTable_(APP.SHEETS.KPI_DATA).filter(function (r) { return kpiMonthOfCell_(r['Bulan']) === UJI_.meta.prevKey; }) : [];
    ok('KPI data: salinan bulan ditutup, oleh pelaksana', rows.length > 0 && rows.every(function (r) { return String(r['Ditutup oleh']).toLowerCase() === me; }), rows.length + ' baris');
    ok('KPI data tersembunyi & diproteksi', kd && kd.isSheetHidden() && kd.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0, '');
  });

  // ---- API sebagai admin (waktu nyata) ----
  safe('API', function () {
    var b = timed('Buka app (apiBootstrap)', function () { return apiBootstrap('', '', {}); });
    ok('apiBootstrap: Admin, daftar PIC, line aktif', b.v.user.role === 'Admin' && b.v.master.people.length >= 7 && b.v.master.lines.length === 8,
      b.v.user.role + ' · ' + b.v.master.people.length + ' orang · ' + b.v.master.lines.length + ' line', b.ms);
    var dsh = timed('Dashboard', function () { return apiDashboard({ periode: 30 }); });
    var kv = ss.getSheetByName(kpiName_(y)).getDataRange().getValues().filter(function (r) { return ujiNorm_(r[0]) === curKey && r[1] === 'Plant'; })[0];
    ok('Dashboard: kartu KPI = tab KPI, bulan lalu tertutup', dsh.v.kpiMonth.rows[0].kerusakan === kv[3] && dsh.v.kpiMonth.prev && !!dsh.v.kpiMonth.prev.closedIso,
      'kerusakan ' + dsh.v.kpiMonth.rows[0].kerusakan + ' vs ' + kv[3] + ' · bulan lalu ' + (dsh.v.kpiMonth.prev ? dsh.v.kpiMonth.prev.closedIso : '-'), dsh.ms);
    var pk = UJI_.meta.prevKey, last = new Date(Date.UTC(Number(pk.slice(0, 4)), Number(pk.slice(5)), 0)).getUTCDate();
    var st = timed('Statistik (project, MTBF)', function () { return apiStats({ from: pk + '-01', to: pk + '-' + (last < 10 ? '0' : '') + last, by: 'project', measure: 'mtbf' }); });
    var kp = {}; ss.getSheetByName(kpiName_(y)).getDataRange().getValues().forEach(function (r) { if (ujiNorm_(r[0]) === pk && r[1] === 'Project') kp[r[2]] = r[8]; });
    var bad = st.v.groups.filter(function (g) { return Math.abs(g.mtbf - kp[g.key]) > 0.01; });
    ok('Statistik MTBF per project = KPI ' + pk, st.v.groups.length > 0 && !bad.length, st.v.groups.map(function (g) { return g.key + ' ' + g.mtbf + ' / ' + kp[g.key]; }).join(' · '), st.ms);
    var fr = timed('Statistik (line, Pareto)', function () { return apiStats({ from: y + '-01-01', to: todayKey, by: 'line', measure: 'frek' }); });
    ok('Statistik Pareto: berakhir 100%', fr.v.groups.length && fr.v.groups[fr.v.groups.length - 1].cum === 100, fr.v.groups.length + ' line', fr.ms);
    var it = timed('Statistik: tap batang', function () { return apiStatsItems({ from: y + '-01-01', to: todayKey, by: 'line' }, fr.v.groups[0].key); });
    ok('Statistik: tap batang → daftar', it.v.total === fr.v.groups[0].n, it.v.total + ' pekerjaan', it.ms);
    var ex = timed('Download Riwayat (tahun ini, semua)', function () { return apiExport({ from: y + '-01-01', to: todayKey, scope: 'all' }); });
    ok('Download: 100 baris, kolom = Laporan', ex.v.total === 100 && ex.v.columns.length === UJI_.expect.laporanHead.length, ex.v.total + ' baris · ' + ex.v.columns.length + ' kolom', ex.ms);
    var rv = timed('Review (daftar)', function () { return apiListReview({}); });
    ok('Review: 3 menunggu (2 Cancelled + 1 Abandoned)', rv.v.items.length === 3, rv.v.items.map(function (x) { return x.id + ' ' + x.status; }).join(', '), rv.ms);
    var pd = timed('Tab Pending', function () { return apiListPending({}); });
    ok('Pending: 4 pekerjaan', pd.v.items.length === 4, pd.v.items.map(function (x) { return x.line; }).join(', '), pd.ms);
  });

  // ---- alur nyata di line UJI (dihapus lagi di akhir) ----
  var flowIds = [];
  safe('Alur Mulai → Selesai', function () {
    var L = findSheet_('Lines', ss), h = headers_(L, 'Lines');
    L.appendRow(objToRow_(h, { 'Line ID': 'UJI', 'Nama Line': 'Line uji (dihapus otomatis)', 'Proses': 'Assembly', 'Factory ID': 'F1', 'Baterai': 'VF7', 'Area': '-', 'Aktif': 'Ya' }));
    invalidateMaster_(); resetMaster_();
    var s = timed('Mulai', function () { return apiStart('UJI', { baterai: 'VF7' }); }), id = s.v.open.id;
    flowIds.push(id);
    timed('Pause', function () { return apiPause(id, { values: { 'Alasan pause': 'Istirahat' } }); });
    timed('Resume', function () { return apiResume(id); });
    timed('Pending', function () { return apiPending(id, { values: { 'Pekerjaan dilakukan': 'Uji runtime', 'Yang tertunda': 'Menunggu part' }, tenggat: 'BESOK' }); });
    timed('Lanjut (QR)', function () { return apiContinue(id, 'UJI'); });
    timed('Selesai (+ part + PIC tambahan)', function () {
      return apiComplete(id, { values: { 'Jenis kerusakan': 'Elektrikal', Masalah: 'Sensor error', Penyebab: 'Komponen aus', Penanganan: 'Ganti part' },
        parts: [{ id: partId_('Elektrikal', 'Fuse', '10A'), qty: 2 }], pics: [UJI_.meta.picEmail] });
    });
    var r = findById_(readTable_(APP.SHEETS.MAINT), id);
    ok('Alur: status Completed, PIC tambahan tercatat', r && r['Status'] === 'Completed' && String(r['Teknisi terlibat']).indexOf(UJI_.meta.picEmail) !== -1,
      r ? r['Status'] + ' · ' + r['Teknisi terlibat'] : 'tidak ada');
    var ev = readTable_(APP.SHEETS.LOG).filter(function (e) { return e['Maintenance ID'] === id; }).map(function (e) { return e['Kejadian']; });
    ok('Alur: Log 6 kejadian', ev.join(',') === 'start,pause,resume,pending,lanjut,complete', ev.join(','));
    var lap = ss.getSheetByName(laporanName_(y)).getDataRange().getValues(), kc = lap[1].length - 1;
    ok('Alur: baris Laporan langsung tertulis (tanpa tunggu malam)', lap.some(function (x) { return x[kc] === id; }), '');
    ok('Alur: Pemakaian Sparepart tertulis', readTable_(APP.SHEETS.PEMAKAIAN).some(function (u) { return u['Maintenance ID'] === id && Number(u['Jumlah']) === 2; }), '');
    var c = timed('Mulai (untuk cancel)', function () { return apiStart('UJI', { baterai: 'VF7' }); }), id2 = c.v.open.id;
    flowIds.push(id2);
    timed('Cancel', function () { return apiCancel(id2, { values: { 'Alasan cancel': 'Input ganda' } }); });
    timed('Review: setujui cancel', function () { return apiReview(id2, { action: 'SETUJU', note: 'uji' }, {}); });
    var r2 = findById_(readTable_(APP.SHEETS.MAINT), id2);
    ok('Alur: Cancel → review disetujui', r2 && r2['Status'] === 'Cancelled' && r2['Status review'] === APP.REVIEW.DONE, r2 ? r2['Status'] + ' · ' + r2['Status review'] : '-');
  });
  safe('Ganti nama tab Lines', function () {
    var L = findSheet_('Lines', ss), old = L.getName();
    L.setName('Daftar Line 产线');
    try {
      resetMaster_(); invalidateMaster_();
      var b = apiBootstrap('L01', '', {});
      ok('Ganti nama tab Lines → aplikasi tetap membaca line', b.lineView && b.lineView.line.id === 'L01' && b.master.lines.length >= 8, b.master.lines.length + ' line');
    } finally { L.setName(old); resetMaster_(); invalidateMaster_(); }
  });
  safe('Tutup ulang', function () {
    var t = timed('Tutup ulang bulan lalu', function () { return apiTutupBulan(UJI_.meta.prevKey); });
    var last = readTable_(APP.SHEETS.LOG).filter(function (e) { return e['Kejadian'] === 'tutup bulan'; }).pop();
    ok('Tutup ulang tercatat di Log (lama → baru)', t.v.reclosed && /ditutup ulang; sebelumnya/.test(last['Detail']), String(last['Detail']).slice(0, 200), t.ms);
  });
  safe('Bersihkan alur uji', function () {
    var drop = {}; flowIds.forEach(function (x) { drop[x] = true; });
    [APP.SHEETS.MAINT, APP.SHEETS.LOG, APP.SHEETS.PEMAKAIAN].forEach(function (n) {
      var sh = ss.getSheetByName(n), v = sh.getDataRange().getValues(), c = v[0].map(String).indexOf('Maintenance ID');
      rewriteKeeping_(sh, v, function (row) { return !drop[row[c]]; });
    });
    var L = findSheet_('Lines', ss), lv = L.getDataRange().getValues();
    rewriteKeeping_(L, lv, function (row) { return row[0] !== 'UJI'; });
    resetHeaders_(); invalidateMaster_(); resetMaster_();
    var b = timed('Perbarui Laporan, Rekap, TPM & KPI', function () { return apiBuildReports(y); });
    rapikanTampilan_({});
    ok('Setelah dibersihkan: Laporan kembali 100 baris', b.v.rows === 100, b.v.rows + ' baris · ' + (b.v.tpmError || b.v.kpiError || 'TPM & KPI OK'), b.ms);
  });

  waktu.forEach(function (w) { ok('Waktu: ' + w[0], true, w[1] + ' ms', w[1]); });
  var lulus = res.filter(function (r) { return r[2] === 'LULUS'; }).length;
  ujiHasil_(res, lulus + ' / ' + res.length + ' LULUS · ' + Math.round((Date.now() - T0) / 1000) + ' dtk');
  return lulus + ' / ' + res.length + ' LULUS';
}

function ujiHasil_(rows, ringkas) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(UJI_SHEET_) || ss.insertSheet(UJI_SHEET_, 1);
  sh.clear();
  sh.setConditionalFormatRules([]);
  var head = [['UJI 2.6 — ' + ringkas, '', '', 'versi ' + APP.VERSION + ' · data dibuat ' + UJI_.meta.todayKey + ' · dijalankan ' +
    Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH:mm') + ' oleh ' + ujiMe_(), ''], ['No', 'Cek', 'Hasil', 'Detail', 'ms']];
  var all = head.concat(rows);
  sh.getRange(1, 1, all.length, 5).setValues(all);
  sh.getRange(1, 1, 2, 5).setFontWeight('bold');
  sh.getRange(3, 4, Math.max(1, rows.length), 1).setWrap(true);
  sh.setColumnWidth(2, 320); sh.setColumnWidth(4, 620);
  sh.setFrozenRows(2);
  var rg = sh.getRange(3, 3, Math.max(1, rows.length), 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('LULUS').setBackground('#D7F0D7').setFontColor('#0B5A0B').setRanges([rg]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('GAGAL').setBackground('#F8DADA').setFontColor('#8F1F1F').setRanges([rg]).build()
  ]);
  ss.setActiveSheet(sh);
}
