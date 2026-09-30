/**
 * Konfigurasi global MTTR 2.0. Semua nama sheet, header, status, dan peran ada di sini
 * supaya tidak ada string "ajaib" yang tersebar di file lain.
 */
var APP = {
  NAME: 'MTTR 2.0',
  TZ: 'Asia/Jakarta',
  DATE_FMT: 'yyyy-MM-dd HH:mm:ss',

  SHEETS: {
    USERS: 'Users',
    LINES: 'Lines',
    OPTIONS: 'Pilihan',
    CONFIG: 'Config',
    MAINT: 'Maintenance',
    LOG: 'Log',
    PENDING: 'Pending Work'
  },

  /** Sheet yang ditulis/dibaca kode. Tab turunan (FILTER) dibuat terpisah di setup(). */
  HEADERS: {
    Users: ['Email', 'Nama', 'Peran', 'Aktif'],
    Lines: ['Line ID', 'Nama Line', 'Area', 'Aktif'],
    Pilihan: ['Jenis', 'Nilai', 'Aktif'],
    Config: ['Key', 'Value', 'Keterangan'],
    Maintenance: [
      'Maintenance ID', 'Line', 'Baterai', 'Status', 'Teknisi awal', 'Teknisi terakhir',
      'Mulai', 'Selesai', 'Total aktif (menit)', 'Total pause (menit)', 'Total pending (menit)',
      'Masalah', 'Penyebab', 'Penanganan', 'Part', 'Yang tertunda', 'Tenggat', 'Alasan cancel', 'Status review',
      // Kolom tambahan di luar spec (lihat README "Deviasi dari spec")
      'Masuk MTTR', 'Status sejak', 'Konfirmasi terakhir', 'Peringatan pada', 'Teknisi terlibat',
      'Pekerjaan dilakukan', 'Catatan', 'Direview oleh', 'Direview pada', 'Catatan review'
    ],
    Log: ['Timestamp', 'Maintenance ID', 'Kejadian', 'User', 'Detail']
  },

  DATE_COLUMNS: {
    Maintenance: ['Mulai', 'Selesai', 'Tenggat', 'Status sejak', 'Konfirmasi terakhir', 'Peringatan pada', 'Direview pada'],
    Log: ['Timestamp']
  },

  STATUS: {
    ACTIVE: 'Aktif',
    PAUSE: 'Pause',
    PENDING: 'Pending',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    ABANDONED: 'Abandoned'
  },

  /** Kolom total yang bertambah selama record berada di status tsb. */
  BUCKET: {
    Aktif: 'Total aktif (menit)',
    Pause: 'Total pause (menit)',
    Pending: 'Total pending (menit)'
  },

  REVIEW: { NEEDED: 'Perlu review', DONE: 'Direview' },
  MTTR: { YES: 'Ya', NO: 'Tidak', WAITING: 'Menunggu' },

  ROLES: { TECH: 'Teknisi', ADMIN: 'Admin' },
  /** Alias peran dari v1, supaya sheet Users lama bisa dipakai ulang. */
  ROLE_ALIASES: { me: 'Teknisi', teknisi: 'Teknisi', admin: 'Admin' },

  EVENTS: {
    START: 'start', PAUSE: 'pause', RESUME: 'resume', PENDING: 'pending', CONTINUE: 'lanjut',
    COMPLETE: 'complete', CANCEL: 'cancel', WARN: 'peringatan', CONFIRM: 'masih lanjut',
    ABANDON: 'abandoned', REVIEW: 'review'
  },

  SYSTEM_USER: 'SYSTEM',
  OTHER: 'Lainnya',
  NO_PART: 'Tidak ada',

  /** Isi awal sheet Pilihan. Masalah/Penyebab/Penanganan/Part = CONTOH, wajib diganti bersama teknisi senior. */
  OPTION_DEFAULTS: {
    'Baterai': ['E22H', 'E245'],
    'Masalah': ['Mesin berhenti', 'Sensor error', 'Kebocoran', 'Suara/getaran abnormal', 'Hasil produk NG', 'Lainnya'],
    'Penyebab': ['Komponen aus', 'Kabel/konektor longgar', 'Setting berubah', 'Kotor/kontaminasi', 'Salah operasi', 'Lainnya'],
    'Penanganan': ['Ganti part', 'Setting ulang', 'Bersihkan', 'Kencangkan/perbaiki koneksi', 'Lainnya'],
    'Part': ['Sensor proximity', 'Fuse', 'Relay', 'Belt', 'Bearing', 'Seal/O-ring'],
    'Alasan Pause': ['Istirahat', 'Ambil part/alat', 'Lainnya'],
    'Yang Tertunda': ['Menunggu part', 'Menunggu jadwal stop produksi', 'Butuh teknisi lain', 'Lainnya'],
    'Alasan Cancel': ['Salah line', 'Input ganda', 'Masalah hilang sendiri', 'Lainnya']
  },

  CONFIG_DEFAULTS: {
    WARN_HOURS: { value: 3, description: 'Jam sejak mulai / konfirmasi terakhir sebelum peringatan' },
    ABANDON_HOURS: { value: 4, description: 'Jam sejak mulai / konfirmasi terakhir sebelum Abandoned (jika peringatan tidak dijawab)' },
    EMAIL_PERINGATAN: { value: 'Ya', description: 'Ya = kirim email ke teknisi saat peringatan. Tidak = cukup banner di app' },
    SHIFT_MULAI: { value: '07:00,15:00,23:00', description: 'Jam mulai tiap shift, dipakai untuk tenggat "Shift berikutnya"' }
  },

  LOCK_TIMEOUT_MS: 10000,
  TRIGGER_MINUTES: 15,
  HISTORY_LIMIT: 500
};

/** Membaca nilai dari sheet Config, fallback ke default. */
function getConfig_(key) {
  var def = APP.CONFIG_DEFAULTS[key] ? APP.CONFIG_DEFAULTS[key].value : null;
  if (!SpreadsheetApp.getActive().getSheetByName(APP.SHEETS.CONFIG)) return def;
  var rows = readTable_(APP.SHEETS.CONFIG);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Key']).trim() === key) {
      var v = rows[i]['Value'];
      return (v === '' || v === null) ? def : v;
    }
  }
  return def;
}

function getHours_(key) {
  var h = Number(getConfig_(key));
  return (isFinite(h) && h > 0) ? h : APP.CONFIG_DEFAULTS[key].value;
}

/** Batas waktu. ABANDON selalu > WARN supaya teknisi punya waktu menjawab peringatan. */
function getLimits_() {
  var warn = getHours_('WARN_HOURS');
  var abandon = getHours_('ABANDON_HOURS');
  if (abandon <= warn) abandon = warn + 1;
  return { warnHours: warn, abandonHours: abandon };
}

function isYes_(v) {
  var s = String(v === true ? 'ya' : v || '').trim().toLowerCase();
  return s === 'ya' || s === 'yes' || s === 'true' || s === 'aktif' || s === 'active' || s === '1';
}

/** Daftar pilihan aktif per jenis, dari sheet Pilihan (fallback ke default). */
function getOptions_() {
  var out = {};
  Object.keys(APP.OPTION_DEFAULTS).forEach(function (k) { out[k] = []; });
  if (SpreadsheetApp.getActive().getSheetByName(APP.SHEETS.OPTIONS)) {
    readTable_(APP.SHEETS.OPTIONS).forEach(function (r) {
      var jenis = String(r['Jenis']).trim();
      var nilai = String(r['Nilai']).trim();
      if (!jenis || !nilai || !isYes_(r['Aktif'])) return;
      if (!out[jenis]) out[jenis] = [];
      if (out[jenis].indexOf(nilai) === -1) out[jenis].push(nilai);
    });
  }
  Object.keys(APP.OPTION_DEFAULTS).forEach(function (k) {
    if (!out[k].length) out[k] = APP.OPTION_DEFAULTS[k].slice();
  });
  return out;
}
