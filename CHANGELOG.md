# Changelog

Setiap update: ganti file yang tertulis, Run `setup`, lalu **Deploy → Manage deployments → ✏️ → New version** (URL & QR tetap).
Dua factory = lakukan di kedua spreadsheet. Versi terpasang terlihat di menu spreadsheet → Tentang, dan di aplikasi → tombol **?**.

## 2.5.1 — spreadsheet mudah dibaca
**Baru**
- Tab **Ringkasan** paling depan (dua bahasa): pilih tanggal di sel kuning (kosong = hari ini) → kotak angka **hari ini** (dimulai, selesai, MTTR, stop line), **sekarang** (sedang dikerjakan, pending, lewat tenggat, perlu review), **bulan ini** (selesai, MTTR, corrective/preventive), status berwarna, grafik selesai per hari & jenis kerusakan, per project vs target, 5 mesin tersering, daftar pekerjaan yang masih terbuka. Semua berupa rumus: selalu terbaru, tidak memperlambat tombol teknisi. MTTR dihitung sama seperti Rekap.
- Tab **Baca Saya**: arti setiap tab & warna, mana yang boleh diedit, aturan penting.
- Semua tabel: judul berwarna & dibekukan, baris belang, filter, status berwarna (Aktif biru, Pending kuning, Completed hijau, Abandoned merah), tenggat lewat merah, baris nonaktif dipudarkan, tanggal `dd/mm/yyyy hh:mm`, menit tanpa desimal.
- Sheet pengaturan: **dropdown** untuk Aktif (Ya/Tidak), Peran, Bahasa, Untuk, Tipe, Wajib, status Saran (salah ketik diberi tanda).
- Tab diberi warna per kelompok (hijau = mulai di sini, kuning = laporan, biru = pengaturan, abu-abu = ditulis aplikasi) dan diurutkan. Tab jarang dipakai disembunyikan: Projects, Factory, Form, Format Laporan, Catatan Panduan, Config, Rencana, Log, Terjemahan, Maintenance per baterai, Arsip, Laporan/Rekap tahun lalu.
- Menu: **Rapikan tampilan spreadsheet**, **Tampilkan semua tab**.
- Maintenance: kolom email & cap waktu sistem disembunyikan (data tetap ada), 2 kolom pertama dibekukan.
- Laporan: warna & baris belang, kolom Kondisi berwarna (kolom & urutan tidak berubah). Rekap: judul kolom dua bahasa, baris total menonjol.

**Kecepatan**
- Edit di sheet yang bukan pengaturan (Ringkasan, Laporan, Rekap, …) tidak lagi menghapus cache master → buka app berikutnya tetap cepat. Edit di Users/Lines/Mesin/… tetap langsung terlihat.
- Aksi teknisi tidak bertambah panggilan Sheets. Format dirapikan saat setup, menu, dan tiap malam (hanya jika baris sheet bertambah).

**Diuji di Google Sheets asli** (spreadsheet uji, locale Indonesia & en_US): semua rumus Ringkasan, Pending Work dan tab per baterai tanpa error, angka cocok dengan hitungan terpisah (hari ini, bulan lain, per project, jenis, per hari, pekerjaan terbuka), aturan warna & grafik tampil.
- Temuan: spreadsheet ber-locale **Indonesia** membaca rumus dengan pemisah `;` (array `\`, desimal `,`); rumus berkoma error dan `{1,2}` diam-diam jadi angka 1,2. Sekarang `setup` menguji sekali lalu menulis semua rumus (Ringkasan, Pending Work, Maintenance per baterai, aturan warna) dengan sintaks locale spreadsheet. Rumus ditulis lewat `setFormulas`.

**Catatan**
- Aturan warna (conditional formatting) yang dibuat admin sendiri dipertahankan; filter di tabel dibuat ulang saat setup (kriteria filter yang sedang aktif hilang).
- `setup` sedikit lebih lama (merapikan ±25 tab).

**File**: baru `Tampilan` (Script). Berubah: `Config`, `Code`, `Rekap`, `Panduan`. **Wajib Run `setup`**, lalu New version.

## 2.5.0 — bahasa 中文 & teknisi China
**Baru**
- Tampilan **中文 (简体)**: tombol **中 / ID** di Beranda (tersimpan di HP). Bahasa awal per orang dari `Users` → kolom `Bahasa` (`zh`). Semua menu, tombol, pesan, panduan.
- Label pilihan / form / mesin / line dalam 中文 dari kolom baru `Nilai (中文)`, `Label (中文)`, `Nama (中文)` (+ `Nilai (English)`, `Nama (English)` untuk TPM). Nilai tersimpan tetap Indonesia → laporan & filter tidak pecah.
- **🌐 Terjemahkan / 翻译** untuk teks bebas (detail, kartu pekerjaan, aktivitas, catatan panduan) memakai Google Translate bawaan Apps Script; disimpan di sheet `Terjemahan` (bisa dikoreksi admin) + cache. Error server diterjemahkan untuk user 中文.
- Detail kejadian (timeline, aktivitas) menampilkan label baku dalam bahasa tampilan tanpa Google Translate; teks bebas di dalamnya tetap bisa diterjemahkan.
- **💡 Saran** di Beranda (sheet `Saran`): teknisi kirim & lihat tanggapan; admin ubah status & tanggapi, badge saran baru, saran 中文 otomatis diterjemahkan.
- **Rencana update** di Panduan (sheet `Rencana`): login tanpa Google, pindah dari Apps Script, SOP operator, terjemahan Claude API.
- Menu spreadsheet → **Isi terjemahan otomatis (中文 / English)…** untuk sel yang masih kosong.
- Kartu QR yang dicetak: teks dua bahasa (Indonesia + 中文).

**Kecepatan**
- Tombol 🌐: banyak teks digabung jadi satu panggilan Google, hasil ditulis ke sheet sekaligus (15 teks: 15× Google + 37 panggilan Sheets → 1× Google + 9). Satu klik menerjemahkan sampai 50 teks.
- Google menolak (mis. kuota harian habis) → langsung berhenti mencoba; teks asli tetap tampil tanpa error.
- Menu **Isi terjemahan otomatis** memakai cara gabungan yang sama (tidak lagi satu panggilan per sel).
- Tampilan 中文 menyebut font Han bawaan HP (PingFang / Noto / YaHei) → layout huruf Mandarin lebih cepat.
- Aksi teknisi (Mulai, Pause, Selesai, …) tidak bertambah panggilan Sheets; teknisi Indonesia tidak lebih lambat dari 2.2.6.

**Perbaikan**
- Tombol 🌐 di kartu pending halaman line muncul juga saat teknisi belum punya pekerjaan terbuka.
- Koreksi `Nilai (中文)` di sheet untuk nilai yang juga ada di kamus bawaan (mis. Corrective) sekarang dipakai.
- Isi kolom isian (textarea) tidak ikut diterjemahkan otomatis (sebelumnya bisa tersimpan dalam 中文).

**File**: baru `Translate` (Script), `I18n` (HTML). Berubah: `Config`, `Master`, `Api`, `Auth`, `Code`, `Index`, `App`, `Styles`, `Panduan`.
**Wajib Run `setup`** (kolom & sheet baru), lalu New version. Tidak ada izin baru.

## 2.2.6
- Deteksi bug Google multi-akun: jika browser mengirim tombol atas nama akun lain (akun utama browser) atau Google menolak, aplikasi berhenti dengan layar **"Akun Google tidak cocok"** + cara memperbaikinya. Mencegah data tercatat atas nama yang salah.
- Login tidak berubah. Teknisi dengan satu akun Google tidak melihat apa pun. Ditolak tanpa info akun (mis. sesi login habis) → layar "Tidak terhubung ke akun Google" yang menyarankan **Muat ulang** dulu.
- Bisa dimatikan: `Config` → `CEK_AKUN` = `Tidak` (baris ini muncul setelah Run `setup`; tanpa baris = aktif).
- **File**: `Api`, `App`, `Styles`, `Panduan`, `Config`. Run `setup` hanya jika ingin baris `CEK_AKUN` muncul di Config; lalu New version.

## 2.2.5
- Menu spreadsheet → **Hapus data testing…**: hapus permanen pekerjaan yang dimulai sebelum tanggal tertentu (atau semua), beserta Log, pemakaian sparepart dan arsipnya; Laporan & Rekap dibuat ulang. Wajib ketik `HAPUS`. Sheet master tidak disentuh.
- **File**: `Rekap`, `Code`, `Config`, `Panduan`. Setelah paste: **muat ulang spreadsheet** supaya menu baru muncul. Tidak perlu Run `setup`.

## 2.2.4
- HP yang masih membuka versi lama setelah admin deploy versi baru → banner **"Versi baru sudah terpasang → Muat ulang"** (dicek tiap ±1 menit).
- `setup` memakai lock saat membangun Laporan & Rekap, jadi aman dijalankan saat teknisi sedang bekerja.
- **File**: `Config`, `Code`, `Api`, `App`, `Styles`, `Panduan`. Tidak perlu Run `setup`; cukup New version.

## 2.2.3
- Pemilih sparepart: Jenis jadi satu baris yang bisa digeser; **Nama dan Model jadi dua kolom berdampingan dengan tinggi tetap**, masing-masing di-scroll.
  Tidak lagi memunculkan deretan tombol baru yang memanjang ke bawah saat katalog besar. Posisi scroll tidak melompat saat menambah part.
- **File**: `App`, `Styles`, `Config` (nomor versi). Tidak perlu Run `setup`; cukup New version.

## 2.2.2
- Laporan & Rekap diperbarui **langsung setiap aksi** (Mulai, Pause, Selesai, Cancel, review, …), menggantikan "tiap jam" di 2.2.1.
  Bangun ulang penuh tetap tiap malam ±01:00 dan lewat tombol Dashboard. Bisa dimatikan: `Config` → `LAPORAN_LANGSUNG` = `Tidak`.
- Tab Laporan punya kolom kunci tersembunyi di kanan ("ID sistem …"). Jangan dihapus.
- Biaya: tiap tombol +4 panggilan ke Sheets (Selesai/Cancel +6) ≈ 0,3–0,6 detik.
- **File**: `Config`, `Code`, `Rekap`, `Maintenance`, `Api`, `App`, `Panduan`. **Wajib Run `setup` lagi** (trigger malam & key Config baru).

## 2.2.1
- Laporan & Rekap diperbarui tiap jam (digantikan 2.2.2).
- `setup` mengecek semua file proyek dulu dan menyebut nama file yang belum dibuat. Fungsi baru `cekFile` (Run dari editor).
- Pesan error asli tetap tampil walau file HTML `Message` belum dibuat.
- **File**: `Config`, `Code`, `Rekap`, `Api`, `App`, `Panduan`. **Wajib Run `setup` lagi** supaya jadwal trigger berganti.

## 2.2.0 — diskusi mentor

**Baru**
- Tab `Laporan <tahun>` dengan format Excel "Form Stop Line Peralatan" (21 kolom dua bahasa). Kolom diatur di sheet `Format Laporan`.
- Sparepart: katalog `Sparepart` (Jenis → Nama → Model), cari, banyak part, jumlah −/+, tambah manual. Pemakaian dicatat di `Pemakaian Sparepart`.
- Daftar part ditulis ke bawah (satu per baris), bukan dipisah `;`.
- Jenis kerusakan (Elektrikal / Mekanikal / Pneumatik / Program) wajib di Selesai; detail opsional untuk masalah, penyebab, penanganan.
- Stop line ditanya saat Mulai (default dari `Config` → `STOP_LINE_DEFAULT`).
- `Lines`: kolom `Proses` (filter & laporan) dan `Alias` (pencarian).
- Nama PIC/teknisi disimpan sebagai nama (email tetap ada).
- `Config` → `NAMA_APLIKASI` untuk nama per lokasi.
- Halaman Panduan di aplikasi (Teknisi/Admin) + sheet `Catatan Panduan` + badge "Versi baru".
- Dashboard: Jenis kerusakan, Sparepart paling sering dipakai, tombol Perbarui Laporan & Rekap (admin).
- Arsip tahunan ikut memindahkan pemakaian sparepart (`Arsip Sparepart <tahun>`).

**Dihapus**
- BOM (sheet `BOM` lama tidak dibaca lagi; boleh dihapus manual). Pilihan jenis `Part` tidak dipakai lagi.

**Perbaikan**
- Baris di sheet master yang kolom pertamanya kosong tidak lagi terlewat diam-diam (sekarang terbaca atau diperingatkan).

**File**: baru `Panduan` (HTML). Berubah: `Config`, `Master`, `Db`, `Maintenance`, `Api`, `Code`, `Rekap`, `Index`, `App`, `Styles`.

## 2.1.1 — kecepatan
- Cache data master (CacheService), data awal ditanam di halaman, aksi tidak membaca ulang data. Panggilan Sheets per aksi turun dari 55–124 menjadi 10–12.
- **File**: `Config`, `Master`, `Db`, `Auth`, `Maintenance`, `Api`, `Code`, `Rekap`, `Index`, `App`.

## 2.1.0 — modular
- Sheet master: `Factory`, `Projects`, `Lines` (Grup sub-line A/B), `Mesin`, `BOM`, `Pilihan`, `Form`, `Config`.
- Kunci per mesin, QR mesin, scan QR di dalam app, cari line, filter factory/baterai/line.
- Preventive/Corrective (Preventive tidak masuk MTTR), "Lainnya → isi sendiri", dashboard MTTR & status project.
- Rekap tahunan (`Rekap <tahun>`) dan arsip per tahun.
- **File**: semua; baru `Master`, `Rekap`.

## 2.0.0
- Pause / Pending / Cancel / Abandoned, MTTR dari waktu aktif saja, review admin, UI baru.

## 1.0
- Versi trial (branch `claude/google-app-script-web-app-waahwz`).
