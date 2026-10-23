# Changelog

Setiap update: ganti file yang tertulis, Run `setup`, lalu **Deploy → Manage deployments → ✏️ → New version** (URL & QR tetap).
Dua factory = lakukan di kedua spreadsheet. Versi terpasang terlihat di menu spreadsheet → Tentang, dan di aplikasi → tombol **?**.

## 2.6.1 — perbaikan dari uji di Apps Script asli
Ditemukan saat 2.6 dijalankan di Apps Script & Google Sheets asli (spreadsheet uji kosong, 104 pekerjaan berbeda-beda → Laporan 100 baris).
Ganti `Auth`, `Code`, `Config`, `Master`, `Translate`, `Rekap`, `Tampilan`, `Tpm`, Run `setup`, New version.

- **Tab `Maintenance <baterai>` = laporan per project** (nama tetap): tampilan sama dengan `Laporan <tahun>` (judul, kolom `Format Laporan`, warna, belang, warna Kondisi perbaikan), hanya baris project itu, No. 1..n. Sebelumnya 42 kolom data mentah, tersembunyi, dan format manual hilang tiap `setup`. Isinya rumus ke tab Laporan: baris yang ditulis tiap aksi langsung ikut, tombol teknisi tidak lebih lambat, trigger malam tidak menulis ulang bila tidak ada yang berubah. Hanya tahun berjalan (seperti Laporan). Terlihat, tepat setelah Laporan. Lebar kolom yang diatur admin bertahan.
- **Tab per project boleh dihapus / dimatikan**: tab `TPM <project>` atau `Maintenance <baterai>` yang dihapus admin tidak dibuat lagi; aplikasi menulis project itu di `Config` → `TPM_DIMATIKAN` / `TAB_BATERAI_DIMATIKAN` dan di `Log`. Nyalakan lagi = hapus namanya dari Config. `Semua` = tidak ada tab sama sekali (TPM: tanpa baca data & Google Translate). Nama project salah ketik → peringatan di Dashboard admin. Tab yang diganti nama tidak disentuh.

- **Terjemahan Inggris di tab TPM salah (bug sejak 2.5.2).** Teks Indonesia dan 中文 dikirim ke Google Translate dalam satu panggilan dengan deteksi bahasa otomatis; Google menganggap seluruhnya 中文, sehingga teks Indonesia kembali utuh atau rusak di bagian *(English)*. Contoh nyata: "lampu indikator mati" → "Laminator mati", "Kabel sensor putus di konektor" → "Sensor sensor putus di konektor", "pintu safety tidak terkunci" tetap Indonesia. Arah ke 中文 dan dari 中文 tidak terpengaruh. Sekarang satu panggilan = satu bahasa asal yang disebut jelas (ada huruf Han = 中文, selain itu Indonesia).
  - `setup` sekali: sel `en` hasil Google untuk teks non-中文 di tab `Terjemahan` dikosongkan (koreksi admin dan arah lain tetap); tab TPM menerjemahkan ulang pada pembangunan berikutnya (maks 300 teks per bahasa sekali jalan, sisanya malam berikutnya).
  - Tab `Terjemahan` tidak lagi menulis dua baris untuk teks yang sama (satu untuk 中文, satu untuk English); baris lama yang kosong dibuang saat migrasi. Terjemahan untuk baris yang sudah ada ditulis sekaligus per kolom, bukan per sel (40 teks: 160 → 2 tulisan), supaya terjemahan ulang setelah migrasi tidak memperlambat trigger malam.
- **Email ditulis dua kali di `Users`**: peran diambil dari baris pertama tetapi nama dari baris terakhir (terlihat: "Ditutup … oleh <nama baris lain>"). Sekarang peran & nama dari baris yang sama: baris **aktif** pertama (baris lama yang dinonaktifkan tidak lagi mengunci orang itu). Dashboard admin & pesan `setup` memberi peringatan; pilihan PIC tidak dobel.

**Uji di Apps Script asli** (`test/seed-uji.js` + `test/gas/Uji.js`, hanya untuk spreadsheet uji): data dari kode yang sama di atas mock, lalu `ujiIsiData` / `ujiPeriksa` / `ujiAlur` membandingkan hasil runtime asli sel per sel. Ronde 1 (2.6.0): Laporan 100 baris, Rekap, KPI per bulan × Plant / Project / Line, tutup bulan, Ringkasan (tanpa error, Downtime & MTBF = KPI, kedua Top 5), trigger & ID tab cocok dengan hitungan mock; bug terjemahan dan email ganda di atas ditemukan dari isi tab `Terjemahan` & `KPI`. `ujiIsiData` butuh 336 dtk (setup di spreadsheet kosong + setup ulang 104 pekerjaan), dekat batas 360 dtk Apps Script → uji dipecah dan hasil ditulis per bagian.
- Test lokal: penerjemah palsu kini meniru Google (satu bahasa asal per panggilan; deteksi otomatis + huruf Han = 中文 semua). Dengan kode 2.6.0, 4 test langsung gagal. 90 test; jumlah panggilan aksi teknisi tidak berubah.

## 2.6.0 — revisi uji lapangan + KPI MTTR & MTBF bulanan
Gabungan revisi uji lapangan (`Improvement_2.6.md`) dan seluruh rencana 2.5.3 (statistik & download): cukup satu kali salin file.

**Teknisi: lebih sedikit tap**
- **Line = unit kerja**: satu baris `Lines` = satu QR. Scan QR → **MULAI**, tanpa pilih mesin. Mesin penting dijadikan baris `Lines` sendiri (mis. `L01-W` "Assy Cell 1 - Welding"). Satu pekerjaan terbuka per line.
- Pertanyaan **Tipe** hilang: Preventive dihapus, dan field pilihan yang hanya punya satu opsi aktif terisi otomatis.
- **PIC tambahan** saat Selesai: tap nama teknisi lain yang ikut (dari `Users`, boleh >1, bisa dicari). Masuk `Teknisi terlibat`, Laporan (PIC), TPM (Responsibility), Dashboard per teknisi, Log.
- Halaman QR (admin) hanya kartu line. QR mesin lama tetap membuka line-nya.

**Dihapus**
- **Cek** (review Pending): Pending tidak masuk Review; tab Review hanya untuk admin (Cancelled & Abandoned).
- **Preventive** (data lama tetap; kolom Preventive di Rekap, Ringkasan & Dashboard dihapus).
- **Alias** & **Grup** di Lines (kolom lama disembunyikan, boleh dihapus admin). Sheet **Mesin** tidak dipakai lagi (disembunyikan, tidak dihapus).

**KPI bulanan (baru)**
- Tab **`KPI <tahun>`**: per bulan, per **Plant / Project / Line**: Kerusakan, MTTR (menit), Target MTTR, Downtime (jam), Jam operasi, MTBF (jam), Target MTBF, Tercapai (✓ / ✗ MTTR / ✗ MTBF), Status.
- Rumus: Kerusakan = pekerjaan yang masuk MTTR, bulan = bulan selesai (sama dengan Rekap). MTTR = rata-rata waktu aktif. Downtime = Mulai → Selesai pekerjaan stop line. Jam operasi = hari operasi × `JAM_OPERASI_PER_HARI` × jumlah line. **MTBF = (jam operasi − downtime) ÷ kerusakan.**
- Config baru: `JAM_OPERASI_PER_HARI` (24), `HARI_OPERASI` (`Sen-Min`), `TANGGAL_LIBUR`, `KPI_MULAI`. Projects: kolom baru **`Target MTBF (jam)`**.
- **Tutup bulan** (admin): Dashboard mengingatkan bulan lalu yang belum ditutup + jumlah pekerjaan yang masih menunggu review → tombol **Tutup bulan**. Juga menu → **Tutup bulan KPI…**. Angka dikunci di sheet tersembunyi `KPI data`; edit data lama tidak mengubahnya. Tutup ulang = angka diganti, lama & baru dicatat di Log.
- Dashboard: kartu **KPI bulan ini** (Plant: MTTR, MTBF, kerusakan, downtime; per project dengan target & ✓/✗), tile **Downtime stop line**.
- Ringkasan: kotak bulan ini = Selesai, MTTR, **Downtime**, **MTBF**; tabel per project + MTBF & target MTBF.

**Statistik & download (dari rencana 2.5.3)**
- Dashboard → **Ringkasan | Statistik**. Periode hari ini / tanggal / bulan / tahun / rentang + filter. **Lihat per** line, proses, project, teknisi (semua PIC), jenis kerusakan, discipline, masalah, sparepart, hari, bulan. Ukuran: **Jumlah + Pareto** (biru = ±80% total), MTTR, Downtime, MTBF (line/proses/project). Tap batang → daftar pekerjaan → Detail. Angka = definisi KPI.
- Riwayat → **⬇ Download**: file **.xlsx** (kolom tab Laporan, tanggal asli, sparepart ke bawah, judul dibekukan, filter), untuk hari / tanggal / bulan / tahun / rentang + filter Riwayat. Teknisi = pekerjaannya, admin "Semua" = semua; maks 5000 baris. Library ExcelJS 4.4.0 dimuat dari CDN (jsdelivr, cadangan cdnjs, dicek SRI) hanya saat Download; gagal → CSV otomatis.

**Lainnya**
- **Top 5 dua daftar** per line: tersering rusak (jumlah) & terlama diperbaiki (total waktu aktif), di Dashboard & Ringkasan.
- Dashboard per teknisi menghitung **setiap** teknisi terlibat, bukan hanya teknisi terakhir.
- **Nama tab pengaturan boleh diganti** (Users, Lines, Pilihan, …): dikenali lewat ID tab (dicatat `setup`). onEdit, cache, Tampilan & Baca Saya ikut.
- TPM: Machine = nama line (`Lines` → Nama 中文 / English); Responsibility termasuk PIC tambahan.
- Hapus data testing: KPI ikut dibangun ulang; bulan tertutup yang berisi data terhapus dibuka lagi.
- Data contoh preview/perf: line = unit, PIC tambahan, target KPI.

**Kecepatan**: aksi teknisi sama dengan 2.5.2 (Mulai 16, Selesai 23 panggilan). Dashboard admin 11 (daftar bulan tertutup di DocumentProperties). Statistik 6–13, Download 13. Buka app dengan cache kosong 80 → 75.

**Diuji**: 85 test server (KPI dibanding hitungan manual: hari libur, Minggu, `KPI_MULAI`, bulan berjalan, batas zona waktu WIB, line multi-project & nonaktif; tutup / tutup ulang; statistik = KPI; download & akses; ganti nama tab; migrasi dari 2.5.2; locale Indonesia). Preview Playwright (HP 390 px, id + 中文): KPI & tutup bulan, Statistik (Pareto, MTBF, per hari, sparepart, tap batang → Detail), Download .xlsx dibaca ulang dengan openpyxl, cadangan CSV saat CDN diblokir; tanpa error JavaScript.

**Diuji di Google Sheets asli** (spreadsheet uji, locale Indonesia): data contoh 2.6 + tab `KPI 2026` + semua rumus Ringkasan dari kode. Downtime bulan ini (43,5 jam), MTBF Plant dari tab KPI (78,1), MTBF per project, kolom Hasil, kedua Top 5 dan daftar pekerjaan terbuka cocok dengan hitungan terpisah; bulan di tab KPI tetap teks.
- Temuan & perbaikan: QUERY Top 5 ditolak Google (`order by sum(Col3)` padahal kolom SELECT `sum(Col3)/60`, error COL_IN_ORDER_MUST_BE_IN_SELECT) sehingga kedua tabel tampil "–". Tidak terlihat di test karena mock tidak menjalankan QUERY. Sudah diperbaiki + test baru yang memeriksa setiap ORDER BY ada di SELECT.

**Batasan**
- MTTR dimulai saat teknisi menekan Mulai: waktu respon (mesin rusak → teknisi datang) tidak tercatat.
- MTBF sebaik jam operasi di Config; line yang melayani dua project dihitung penuh di keduanya (MTBF project > MTBF Plant).
- Line = unit: line fisik dengan beberapa mesin penting butuh beberapa baris Lines & QR.
- Download .xlsx butuh akses ke CDN; cek sekali dari HP di jaringan pabrik.

**File**: baru `Kpi` (Script). Berubah: `Config`, `Db`, `Master`, `Maintenance`, `Api`, `Rekap`, `Code`, `Tampilan`, `Translate`, `Tpm` (Script), `App`, `I18n`, `Styles`, `Panduan` (HTML). Tidak berubah: `Auth`, `Index`, `Message`, `appsscript.json`. **Wajib Run `setup`** (mematikan field mesin & Preventive sekali, membuat KPI, mencatat ID tab), lalu New version. Tidak ada izin baru.

## 2.5.2 — Excel TPM untuk manager
**Baru**
- Tab **`TPM <project>`** (satu per project) dengan format Excel TPM manager ("Statistical Analysis of Issues Reported from Production"): kotak **Status Overview** per Discipline, Total tasks, nama project, judul kolom baris 8 persis contoh (`No.序号 · Machine · Issue Description 问题描述 · Root Cause 原因分析 · Solution 解决方案 · End Time 解决时间 · Discipline 范围 · Responsibility处理人 · Date · Notes`), data mulai **B9**, lebar kolom & warna sama, baris 1–8 dibekukan, dropdown Discipline.
- Isi: pekerjaan **Corrective** yang **Completed** (sejak 1 Januari; ubah lewat Config `TPM_MULAI` / `TPM_TIPE`). Sel teks = **中文** + baris baru + **(English)**. Pilihan, mesin & line memakai kolom 中文/English di sheet; detail & catatan diterjemahkan Google (disimpan di sheet Terjemahan, koreksi admin dipakai). Sparepart = satu baris di bawah Solution.
- Cara pakai: blok **B9 sampai baris terakhir kolom K** → Copy → paste di Excel manager.
- Diperbarui tiap malam, lewat Dashboard → **Perbarui Laporan, Rekap & TPM**, menu spreadsheet → **Perbarui tab TPM**, dan saat `setup`. Tidak menambah waktu tombol teknisi.
- Jenis kerusakan baru: **Operasional** (操作 / Operation), **Produk** (产品 / Product Item), **MES**. Sheet Pilihan dapat kolom **Discipline** (dropdown Machine / Operation / Product Item / MES), diisi otomatis: Elektrikal/Mekanikal/Pneumatik/Program = Machine.
- Config baru: `TPM_MULAI`, `TPM_TIPE`, `TPM_JUDUL` (judul baris 6), `TPM_PROJECT` (teks baris 3).

**Diuji di Google Sheets asli** (spreadsheet uji, locale Indonesia): tab TPM dari kode + data contoh. Rumus Status Overview & Total tasks benar, jam `h:mm` & tanggal tampil benar, warna/garis/lebar kolom sama dengan contoh manager.

**Beda dengan contoh Excel (sengaja)**: Total tasks dihitung benar (contoh memakai `COUNT(...)-3`); judul baris 6 = `TPM_JUDUL` (contoh masih judul template checklist); kolom A (R/Y/G) dan aturan warna R/Y/G sisa template tidak dipakai; Date ditulis `yyyy-mm-dd` (contoh menampilkan angka seri 46310).

**Belum**: download riwayat .xlsx (menyusul). Cek hasil terjemahan istilah teknis bersama teknisi China.

**File**: baru `Tpm` (Script). Berubah: `Config`, `Master`, `Code`, `Rekap`, `Api`, `Tampilan`, `Translate` (Script), `App`, `I18n`, `Panduan` (HTML). Tidak berubah: `Auth`, `Db`, `Maintenance`, `Index`, `Styles`, `Message`, `appsscript.json`. **Wajib Run `setup`**, lalu New version. Tidak ada izin baru.

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

**Perbaikan aplikasi**
- Filter: tombol **Reset** langsung berlaku dan menutup lembar. Sebelumnya Reset hanya mengosongkan pilihan; kalau lembar ditutup tanpa **Terapkan**, filter lama diam-diam tetap aktif.
- Semua alur aplikasi diuji ulang di preview (34 skenario: mulai, pause, pending, cancel, lanjut via QR oleh teknisi 中文, selesai + sparepart, review admin, riwayat & CSV, dashboard, QR, panduan, akun tidak cocok, banner versi baru) tanpa error JavaScript.

**Catatan**
- Aturan warna (conditional formatting) yang dibuat admin sendiri dipertahankan; filter di tabel dibuat ulang saat setup (kriteria filter yang sedang aktif hilang).
- `setup` sedikit lebih lama (merapikan ±25 tab).

**File**: baru `Tampilan` (Script). Berubah: `Config`, `Code`, `Rekap`, `Panduan`, `App`. **Wajib Run `setup`**, lalu New version.

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
