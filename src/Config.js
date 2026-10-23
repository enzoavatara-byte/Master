/**
 * Konfigurasi global MTTR. Nama sheet, header, status, dan peran ada di sini.
 * Semua yang boleh diubah user (pilihan, form, factory, project, line, mesin, sparepart, format laporan,
 * batas waktu, nama aplikasi) ada di Google Sheet, bukan di file ini — file ini hanya berisi nilai awal & aturan sistem.
 */
var APP = {
  NAME: 'MTTR',          // nama default; per lokasi diubah lewat Config → NAMA_APLIKASI
  VERSION: '2.6.1',      // tampil di Panduan & menu: cek kedua factory memakai versi yang sama
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
    PENDING: 'Pending Work',
    TERJEMAHAN: 'Terjemahan',
    SARAN: 'Saran',
    RENCANA: 'Rencana',
    KPI_DATA: 'KPI data'
  },

  /** Sheet pengaturan yang dibaca ke cache master: edit di sini → cache dihapus. Edit sheet lain (Ringkasan, Laporan, …) tidak. */
  MASTER_SHEETS: ['Users', 'Factory', 'Projects', 'Lines', 'Mesin', 'Sparepart', 'Format Laporan', 'Catatan Panduan', 'Pilihan', 'Form', 'Config', 'Rencana'],

  /** Sheet yang ditulis/dibaca kode. Tab turunan (FILTER) dibuat terpisah di setup(). */
  HEADERS: {
    /** Bahasa: id (kosong) / zh = tampilan aplikasi berbahasa Mandarin untuk user ini. */
    Users: ['Email', 'Nama', 'Peran', 'Aktif', 'Bahasa'],
    Factory: ['Factory ID', 'Nama', 'Lokasi', 'Aktif'],
    /** Satu baris per baterai/project. Sumber "baterai apa saja di factory ini" + status project. */
    Projects: ['Factory ID', 'Baterai', 'Fase', 'Target MTTR (menit)', 'Catatan', 'Aktif', 'Target MTBF (jam)'],
    /** 2.6: satu baris = satu unit kerja = satu QR (mesin tidak dipilih lagi; nama mesin cukup ditulis di Nama Line).
     *  Proses = kelompok di atas line (kolom "Process" laporan). Baterai kosong = semua project di factory-nya.
     *  Kolom lama Alias, Grup (dan sheet Mesin) tidak dipakai lagi; boleh dihapus admin. */
    Lines: ['Line ID', 'Nama Line', 'Proses', 'Factory ID', 'Baterai', 'Area', 'Aktif', 'Nama (中文)', 'Nama (English)'],
    /** Katalog sparepart, sama dengan Excel: Jenis → Nama → Model (Model boleh kosong). */
    Sparepart: ['Jenis Sparepart', 'Nama Sparepart', 'Model', 'Satuan', 'Urutan', 'Aktif'],
    /** Satu baris per part per pekerjaan (ditulis aplikasi) → bisa direkap. */
    'Pemakaian Sparepart': ['Tanggal', 'Maintenance ID', 'Factory', 'Line', 'Proses', 'Mesin', 'Baterai', 'Jenis kerusakan',
      'Jenis Sparepart', 'Nama Sparepart', 'Model', 'Jumlah', 'Satuan', 'Manual', 'PIC', 'Email PIC'],
    /** Kolom tab "Laporan <tahun>": judul kolom bebas, Sumber = salah satu REPORT_SOURCES atau nama kolom Maintenance. */
    'Format Laporan': ['Kolom', 'Sumber', 'Urutan', 'Aktif'],
    /** Catatan lokal admin yang tampil di Panduan aplikasi. Untuk: Teknisi / Admin / Semua. */
    'Catatan Panduan': ['Untuk', 'Judul', 'Isi', 'Urutan', 'Aktif'],
    /** Nilai = yang disimpan (kanonik). Kolom 中文/English hanya label tampilan & untuk Excel TPM.
     *  Discipline: hanya untuk Jenis Kerusakan = kolom "Discipline 范围" tab TPM (Machine / Operation / Product Item / MES). */
    Pilihan: ['Jenis', 'Nilai', 'Urutan', 'Aktif', 'Nilai (中文)', 'Nilai (English)', 'Discipline'],
    Form: ['Form', 'Field', 'Label', 'Tipe', 'Sumber', 'Wajib', 'Lainnya isi sendiri', 'Urutan', 'Aktif', 'Label (中文)'],
    /** Cache terjemahan teks bebas (diisi otomatis; admin boleh mengoreksi sel id/zh/en, koreksi dipakai ulang). */
    Terjemahan: ['Teks', 'Bahasa asal', 'id', 'zh', 'en', 'Sumber', 'Diperbarui'],
    /** Saran teknisi untuk admin (menu Saran di Beranda). */
    Saran: ['ID', 'Tanggal', 'Email', 'Nama', 'Kategori', 'Isi', 'Bahasa', 'Terjemahan', 'Status', 'Tanggapan', 'Ditanggapi oleh', 'Ditanggapi pada'],
    /** Rencana update berikutnya, tampil di Panduan → Rencana. Status: Rencana / Dikerjakan / Selesai. */
    Rencana: ['Judul', 'Isi', 'Status', 'Target', 'Urutan', 'Aktif'],
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
    Log: ['Timestamp', 'Maintenance ID', 'Kejadian', 'User', 'Detail'],
    /** KPI bulan yang sudah DITUTUP admin (2.6): salinan angka saat ditutup. Ditulis aplikasi, disembunyikan & diproteksi. */
    'KPI data': ['Bulan', 'Level', 'Kunci', 'Nama', 'Kerusakan', 'MTTR (menit)', 'Target MTTR (menit)', 'Downtime (jam)', 'Jam operasi',
      'MTBF (jam)', 'Target MTBF (jam)', 'Tercapai', 'Ditutup pada', 'Ditutup oleh']
  },

  DATE_COLUMNS: {
    Maintenance: ['Mulai', 'Selesai', 'Tenggat', 'Status sejak', 'Konfirmasi terakhir', 'Peringatan pada', 'Direview pada'],
    Log: ['Timestamp'],
    'Pemakaian Sparepart': ['Tanggal'],
    Saran: ['Tanggal', 'Ditanggapi pada'],
    Terjemahan: ['Diperbarui'],
    'KPI data': ['Ditutup pada']
  },

  LANGS: ['id', 'zh'],
  SARAN_KATEGORI: ['Fitur aplikasi', 'Pilihan / isian baru', 'Sparepart', 'Mesin / Line', 'Lainnya'],
  SARAN_STATUS: ['Baru', 'Dibaca', 'Direncanakan', 'Selesai', 'Ditolak'],
  /** Isi awal sheet Rencana (poin 2 & 3 diskusi 2.5). */
  RENCANA_DEFAULTS: [
    ['Login tanpa akun Google', 'Untuk teknisi yang tidak memakai Google. Opsi: login PIN di aplikasi ini, atau aplikasi di Lark/Feishu (飞书), DingTalk (钉钉), WeCom (企业微信).', 'Rencana', 'Update besar'],
    ['Pindah dari Google Apps Script', 'Jika proyek sudah diakui perusahaan: aplikasi & database di platform perusahaan (lebih cepat, tanpa batas Google, tanpa bug multi-akun).', 'Rencana', 'Update besar'],
    ['SOP perawatan untuk operator produksi', 'Teknisi ME mengusulkan pengecekan harian untuk operator supaya mesin tidak cepat rusak; admin menetapkan, lalu SOP diberikan ke produksi.', 'Rencana', ''],
    ['Terjemahan AI (Claude API)', 'Jika terjemahan Google kurang tepat untuk istilah teknis. Perlu API key berbayar dan izin akses internet (semua user izin ulang sekali).', 'Rencana', '']
  ],
  /** Label bawaan 中文 / English untuk isi awal sheet Pilihan (admin boleh mengubah di sheet). */
  OPTION_I18N: {
    'Corrective': ['故障维修', 'Corrective'], 'Preventive': ['预防性维护', 'Preventive'],
    'Elektrikal': ['电气', 'Electrical'], 'Mekanikal': ['机械', 'Mechanical'], 'Pneumatik': ['气动', 'Pneumatic'], 'Program': ['程序', 'Program'],
    'Operasional': ['操作', 'Operation'], 'Produk': ['产品', 'Product Item'], 'MES': ['MES', 'MES'],
    'Mesin berhenti': ['设备停机', 'Machine stopped'], 'Sensor error': ['传感器故障', 'Sensor error'], 'Kebocoran': ['泄漏', 'Leakage'],
    'Suara/getaran abnormal': ['异响/异常振动', 'Abnormal noise/vibration'], 'Hasil produk NG': ['产品不良 (NG)', 'Product NG'],
    'Komponen aus': ['零件磨损', 'Worn component'], 'Kabel/konektor longgar': ['线缆/接头松动', 'Loose cable/connector'],
    'Setting berubah': ['参数设置变化', 'Setting changed'], 'Kotor/kontaminasi': ['脏污/污染', 'Dirt/contamination'], 'Salah operasi': ['操作失误', 'Operating error'],
    'Ganti part': ['更换零件', 'Replace part'], 'Setting ulang': ['重新设置', 'Reset settings'], 'Bersihkan': ['清洁', 'Clean'],
    'Kencangkan/perbaiki koneksi': ['紧固/修复连接', 'Tighten/repair connection'],
    'Istirahat': ['休息', 'Break'], 'Ambil part/alat': ['取备件/工具', 'Get parts/tools'],
    'Menunggu part': ['等待备件', 'Waiting for parts'], 'Menunggu jadwal stop produksi': ['等待停产时间', 'Waiting for production stop'],
    'Butuh teknisi lain': ['需要其他技术员', 'Need another technician'],
    'Salah line': ['选错产线', 'Wrong line'], 'Input ganda': ['重复录入', 'Duplicate entry'], 'Masalah hilang sendiri': ['问题自行消失', 'Problem resolved itself']
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
    ABANDON: 'abandoned', REVIEW: 'review', TUTUP_BULAN: 'tutup bulan'
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
    'Tipe Maintenance': ['Corrective'],
    'Jenis Kerusakan': ['Elektrikal', 'Mekanikal', 'Pneumatik', 'Program', 'Operasional', 'Produk', 'MES'],
    'Masalah': ['Mesin berhenti', 'Sensor error', 'Kebocoran', 'Suara/getaran abnormal', 'Hasil produk NG'],
    'Penyebab': ['Komponen aus', 'Kabel/konektor longgar', 'Setting berubah', 'Kotor/kontaminasi', 'Salah operasi'],
    'Penanganan': ['Ganti part', 'Setting ulang', 'Bersihkan', 'Kencangkan/perbaiki koneksi'],
    'Alasan Pause': ['Istirahat', 'Ambil part/alat'],
    'Yang Tertunda': ['Menunggu part', 'Menunggu jadwal stop produksi', 'Butuh teknisi lain'],
    'Alasan Cancel': ['Salah line', 'Input ganda', 'Masalah hilang sendiri']
  },

  /** Pilihan baru di versi lama: setup() menambahkannya jika belum ada (baris Aktif = Tidak dihitung ada → tidak muncul lagi). */
  OPTION_MIGRATE: { 'Jenis Kerusakan': ['Operasional', 'Produk', 'MES'] },
  /** Kolom Discipline tab TPM = 4 nilai Excel manager. Bawaan per Jenis Kerusakan; admin mengubah di sheet Pilihan → Discipline. */
  TPM_DISCIPLINES: ['Machine', 'Operation', 'Product Item', 'MES'],
  DISCIPLINE_DEFAULTS: { Elektrikal: 'Machine', Mekanikal: 'Machine', Pneumatik: 'Machine', Program: 'Machine',
    Operasional: 'Operation', Produk: 'Product Item', MES: 'MES' },

  /**
   * Isi awal sheet Form: [Form, Field, Label, Tipe, Sumber, Wajib, Lainnya isi sendiri, Urutan, Label (中文)].
   * Tipe: pilihan | teks | angka | sistem. Field = nama kolom di sheet Maintenance.
   * Baris "sistem" punya logika khusus: label/urutan boleh diubah, tidak bisa dihapus/dinonaktifkan.
   * Baris baru dengan Tipe pilihan/teks/angka = field tambahan; kolomnya dibuat otomatis di Maintenance.
   */
  FORM_DEFAULTS: [
    // Urutan pecahan (2.5, 1.5, …) = field baru 2.2, supaya langsung berada di posisi yang benar di sheet Form lama.
    ['Mulai', 'Tipe', 'Tipe maintenance', 'sistem', 'Tipe Maintenance', 'Ya', 'Tidak', 2, '维修类型'],
    ['Mulai', 'Stop line', 'Apakah line berhenti (stop line)?', 'sistem', '', 'Ya', 'Tidak', 2.5, '产线是否停线？'],
    ['Mulai', 'Baterai', 'Baterai', 'sistem', '', 'Ya', 'Tidak', 3, '电池项目'],
    ['Pause', 'Alasan pause', 'Alasan pause', 'pilihan', 'Alasan Pause', 'Tidak', 'Ya', 1, '暂停原因'],
    ['Pending', 'Pekerjaan dilakukan', 'Pekerjaan yang sudah dilakukan', 'teks', '', 'Ya', 'Tidak', 1, '已完成的工作'],
    ['Pending', 'Yang tertunda', 'Yang tertunda', 'pilihan', 'Yang Tertunda', 'Ya', 'Ya', 2, '待处理事项'],
    ['Pending', 'Tenggat', 'Tenggat', 'sistem', '', 'Ya', 'Tidak', 3, '期限'],
    ['Pending', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 4, '备注'],
    ['Selesai', 'Jenis kerusakan', 'Jenis kerusakan', 'pilihan', 'Jenis Kerusakan', 'Ya', 'Tidak', 0.5, '故障类型'],
    ['Selesai', 'Masalah', 'Fenomena / masalah', 'pilihan', 'Masalah', 'Ya', 'Ya', 1, '故障现象'],
    ['Selesai', 'Detail masalah', 'Detail masalah', 'teks', '', 'Tidak', 'Tidak', 1.5, '现象详情'],
    ['Selesai', 'Penyebab', 'Alasan / penyebab', 'pilihan', 'Penyebab', 'Ya', 'Ya', 2, '故障原因'],
    ['Selesai', 'Detail penyebab', 'Detail penyebab', 'teks', '', 'Tidak', 'Tidak', 2.5, '原因详情'],
    ['Selesai', 'Penanganan', 'Tindakan penanganan', 'pilihan', 'Penanganan', 'Ya', 'Ya', 3, '处理措施'],
    ['Selesai', 'Detail penanganan', 'Detail penanganan', 'teks', '', 'Tidak', 'Tidak', 3.5, '措施详情'],
    ['Selesai', 'Part', 'Sparepart yang diganti', 'sistem', '', 'Ya', 'Ya', 4, '更换的备件'],
    ['Selesai', 'PIC tambahan', 'PIC lain yang ikut mengerjakan', 'sistem', '', 'Tidak', 'Tidak', 4.5, '其他参与人员'],
    ['Selesai', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 5, '备注'],
    ['Cancel', 'Alasan cancel', 'Alasan cancel', 'pilihan', 'Alasan Cancel', 'Ya', 'Ya', 1, '取消原因'],
    ['Cancel', 'Catatan', 'Catatan', 'teks', '', 'Tidak', 'Tidak', 2, '备注']
  ],
  FORMS: ['Mulai', 'Pause', 'Pending', 'Selesai', 'Cancel'],
  /** Baris Form baru di 2.2: setup() menambahkannya ke sheet Form lama jika belum ada (baris lain tidak disentuh). */
  FORM_MIGRATE: ['Mulai.Stop line', 'Selesai.Jenis kerusakan', 'Selesai.Detail masalah', 'Selesai.Detail penyebab', 'Selesai.Detail penanganan',
    'Selesai.PIC tambahan'],
  /** 2.6: baris Form yang tidak dipakai lagi (mesin tidak dipilih) → setup menyetel Aktif = Tidak, aplikasi melewatinya. */
  FORM_RETIRE: ['Mulai.Mesin ID'],
  /** 2.6: pilihan yang dimatikan SEKALI saat upgrade (admin boleh menyalakannya lagi; setup berikutnya tidak menyentuhnya). */
  OPTION_RETIRE_ONCE: { 'Tipe Maintenance': ['Preventive'] },
  /** Field sistem yang selalu aktif (logika aplikasi bergantung padanya). */
  LOCKED_FIELDS: ['Mulai.Tipe', 'Mulai.Baterai', 'Pending.Yang tertunda', 'Pending.Tenggat', 'Selesai.Part', 'Cancel.Alasan cancel'],
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
    CEK_AKUN: { value: 'Ya', description: 'Ya = aplikasi berhenti jika browser memakai akun Google lain (bug multi-akun) supaya data tidak tercatat atas nama salah. Tidak = tanpa pemeriksaan' },
    TPM_MULAI: { value: '', description: 'Tab TPM: pekerjaan yang dimulai sejak tanggal ini (dd/mm/yyyy). Kosong = 1 Januari tahun ini' },
    TPM_TIPE: { value: 'Corrective', description: 'Tab TPM: tipe maintenance yang masuk (pisahkan dengan koma). Hanya yang sudah Completed' },
    TPM_JUDUL: { value: 'Statistical Analysis of Issues Reported from Production', description: 'Tab TPM: judul baris 6' },
    TPM_PROJECT: { value: 'PROJECT NAME ATPU', description: 'Tab TPM: teks baris 3 (di atas nama project)' },
    TPM_DIMATIKAN: { value: '', description: 'Project tanpa tab TPM (pisahkan koma), mis. E245. Semua = tab TPM tidak dibuat sama sekali (tanpa Google Translate). Tab TPM dihapus → project itu ditulis di sini otomatis; hapus namanya dari sini untuk membuat tabnya lagi' },
    TAB_BATERAI_DIMATIKAN: { value: '', description: 'Project tanpa tab "Maintenance <baterai>" (laporan per project), pisahkan koma. Semua = tidak ada. Tab dihapus → project itu ditulis di sini otomatis; hapus namanya dari sini untuk membuat tabnya lagi' },
    JAM_OPERASI_PER_HARI: { value: 24, description: 'KPI MTBF: jam operasi per line per hari operasi (mis. 24 = 3 shift, 16 = 2 shift)' },
    HARI_OPERASI: { value: 'Sen-Min', description: 'KPI MTBF: hari operasi, mis. "Sen-Min" (setiap hari), "Sen-Sab", atau "Sen,Sel,Rab,Kam,Jum"' },
    TANGGAL_LIBUR: { value: '', description: 'KPI MTBF: tanggal tidak beroperasi (dd/mm/yyyy, pisahkan dengan koma), mis. 25/12/2026, 01/01/2027' },
    KPI_MULAI: { value: '', description: 'KPI: dihitung sejak tanggal ini (dd/mm/yyyy), mis. tanggal aplikasi mulai dipakai. Kosong = awal bulan data pertama' }
  },

  LOCK_TIMEOUT_MS: 10000,
  TRIGGER_MINUTES: 15,
  /** Jam (WIB) pembangunan ulang penuh Laporan & Rekap tiap malam. Sehari-hari keduanya diperbarui langsung tiap aksi. */
  REKAP_HOUR: 1,
  HISTORY_LIMIT: 500,
  /** Download Riwayat (.xlsx / CSV): batas baris per file. */
  EXPORT_LIMIT: 5000
};

/** Membaca nilai dari sheet Config, fallback ke default. */
function getConfig_(key) {
  var def = APP.CONFIG_DEFAULTS[key] ? APP.CONFIG_DEFAULTS[key].value : null;
  var cfg = masterData_().config || {};
  var v = cfg[key];
  return (v === '' || v === null || v === undefined) ? def : v;
}

/** Tulis satu nilai Config (baris Key; ditambah jika belum ada). Cache master dibuang. */
function setConfig_(key, value) {
  var sh = sheet_(APP.SHEETS.CONFIG), v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var ck = h.indexOf('Key'), cv = h.indexOf('Value'), at = -1;
  for (var i = 1; i < v.length && at < 0; i++) if (String(v[i][ck]).trim() === key) at = i + 1;
  if (at > 0) sh.getRange(at, cv + 1).setValue(value);
  else appendObj_(APP.SHEETS.CONFIG, { 'Key': key, 'Value': value, 'Keterangan': APP.CONFIG_DEFAULTS[key] ? APP.CONFIG_DEFAULTS[key].description : '' });
  invalidateMaster_();
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

/** 'machine' / 'mes' / … → nilai Discipline TPM resmi; tidak dikenal → ''. (Dipakai Master: harus ada walau file Tpm belum dibuat.) */
function normDiscipline_(v) {
  var s = String(v || '').trim().toLowerCase();
  for (var i = 0; i < APP.TPM_DISCIPLINES.length; i++) if (APP.TPM_DISCIPLINES[i].toLowerCase() === s) return APP.TPM_DISCIPLINES[i];
  return '';
}

/** Kolom Aktif kosong dianggap aktif untuk sheet master (baris baru tidak langsung hilang). */
function isActiveRow_(v) {
  return String(v == null ? '' : v).trim() === '' || isYes_(v);
}

function splitList_(v) {
  return String(v == null ? '' : v).split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
}
