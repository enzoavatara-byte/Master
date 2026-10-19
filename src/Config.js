/**
 * Konfigurasi global MTTR. Nama sheet, header, status, dan peran ada di sini.
 * Semua yang boleh diubah user (pilihan, form, factory, project, line, mesin, sparepart, format laporan,
 * batas waktu, nama aplikasi) ada di Google Sheet, bukan di file ini — file ini hanya berisi nilai awal & aturan sistem.
 */
var APP = {
  NAME: 'MTTR',          // nama default; per lokasi diubah lewat Config → NAMA_APLIKASI
  VERSION: '2.2.6',      // tampil di Panduan & menu: cek kedua factory memakai versi yang sama
  TZ: 'Asia/Jakarta',
  DATE_FMT: 'yyyy-MM-dd HH:mm:ss',

  SHEETS: {
    USERS: 'Users',
    FACTORY: 'Factory',
    PROJECTS: 'Projects',
    LINES: 'Lines',
    MESIN: 'Mesin',
    SPAREPART: 'Sparepart',
    PEMAKAIAN: 'Pemakaian Sparepart',
    FORMAT: 'Format Laporan',
    PANDUAN: 'Catatan Panduan',
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
    /** Satu baris = satu QR. Alias = nama lain untuk pencarian. Proses = kelompok di atas line (kolom "Process" laporan).
     *  Baterai kosong = semua project di factory-nya. Grup = induk sub-line (L03 untuk L03-A, L03-B). */
    Lines: ['Line ID', 'Nama Line', 'Alias', 'Proses', 'Factory ID', 'Baterai', 'Grup', 'Area', 'Aktif'],
    /** Line ID boleh berisi Line ID atau Grup (mesin dipakai bersama sub-line). Nama Mesin = kolom "Station" laporan. */
    Mesin: ['Mesin ID', 'Nama Mesin', 'Line ID', 'Aktif'],
    /** Katalog sparepart, sama dengan Excel: Jenis → Nama → Model (Model boleh kosong). */
    Sparepart: ['Jenis Sparepart', 'Nama Sparepart', 'Model', 'Satuan', 'Urutan', 'Aktif'],
    /** Satu baris per part per pekerjaan (ditulis aplikasi) → bisa direkap. */
    'Pemakaian Sparepart': ['Tanggal', 'Maintenance ID', 'Factory', 'Line', 'Proses', 'Mesin', 'Baterai', 'Jenis kerusakan',
      'Jenis Sparepart', 'Nama Sparepart', 'Model', 'Jumlah', 'Satuan', 'Manual', 'PIC', 'Email PIC'],
    /** Kolom tab "Laporan <tahun>": judul kolom bebas, Sumber = salah satu REPORT_SOURCES atau nama kolom Maintenance. */
    'Format Laporan': ['Kolom', 'Sumber', 'Urutan', 'Aktif'],
    /** Catatan lokal admin yang tampil di Panduan aplikasi. Untuk: Teknisi / Admin / Semua. */
    'Catatan Panduan': ['Untuk', 'Judul', 'Isi', 'Urutan', 'Aktif'],
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
      'Factory', 'Tipe', 'Mesin ID', 'Nama Mesin',
      // 2.2
      'Proses', 'Stop line', 'Jenis kerusakan', 'Detail masalah', 'Detail penyebab', 'Detail penanganan',
      'Nama PIC', 'Nama teknisi awal', 'Nama teknisi terlibat'
    ],
    Log: ['Timestamp', 'Maintenance ID', 'Kejadian', 'User', 'Detail']
  },

  DATE_COLUMNS: {
    Maintenance: ['Mulai', 'Selesai', 'Tenggat', 'Status sejak', 'Konfirmasi terakhir', 'Peringatan pada', 'Direview pada'],
    Log: ['Timestamp'],
    'Pemakaian Sparepart': ['Tanggal']
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
  NO_PART: 'Tidak ada pergantian',
  YES: 'Ya', NO: 'Tidak',
  /** Status → kolom "Kondisi Perbaikan" laporan. */
  STATUS_LABEL: { Aktif: 'Dikerjakan', Pause: 'Pause', Pending: 'Pending', Completed: 'Selesai', Cancelled: 'Cancel', Abandoned: 'Abandoned' },

  /** Isi awal sheet Factory & Projects. Bebas diubah di sheet. */
  FACTORY_DEFAULTS: [['F1', 'Factory 1', ''], ['F2', 'Factory 2', '']],
  PROJECT_DEFAULTS: [['F1', 'VF7'], ['F1', 'Limo7'], ['F2', 'E22H'], ['F2', 'E245']],

  /** Isi awal sheet Pilihan. Masalah/Penyebab/Penanganan/Part = CONTOH, ganti bersama teknisi senior.
   *  "Lainnya" tidak perlu ditulis: otomatis muncul jika kolom "Lainnya isi sendiri" di sheet Form = Ya. */
  OPTION_DEFAULTS: {
    'Tipe Maintenance': ['Corrective', 'Preventive'],
    'Jenis Kerusakan': ['Elektrikal', 'Mekanikal', 'Pneumatik', 'Program'],
    'Masalah': ['Mesin berhenti', 'Sensor error', 'Kebocoran', 'Suara/getaran abnormal', 'Hasil produk NG'],
    'Penyebab': ['Komponen aus', 'Kabel/konektor longgar', 'Setting berubah', 'Kotor/kontaminasi', 'Salah operasi'],
    'Penanganan': ['Ganti part', 'Setting ulang', 'Bersihkan', 'Kencangkan/perbaiki koneksi'],
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
    // Urutan pecahan (2.5, 1.5, …) = field baru 2.2, supaya langsung berada di posisi yang benar di sheet Form lama.
    ['Mulai', 'Mesin ID', 'Mesin', 'sistem', '', 'Ya', 'Ya', 1],
    ['Mulai', 'Tipe', 'Tipe maintenance', 'sistem', 'Tipe Maintenance', 'Ya', 'Tidak', 2],
    ['Mulai', 'Stop line', 'Apakah line berhenti (stop line)?', 'sistem', '', 'Ya', 'Tidak', 2.5],
    ['Mulai', 'Baterai', 'Baterai', 'sistem', '', 'Ya', 'Tidak', 3],
    ['Pause', 'Alasan pause', 'Alasan pause', 'pilihan', 'Alasan Pause', 'Tidak', 'Ya', 1],
    ['Pending', 'Pekerjaan dilakukan', 'Pekerjaan yang sudah dilakukan', 'teks', '', 'Ya', 'Tidak', 1],
    ['Pending', 'Yang tertunda', 'Yang tertunda', 'pilihan', 'Yang Tertunda', 'Ya', 'Ya', 2],
    ['Pending', 'Tenggat', 'Tenggat', 'sistem', '', 'Ya', 'Tidak', 3],
    ['Pending', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 4],
    ['Selesai', 'Jenis kerusakan', 'Jenis kerusakan', 'pilihan', 'Jenis Kerusakan', 'Ya', 'Tidak', 0.5],
    ['Selesai', 'Masalah', 'Fenomena / masalah', 'pilihan', 'Masalah', 'Ya', 'Ya', 1],
    ['Selesai', 'Detail masalah', 'Detail masalah', 'teks', '', 'Tidak', 'Tidak', 1.5],
    ['Selesai', 'Penyebab', 'Alasan / penyebab', 'pilihan', 'Penyebab', 'Ya', 'Ya', 2],
    ['Selesai', 'Detail penyebab', 'Detail penyebab', 'teks', '', 'Tidak', 'Tidak', 2.5],
    ['Selesai', 'Penanganan', 'Tindakan penanganan', 'pilihan', 'Penanganan', 'Ya', 'Ya', 3],
    ['Selesai', 'Detail penanganan', 'Detail penanganan', 'teks', '', 'Tidak', 'Tidak', 3.5],
    ['Selesai', 'Part', 'Sparepart yang diganti', 'sistem', '', 'Ya', 'Ya', 4],
    ['Selesai', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 5],
    ['Cancel', 'Alasan cancel', 'Alasan cancel', 'pilihan', 'Alasan Cancel', 'Ya', 'Ya', 1],
    ['Cancel', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 2]
  ],
  FORMS: ['Mulai', 'Pause', 'Pending', 'Selesai', 'Cancel'],
  /** Baris Form baru di 2.2: setup() menambahkannya ke sheet Form lama jika belum ada (baris lain tidak disentuh). */
  FORM_MIGRATE: ['Mulai.Stop line', 'Selesai.Jenis kerusakan', 'Selesai.Detail masalah', 'Selesai.Detail penyebab', 'Selesai.Detail penanganan'],
  /** Field sistem yang selalu aktif (logika aplikasi bergantung padanya). */
  LOCKED_FIELDS: ['Mulai.Mesin ID', 'Mulai.Tipe', 'Mulai.Baterai', 'Pending.Yang tertunda', 'Pending.Tenggat', 'Selesai.Part', 'Cancel.Alasan cancel'],
  /** Kolom Maintenance yang tidak boleh dipakai sebagai field tambahan. */
  RESERVED_FIELDS: ['Maintenance ID', 'Line', 'Status', 'Teknisi awal', 'Teknisi terakhir', 'Mulai', 'Selesai',
    'Total aktif (menit)', 'Total pause (menit)', 'Total pending (menit)', 'Status review', 'Masuk MTTR', 'Status sejak',
    'Konfirmasi terakhir', 'Peringatan pada', 'Teknisi terlibat', 'Direview oleh', 'Direview pada', 'Catatan review', 'Factory',
    'Proses', 'Nama PIC', 'Nama teknisi awal', 'Nama teknisi terlibat'],

  /** Isi awal katalog Sparepart (CONTOH): [Jenis, Nama, Model, Satuan]. Admin mengganti di sheet Sparepart. */
  SPAREPART_DEFAULTS: [
    ['Elektrikal', 'Motor Listrik', 'ABB M2QA 0,75kW', 'pcs'], ['Elektrikal', 'Sensor Proximity', 'Omron E2E-X5ME1', 'pcs'],
    ['Elektrikal', 'Relay', 'Omron MY2N 24VDC', 'pcs'], ['Elektrikal', 'Fuse', '10A', 'pcs'],
    ['Mekanikal', 'Bearing', '6205-2RS', 'pcs'], ['Mekanikal', 'Bearing', '6204-ZZ', 'pcs'], ['Mekanikal', 'Timing Belt', 'HTD 5M-450', 'pcs'],
    ['Pneumatik', 'Silinder', 'SMC CQ2B32-50D', 'pcs'], ['Pneumatik', 'Selang PU', '8 mm', 'meter'], ['Pneumatik', 'Solenoid Valve', 'SMC SY5120', 'pcs'],
    ['Program', 'Backup Program PLC', '', 'kali']
  ],

  /** Sumber kolom laporan yang dihitung aplikasi. Sumber lain = nama kolom sheet Maintenance apa adanya. */
  REPORT_SOURCES: ['NO', 'Factory', 'Nama factory', 'Project', 'Proses', 'Line', 'Station', 'Tanggal', 'Jam mulai', 'Jam selesai',
    'Stop line (1/0)', 'Durasi stop line', 'Waktu aktif (menit)', 'Jenis kerusakan', 'Masalah + detail', 'Penyebab + detail',
    'Penanganan + detail', 'Jenis sparepart', 'Nama sparepart', 'Model sparepart', 'Jumlah sparepart', 'Catatan',
    'Kondisi perbaikan', 'PIC', 'Tipe maintenance', 'Maintenance ID'],

  /** Isi awal Format Laporan = Excel "Form Stop Line Peralatan" (bang Risky): [Kolom, Sumber, Aktif]. */
  REPORT_DEFAULTS: [
    ['序号\nNO', 'NO', 'Ya'],
    ['所属工厂\nPabrik yang bersangkutan', 'Factory', 'Ya'],
    ['Project', 'Project', 'Ya'],
    ['Process', 'Proses', 'Ya'],
    ['Station', 'Station', 'Ya'],
    ['日期\nTanggal', 'Tanggal', 'Ya'],
    ['报修时间\nWaktu Perbaikan', 'Jam mulai', 'Ya'],
    ['维修结束时间\nWaktu Selesai Perbaikan', 'Jam selesai', 'Ya'],
    ['是否停机(1-是,0-否)\nApakah stop line (1-iya,0-tidak)', 'Stop line (1/0)', 'Ya'],
    ['停机时长(分钟)\nDurasi Stop Line (menit)', 'Durasi stop line', 'Ya'],
    ['故障类型\nJenis Kerusakan', 'Jenis kerusakan', 'Ya'],
    ['故障现象\nFenomena Kerusakan', 'Masalah + detail', 'Ya'],
    ['故障原因\nAlasan Kerusakan', 'Penyebab + detail', 'Ya'],
    ['处理措施\nTindakan Penanganan', 'Penanganan + detail', 'Ya'],
    ['备件种类\nJenis Sparepart', 'Jenis sparepart', 'Ya'],
    ['备件名称\nNama Sparepart', 'Nama sparepart', 'Ya'],
    ['备件型号\nModel Sparepart', 'Model sparepart', 'Ya'],
    ['备件数量\nJumlah Sparepart', 'Jumlah sparepart', 'Ya'],
    ['备注信息\nCatatan', 'Catatan', 'Ya'],
    ['维修状态\nKondisi Perbaikan', 'Kondisi perbaikan', 'Ya'],
    ['维修人员\nKaryawan Perbaikan', 'PIC', 'Ya'],
    ['Maintenance ID', 'Maintenance ID', 'Tidak']
  ],

  CONFIG_DEFAULTS: {
    WARN_HOURS: { value: 3, description: 'Jam sejak mulai / konfirmasi terakhir sebelum peringatan' },
    ABANDON_HOURS: { value: 4, description: 'Jam sejak mulai / konfirmasi terakhir sebelum Abandoned (jika peringatan tidak dijawab)' },
    EMAIL_PERINGATAN: { value: 'Ya', description: 'Ya = kirim email ke teknisi saat peringatan. Tidak = cukup banner di app' },
    SHIFT_MULAI: { value: '07:00,15:00,23:00', description: 'Jam mulai tiap shift, dipakai untuk tenggat "Shift berikutnya"' },
    MTTR_TIPE: { value: 'Corrective', description: 'Tipe maintenance yang dihitung ke MTTR (pisahkan dengan koma)' },
    NAMA_APLIKASI: { value: 'MTTR', description: 'Nama aplikasi per lokasi, mis. "MTTR Cikarang" (judul halaman & menu spreadsheet)' },
    LAPORAN_JUDUL: { value: '印尼基地设备停机记录表 Form Stop Line Peralatan Base Indonesia', description: 'Judul baris pertama tab Laporan <tahun>' },
    STOP_LINE_DEFAULT: { value: 'Corrective', description: 'Tipe maintenance yang otomatis "Ya" untuk stop line saat Mulai (pisahkan dengan koma)' },
    LAPORAN_LANGSUNG: { value: 'Ya', description: 'Ya = tab Laporan & Rekap diperbarui setiap aksi (tombol ±0,5 dtk lebih lama). Tidak = hanya tiap malam & lewat tombol' },
    CEK_AKUN: { value: 'Ya', description: 'Ya = aplikasi berhenti jika browser memakai akun Google lain (bug multi-akun) supaya data tidak tercatat atas nama salah. Tidak = tanpa pemeriksaan' }
  },

  LOCK_TIMEOUT_MS: 10000,
  TRIGGER_MINUTES: 15,
  /** Jam (WIB) pembangunan ulang penuh Laporan & Rekap tiap malam. Sehari-hari keduanya diperbarui langsung tiap aksi. */
  REKAP_HOUR: 1,
  HISTORY_LIMIT: 500
};

/** Membaca nilai dari sheet Config, fallback ke default. */
function getConfig_(key) {
  var def = APP.CONFIG_DEFAULTS[key] ? APP.CONFIG_DEFAULTS[key].value : null;
  var cfg = masterData_().config || {};
  var v = cfg[key];
  return (v === '' || v === null || v === undefined) ? def : v;
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

/** Nama aplikasi per lokasi (Config → NAMA_APLIKASI). */
function appName_() {
  try { return String(getConfig_('NAMA_APLIKASI') || APP.NAME); } catch (e) { return APP.NAME; }
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
