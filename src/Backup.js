/**
 * Tab backup otomatis (2.6.6). Trigger harian 03:00 (sesudah trigger malam):
 *  - mulai Senin: tab "Backup minggu <yyyy-mm-dd Senin>" = pekerjaan yang DIMULAI Senin–Minggu lalu;
 *  - mulai tanggal 3: tab "Backup bulan <yyyy-mm>" = pekerjaan yang dimulai bulan lalu (sesudah tutup bulan otomatis tgl 2).
 * Isi = format tab Laporan / Download Riwayat (kolom Format Laporan, tanpa Cancelled), nilai beku saat dibuat.
 * Admin men-download / memindahkan isinya, lalu menghapus tabnya. Tanpa izin Google baru (hanya spreadsheet ini).
 * Periode yang sudah dibuat dicatat di DocumentProperties → tab yang sudah dihapus admin tidak dibuat lagi.
 * Ukuran tab dipangkas pas isi (tab baru = 26 ribu sel); tab > BACKUP_UMUR_HARI_ hari diingatkan di Dashboard.
 */
var BACKUP_PROP_ = 'MTTR_BACKUP_DONE';
var BACKUP_JAM_ = 3;
var BACKUP_TANGGAL_ = 3;
var BACKUP_UMUR_HARI_ = 35;
var BACKUP_RE_ = /^Backup (minggu|bulan) (\d{4})-(\d{2})(?:-(\d{2}))?$/;

/** Trigger harian. @return {string[]} tab yang dibuat */
function backupTerjadwal() { return backupJalan_(new Date(), false); }

/** Menu admin: buat ulang tab minggu lalu & bulan lalu sekarang (walau sudah pernah dibuat / sudah dihapus). */
function menuBackupSekarang() {
  requireUser_([APP.ROLES.ADMIN]);
  var made = backupJalan_(new Date(), true);
  SpreadsheetApp.getUi().alert(made.length ? 'Tab backup dibuat:\n' + made.join('\n') + '\n\nDownload / pindahkan isinya, lalu hapus tabnya.'
    : 'Tidak ada tab dibuat: tidak ada pekerjaan di periode itu, atau Config → BACKUP_TAB = Tidak.');
}

function backupJalan_(now, paksa) {
  var props = PropertiesService.getDocumentProperties(), done = [];
  try { done = JSON.parse(props.getProperty(BACKUP_PROP_) || '[]') || []; } catch (e) { done = []; }
  var made = [];
  backupPeriods_(now).forEach(function (p) {
    if (!backupAktif_(p.jenis) || (!paksa && done.indexOf(p.key) !== -1)) return;
    var n = buatTabBackup_(p, now);
    if (done.indexOf(p.key) === -1) done.push(p.key);
    if (n) made.push(p.name + ' (' + n + ' pekerjaan)');
  });
  props.setProperty(BACKUP_PROP_, JSON.stringify(done.slice(-200)));
  return made;
}

/** Config BACKUP_TAB: "Mingguan, Bulanan" (bawaan) / "Mingguan" / "Bulanan" / "Tidak". */
function backupAktif_(jenis) {
  var v = String(getConfig_('BACKUP_TAB') || '').toLowerCase();
  return v.indexOf(jenis === 'minggu' ? 'minggu' : 'bulan') !== -1;
}

/** Periode yang sudah lengkap per tanggal `now` (WIB): minggu lalu (Senin–Minggu) dan, mulai tanggal 3, bulan lalu. */
function backupPeriods_(now) {
  var t = ymdOf_(now), DAY = 86400000, pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var d0 = Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));
  var key = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
  var dmy = function (ms) { var k = key(ms); return k.slice(8) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4); };
  var senin = d0 - ((new Date(d0).getUTCDay() + 6) % 7 + 7) * DAY, minggu = senin + 6 * DAY;
  var out = [{ jenis: 'minggu', key: 'W' + key(senin), name: 'Backup minggu ' + key(senin), from: key(senin), to: key(minggu),
    label: 'Backup minggu ' + dmy(senin) + ' – ' + dmy(minggu) }];
  if (Number(t.slice(8, 10)) >= BACKUP_TANGGAL_) {
    var y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) - 1;
    if (!m) { m = 12; y--; }
    var ym = y + '-' + pad(m), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ jenis: 'bulan', key: 'M' + ym, name: 'Backup bulan ' + ym, from: ym + '-01', to: ym + '-' + pad(last), label: 'Backup bulan ' + ymLabel_(ym) });
  }
  return out;
}

/** @return {number} jumlah pekerjaan (0 = periode kosong, tab tidak dibuat) */
function buatTabBackup_(p, now) {
  var c = ctx_(), rg = statsRange_({ from: p.from, to: p.to });
  var rows = periodRows_(rg, function (r) { return r['Status'] !== APP.STATUS.CANCELLED; });
  if (!rows.length) return 0;
  var cols = c.md.report, w = cols.length;
  var data = laporanCells_(rows, rg, c).map(function (row) { return row.map(cellText_); });   // "07.30", "16:53" tetap teks
  var ss = SpreadsheetApp.getActive(), old = ss.getSheetByName(p.name);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(p.name, ss.getSheets().length);
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  ensureRows_(sh, data.length + 2, 0);
  sh.getRange(1, 1).setValue(p.label + ' · ' + rows.length + ' pekerjaan (tanpa Cancelled) · dibuat ' + fmtTz_(now, 'dd/MM/yyyy HH:mm') +
    ' · File → Download, atau klik kanan tab → Copy to; lalu HAPUS tab ini.').setFontWeight('bold');
  sh.getRange(2, 1, 1, w).setValues([cols.map(function (k) { return k.kolom; })]).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  sh.getRange(3, 1, data.length, w).setValues(data);
  cols.forEach(function (k, j) {
    sh.setColumnWidth(j + 1, (LAP_STYLE_[k.sumber] || [120])[0]);
    if (k.sumber === 'Tanggal') sh.getRange(3, j + 1, data.length, 1).setNumberFormat('dd/MM/yyyy');
  });
  sh.setFrozenRows(2);
  sh.setTabColor(TEMA_.tab.arsip);
  trimSheet_(sh, 0);
  return rows.length;
}

/** Tab backup yang periodenya selesai lebih dari BACKUP_UMUR_HARI_ hari lalu (belum dihapus admin). */
function backupLama_(now) {
  var out = [];
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    var m = BACKUP_RE_.exec(sh.getName());
    if (!m) return;
    var end = m[1] === 'minggu' ? Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]) + 7) : Date.UTC(Number(m[2]), Number(m[3]), 1);
    if (now.getTime() - (end - 7 * 3600000) > BACKUP_UMUR_HARI_ * 86400000) out.push(sh.getName());
  });
  return out;
}
