# Changelog

Setiap update: ganti file yang tertulis, Run `setup`, lalu **Deploy → Manage deployments → ✏️ → New version** (URL & QR tetap).
Dua factory = lakukan di kedua spreadsheet. Versi terpasang terlihat di menu spreadsheet → Tentang, dan di aplikasi → tombol **?**.

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
