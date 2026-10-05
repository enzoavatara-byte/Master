/**
 * Konfigurasi global MTTR 2.1. Nama sheet, header, status, dan peran ada di sini.
 * Semua yang boleh diubah user (pilihan, form, factory, project, line, mesin, BOM, batas waktu)
 * ada di Google Sheet, bukan di file ini — file ini hanya berisi nilai awal & aturan sistem.
 */
var APP = {
  NAME: 'MTTR 2.1',
  TZ: 'Asia/Jakarta',
  DATE_FMT: 'yyyy-MM-dd HH:mm:ss',

  SHEETS: {
    USERS: 'Users',
    FACTORY: 'Factory',
    PROJECTS: 'Projects',
    LINES: 'Lines',
    MESIN: 'Mesin',
    BOM: 'BOM',
    OPTIONS: 'Pilihan',
    FORM: 'Form',
    CONFIG: 'Config',
    MAINT: 'Maintenance',
    LOG: 'Log',
    PENDING: 'Pending Work'
  },

  /** Sheet yang ditulis/dibaca kode. Tab turunan (FILTER) dibuat terpisah di setup(). */
  HEADERS: {
    Users: ['Email', 'Nama', 'Peran', 'Aktif'],
    Factory: ['Factory ID', 'Nama', 'Lokasi', 'Aktif'],
    /** Satu baris per baterai/project. Sumber "baterai apa saja di factory ini" + status project. */
    Projects: ['Factory ID', 'Baterai', 'Fase', 'Target MTTR (menit)', 'Catatan', 'Aktif'],
    /** Satu baris = satu QR. Baterai kosong = semua project di factory-nya. Grup = induk sub-line (L03 untuk L03-A, L03-B). */
    Lines: ['Line ID', 'Nama Line', 'Factory ID', 'Baterai', 'Grup', 'Area', 'Aktif'],
    /** Line ID boleh berisi Line ID atau Grup (mesin dipakai bersama sub-line). */
    Mesin: ['Mesin ID', 'Nama Mesin', 'Line ID', 'Aktif'],
    /** Line ID: Line ID / Grup / '*' (part umum semua line). Mesin ID opsional. */
    BOM: ['Line ID', 'Mesin ID', 'Part Number', 'Nama Part', 'Qty Terpasang', 'Satuan', 'Lokasi Simpan', 'Stok Minimum', 'Aktif'],
    Pilihan: ['Jenis', 'Nilai', 'Urutan', 'Aktif'],
    Form: ['Form', 'Field', 'Label', 'Tipe', 'Sumber', 'Wajib', 'Lainnya isi sendiri', 'Urutan', 'Aktif'],
    Config: ['Key', 'Value', 'Keterangan'],
    Maintenance: [
      'Maintenance ID', 'Line', 'Baterai', 'Status', 'Teknisi awal', 'Teknisi terakhir',
      'Mulai', 'Selesai', 'Total aktif (menit)', 'Total pause (menit)', 'Total pending (menit)',
      'Masalah', 'Penyebab', 'Penanganan', 'Part', 'Yang tertunda', 'Tenggat', 'Alasan cancel', 'Status review',
      'Masuk MTTR', 'Status sejak', 'Konfirmasi terakhir', 'Peringatan pada', 'Teknisi terlibat',
      'Pekerjaan dilakukan', 'Catatan', 'Direview oleh', 'Direview pada', 'Catatan review',
      // 2.1 (ditambahkan di kanan supaya data 2.0 tetap valid)
      'Factory', 'Tipe', 'Mesin ID', 'Nama Mesin'
    ],
    Log: ['Timestamp', 'Maintenance ID', 'Kejadian', 'User', 'Detail']
  },

  DATE_COLUMNS: {
    Maintenance: ['Mulai', 'Selesai', 'Tenggat', 'Status sejak', 'Konfirmasi terakhir', 'Peringatan pada', 'Direview pada'],
    Log: ['Timestamp']
  },

  STATUS: {
    ACTIVE: 'Aktif', PAUSE: 'Pause', PENDING: 'Pending',
    COMPLETED: 'Completed', CANCELLED: 'Cancelled', ABANDONED: 'Abandoned'
  },

  BUCKET: { Aktif: 'Total aktif (menit)', Pause: 'Total pause (menit)', Pending: 'Total pending (menit)' },

  REVIEW: { NEEDED: 'Perlu review', DONE: 'Direview' },
  MTTR: { YES: 'Ya', NO: 'Tidak', WAITING: 'Menunggu' },

  ROLES: { TECH: 'Teknisi', ADMIN: 'Admin' },
  ROLE_ALIASES: { me: 'Teknisi', teknisi: 'Teknisi', admin: 'Admin' },

  EVENTS: {
    START: 'start', PAUSE: 'pause', RESUME: 'resume', PENDING: 'pending', CONTINUE: 'lanjut',
    COMPLETE: 'complete', CANCEL: 'cancel', WARN: 'peringatan', CONFIRM: 'masih lanjut',
    ABANDON: 'abandoned', REVIEW: 'review'
  },

  SYSTEM_USER: 'SYSTEM',
  OTHER: 'Lainnya',
  OTHER_PREFIX: 'Lainnya: ',
  NO_PART: 'Tidak ada',

  /** Isi awal sheet Factory & Projects. Bebas diubah di sheet. */
  FACTORY_DEFAULTS: [['F1', 'Factory 1', ''], ['F2', 'Factory 2', '']],
  PROJECT_DEFAULTS: [['F1', 'VF7'], ['F1', 'Limo7'], ['F2', 'E22H'], ['F2', 'E245']],

  /** Isi awal sheet Pilihan. Masalah/Penyebab/Penanganan/Part = CONTOH, ganti bersama teknisi senior.
   *  "Lainnya" tidak perlu ditulis: otomatis muncul jika kolom "Lainnya isi sendiri" di sheet Form = Ya. */
  OPTION_DEFAULTS: {
    'Tipe Maintenance': ['Corrective', 'Preventive'],
    'Masalah': ['Mesin berhenti', 'Sensor error', 'Kebocoran', 'Suara/getaran abnormal', 'Hasil produk NG'],
    'Penyebab': ['Komponen aus', 'Kabel/konektor longgar', 'Setting berubah', 'Kotor/kontaminasi', 'Salah operasi'],
    'Penanganan': ['Ganti part', 'Setting ulang', 'Bersihkan', 'Kencangkan/perbaiki koneksi'],
    'Part': ['Sensor proximity', 'Fuse', 'Relay', 'Belt', 'Bearing', 'Seal/O-ring'],
    'Alasan Pause': ['Istirahat', 'Ambil part/alat'],
    'Yang Tertunda': ['Menunggu part', 'Menunggu jadwal stop produksi', 'Butuh teknisi lain'],
    'Alasan Cancel': ['Salah line', 'Input ganda', 'Masalah hilang sendiri']
  },

  /**
   * Isi awal sheet Form: [Form, Field, Label, Tipe, Sumber, Wajib, Lainnya isi sendiri, Urutan].
   * Tipe: pilihan | teks | angka | sistem. Field = nama kolom di sheet Maintenance.
   * Baris "sistem" punya logika khusus: label/urutan boleh diubah, tidak bisa dihapus/dinonaktifkan.
   * Baris baru dengan Tipe pilihan/teks/angka = field tambahan; kolomnya dibuat otomatis di Maintenance.
   */
  FORM_DEFAULTS: [
    ['Mulai', 'Mesin ID', 'Mesin', 'sistem', '', 'Ya', 'Ya', 1],
    ['Mulai', 'Tipe', 'Tipe maintenance', 'sistem', 'Tipe Maintenance', 'Ya', 'Tidak', 2],
    ['Mulai', 'Baterai', 'Baterai', 'sistem', '', 'Ya', 'Tidak', 3],
    ['Pause', 'Alasan pause', 'Alasan pause', 'pilihan', 'Alasan Pause', 'Tidak', 'Ya', 1],
    ['Pending', 'Pekerjaan dilakukan', 'Pekerjaan yang sudah dilakukan', 'teks', '', 'Ya', 'Tidak', 1],
    ['Pending', 'Yang tertunda', 'Yang tertunda', 'pilihan', 'Yang Tertunda', 'Ya', 'Ya', 2],
    ['Pending', 'Tenggat', 'Tenggat', 'sistem', '', 'Ya', 'Tidak', 3],
    ['Pending', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 4],
    ['Selesai', 'Masalah', 'Masalah', 'pilihan', 'Masalah', 'Ya', 'Ya', 1],
    ['Selesai', 'Penyebab', 'Penyebab', 'pilihan', 'Penyebab', 'Ya', 'Ya', 2],
    ['Selesai', 'Penanganan', 'Penanganan', 'pilihan', 'Penanganan', 'Ya', 'Ya', 3],
    ['Selesai', 'Part', 'Part yang diganti', 'sistem', 'Part', 'Ya', 'Ya', 4],
    ['Selesai', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 5],
    ['Cancel', 'Alasan cancel', 'Alasan cancel', 'pilihan', 'Alasan Cancel', 'Ya', 'Ya', 1],
    ['Cancel', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 2]
  ],
  FORMS: ['Mulai', 'Pause', 'Pending', 'Selesai', 'Cancel'],
  /** Field sistem yang selalu aktif (logika aplikasi bergantung padanya). */
  LOCKED_FIELDS: ['Mulai.Mesin ID', 'Mulai.Tipe', 'Mulai.Baterai', 'Pending.Yang tertunda', 'Pending.Tenggat', 'Selesai.Part', 'Cancel.Alasan cancel'],
  /** Kolom Maintenance yang tidak boleh dipakai sebagai field tambahan. */
  RESERVED_FIELDS: ['Maintenance ID', 'Line', 'Status', 'Teknisi awal', 'Teknisi terakhir', 'Mulai', 'Selesai',
    'Total aktif (menit)', 'Total pause (menit)', 'Total pending (menit)', 'Status review', 'Masuk MTTR', 'Status sejak',
    'Konfirmasi terakhir', 'Peringatan pada', 'Teknisi terlibat', 'Direview oleh', 'Direview pada', 'Catatan review', 'Factory'],

  CONFIG_DEFAULTS: {
    WARN_HOURS: { value: 3, description: 'Jam sejak mulai / konfirmasi terakhir sebelum peringatan' },
    ABANDON_HOURS: { value: 4, description: 'Jam sejak mulai / konfirmasi terakhir sebelum Abandoned (jika peringatan tidak dijawab)' },
    EMAIL_PERINGATAN: { value: 'Ya', description: 'Ya = kirim email ke teknisi saat peringatan. Tidak = cukup banner di app' },
    SHIFT_MULAI: { value: '07:00,15:00,23:00', description: 'Jam mulai tiap shift, dipakai untuk tenggat "Shift berikutnya"' },
    MTTR_TIPE: { value: 'Corrective', description: 'Tipe maintenance yang dihitung ke MTTR (pisahkan dengan koma)' }
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

function mttrTypes_() {
  return splitList_(getConfig_('MTTR_TIPE')).map(function (s) { return s.toLowerCase(); });
}

function isYes_(v) {
  var s = String(v === true ? 'ya' : v || '').trim().toLowerCase();
  return s === 'ya' || s === 'yes' || s === 'true' || s === 'aktif' || s === 'active' || s === '1';
}

/** Kolom Aktif kosong dianggap aktif untuk sheet master (baris baru tidak langsung hilang). */
function isActiveRow_(v) {
  return String(v == null ? '' : v).trim() === '' || isYes_(v);
}

function splitList_(v) {
  return String(v == null ? '' : v).split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
}
