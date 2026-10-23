# MTTR Maintenance 2.6

Pencatatan maintenance via scan QR. Google Apps Script + Google Sheets, mobile-first.
**MTTR = rata-rata waktu *aktif* pekerjaan Corrective** (Pause & Pending dicatat terpisah). Sejak 2.6 aplikasi juga menjadi sumber **KPI bulanan MTTR & MTBF**. Semua waktu dicatat server (Asia/Jakarta).

**Prinsip utama: aplikasi diubah lewat Google Sheet, bukan lewat kode.** Factory, project baterai (+ target KPI), line (= unit, proses), katalog sparepart, jam operasi KPI,
isi pilihan, field form, format laporan, catatan panduan, dan batas waktu semuanya berupa sheet. Ubah sheet → request berikutnya langsung memakai data baru, tanpa deploy ulang.

```
scan QR line → (stop line) → MULAI → Aktif ⇄ Pause
                                     Aktif/Pause → Pending → (lanjut, user mana pun, konfirmasi QR) → Aktif
                                     Aktif → Completed          (jenis kerusakan, masalah, penyebab, penanganan, sparepart, PIC tambahan)
                                     Aktif/Pause → Cancelled    (alasan wajib → review Admin)
                                     > 3 jam tanpa konfirmasi → peringatan → tidak dijawab s/d 4 jam → Abandoned
```

Riwayat versi: [CHANGELOG.md](CHANGELOG.md). Panduan singkat untuk teknisi & admin juga ada **di dalam aplikasi** (tombol **?**).

---

## Yang baru di 2.6: revisi uji lapangan + KPI bulanan

| Permintaan | Implementasi |
|---|---|
| QR jadi satu, mesin di dalam line | **Line = unit kerja**: satu baris `Lines` = satu QR, tanpa pilih mesin. Mesin penting cukup dijadikan baris sendiri (mis. `L01-W` "Assy Cell 1 - Welding"). Sheet `Mesin` tidak dipakai lagi (disembunyikan, tidak dihapus). Satu pekerjaan terbuka per line |
| Hapus fungsi Cek | Pending tidak masuk Review lagi; tab Review hanya untuk Admin (Cancelled & Abandoned) |
| Hapus Preventive | Tipe hanya Corrective; pertanyaan Tipe hilang (pilihan dengan 1 opsi tidak ditanyakan). Data Preventive lama tetap |
| Hapus Alias & Grup | Logika dihapus; kolom lama disembunyikan, boleh dihapus admin |
| Tambah PIC saat Selesai | **PIC tambahan**: tap nama dari `Users` (boleh >1, bisa dicari). Masuk `Teknisi terlibat`, Laporan (PIC), TPM (Responsibility), Dashboard per teknisi, Log |
| Top 5 juga lama mengerjakan | Dua daftar per line: **tersering rusak** (jumlah) & **terlama diperbaiki** (total waktu aktif), di Dashboard & Ringkasan |
| KPI MTTR & MTBF per bulan | Tab **`KPI <tahun>`** (Plant / Project / Line): kerusakan, MTTR, downtime, jam operasi, MTBF, target, ✓/✗. **Tutup bulan** oleh admin = angka dikunci. Kartu KPI di Dashboard, MTBF & downtime di Ringkasan |
| Nama tab boleh diganti | Tab pengaturan (Users, Lines, Pilihan, …) dikenali lewat ID tab, bukan nama |
| Statistik & download (rencana 2.5.3) | Dashboard → **Statistik** (lihat per line/proses/project/teknisi/jenis/discipline/masalah/sparepart/hari/bulan; Jumlah + Pareto, MTTR, Downtime, MTBF; tap batang → daftar). Riwayat → **Download** .xlsx (kolom tab Laporan) |

**Rumus KPI** (sama di tab KPI, Dashboard, Statistik, Ringkasan):
- **Kerusakan** = pekerjaan yang masuk MTTR (`Masuk MTTR = Ya`: Corrective selesai + Abandoned yang dihitung admin). Bulan = bulan selesai (sama dengan Rekap).
- **MTTR** (menit) = rata-rata waktu aktif. **Downtime** (jam) = Mulai → Selesai pekerjaan stop line (= "Durasi stop line" di Laporan).
- **Jam operasi** = hari operasi × `JAM_OPERASI_PER_HARI` × jumlah line. Hari operasi = `HARI_OPERASI` tanpa `TANGGAL_LIBUR`, sejak `KPI_MULAI`; bulan berjalan s/d hari ini.
  Jumlah line = line aktif + line yang rusak di bulan itu. Line yang melayani beberapa project dihitung penuh di setiap project.
- **MTBF** (jam) = (jam operasi − downtime) ÷ kerusakan. Tanpa kerusakan → kosong, target MTBF dianggap tercapai.
- **Target**: `Projects` → `Target MTTR (menit)` (≤) dan `Target MTBF (jam)` (≥).

## 0. Yang baru di 2.5.0: bahasa 中文 & teknisi China

| Permintaan | Implementasi |
|---|---|
| Versi bahasa China | Tombol **中 / ID** di Beranda. Semua menu, tombol, pesan, dan panduan tampil dalam 中文 (简体). Bahasa awal per orang: `Users` → kolom **`Bahasa`** (`zh` / kosong = Indonesia); pilihan di HP disimpan di HP itu |
| Pilihan, form, mesin, line dalam 中文 | Kolom baru `Nilai (中文)` + `Nilai (English)` (Pilihan), `Label (中文)` (Form), `Nama (中文)` + `Nama (English)` (Mesin), `Nama (中文)` (Lines). **Yang disimpan tetap nilai Indonesia**, jadi laporan, rekap, dan filter tidak terpecah dua bahasa. Kolom English disiapkan untuk Excel TPM (2.5.1) |
| Translate di dalam aplikasi | Tombol **🌐 Terjemahkan / 翻译** di detail, kartu pekerjaan, aktivitas, panduan: teks bebas (pekerjaan dilakukan, detail, catatan, isian "Lainnya") Indonesia ⇄ 中文. Pesan error server juga diterjemahkan untuk user 中文 |
| Mesin terjemahan | **Google Translate bawaan Apps Script** (`LanguageApp`): gratis, tanpa API key, tanpa izin baru. Hasil disimpan di sheet **`Terjemahan`** + cache 6 jam; teks yang sama tidak diterjemahkan dua kali. Admin bisa mengoreksi sheet itu (koreksi langsung dipakai). Claude API masuk Rencana |
| Isi label 中文 cepat | Menu spreadsheet → **Isi terjemahan otomatis (中文 / English)…**: mengisi sel 中文/English yang masih kosong. Isi awal (Tipe, Jenis kerusakan, contoh Masalah, dst.) sudah diisi `setup` tanpa Google Translate |
| Menu Saran di halaman utama | Beranda → **💡 Saran**: teknisi kirim usul (kategori + isi, bahasa apa saja), lihat status & tanggapan. Admin: semua saran (saran 中文 otomatis diterjemahkan ke Indonesia), ubah status Baru/Dibaca/Direncanakan/Selesai/Ditolak, tulis tanggapan; badge jumlah saran baru. Sheet **`Saran`** |
| Alternatif selain Google & SOP operator (rencana saja) | Sheet **`Rencana`** → tampil di Panduan → **Rencana update**: login tanpa akun Google (PIN / Lark 飞书 / DingTalk 钉钉 / WeCom 企业微信), pindah dari Apps Script, SOP perawatan untuk operator, terjemahan Claude API |

**Teknisi China tetap butuh akun Google** (dibuatkan Gmail; daftarkan di `Users` dengan `Bahasa` = `zh`). Login tanpa Google = update besar, lihat Rencana.

**2.5.1 — spreadsheet mudah dibaca:** tab **Ringkasan** (pilih tanggal → angka hari ini / sekarang / bulan ini, grafik, per project, pekerjaan terbuka) dan **Baca Saya** di depan,
warna status & tab per kelompok, dropdown di sheet pengaturan, tab jarang dipakai disembunyikan (§4).

**2.5.2**: tab **`TPM <project>`** = format Excel TPM manager (中文 + English per sel), siap di-copy ke Excel manager; jenis kerusakan baru
Operasional / Produk / MES + kolom **Discipline** di `Pilihan` (§6).

Tahap berikutnya: download riwayat (.xlsx) dan **2.5.3** statistik.

---

## 1. Yang baru di 2.2

| Permintaan (diskusi mentor) | Implementasi |
|---|---|
| Hasil akhir sama dengan Excel bang Risky | Tab **`Laporan <tahun>`**: 21 kolom "Form Stop Line Peralatan" (judul dua bahasa), satu baris per pekerjaan. Kolom bisa diatur di sheet `Format Laporan` (§4) |
| Sparepart: cari + banyak part + jenis bertingkat + manual | Form Selesai: **Tidak ada pergantian / Ada part** → kolom cari, atau **Jenis → Nama → Model**; jumlah −/+; **Tambah manual** jika tidak ada di katalog. Katalog di sheet `Sparepart` |
| Catat pemakaian sparepart | Sheet **`Pemakaian Sparepart`**: 1 baris per part (tanggal, line, proses, mesin, jenis kerusakan, part, jumlah, manual?, nama PIC). Dashboard: "Sparepart paling sering dipakai" |
| Daftar part ditulis ke bawah, bukan `;` | Kolom `Part` di Maintenance dan kolom sparepart di Laporan: **satu part per baris** dalam sel |
| Jenis perbaikan Elektrikal / Mekanikal / Pneumatik | Field **Jenis kerusakan** (wajib, satu pilihan) di Selesai. Isi di `Pilihan` → Jenis Kerusakan (default + Program). Filter jenis sparepart ikut otomatis |
| Menu Proses seperti Excel | Kolom **`Proses`** di `Lines` (grup di atas line). Filter Proses di semua tab, tampil di laporan |
| Stop line & durasi | Ditanya saat **Mulai** (default Ya untuk Corrective). Laporan: 1/0 dan durasi = jam selesai − jam mulai (0 jika tidak stop line) |
| Masalah/penyebab/penanganan | Tetap pilihan (supaya bisa direkap) + **detail opsional** di bawahnya |
| PIC tampil nama, bukan email | Kolom baru `Nama PIC`, `Nama teknisi awal`, `Nama teknisi terlibat` (email tetap disimpan sebagai ID) |
| Cari line pakai nama panggilan | Kolom **`Alias`** di `Lines` (pisah koma). Dipakai di Cari line dan kotak cari. Line ID tidak berubah |
| Dua factory, kode sama | Dua salinan spreadsheet, kode identik (§3) |
| Nama aplikasi per lokasi | `Config` → **`NAMA_APLIKASI`** (judul halaman, Beranda, menu spreadsheet, judul rekap) |
| Panduan di aplikasi | Tombol **?**: panduan Teknisi & Admin (fitur, cara ubah, kekurangan) + catatan lokal dari sheet `Catatan Panduan` + "Apa yang baru" |
| Changelog | `CHANGELOG.md` + badge "Versi baru" sekali di aplikasi + menu spreadsheet → Tentang |
| Hapus BOM | Sheet & kartu BOM tidak dipakai lagi (sheet lama tidak dihapus otomatis; boleh dihapus manual) |

---

## 2. Upgrade

### Ke 2.6.1 (dari 2.6.0)
Ganti `Auth`, `Code`, `Config`, `Master`, `Translate`, `Rekap`, `Tampilan`, `Tpm` (Script). **Run `setup`**: terjemahan Inggris lama yang salah di tab `Terjemahan` dikosongkan sekali (koreksi admin tidak disentuh; tab TPM menerjemahkan ulang malam berikutnya atau lewat Dashboard → Perbarui); tab `Maintenance <baterai>` diganti format laporan per project dan ditampilkan setelah Laporan; 2 kunci Config baru (`TPM_DIMATIKAN`, `TAB_BATERAI_DIMATIKAN`). Lalu New version. Tidak ada izin baru.

### Ke 2.6.1 (dari 2.5.2)

| Jenis | Nama | Status |
|---|---|---|
| Script | `Kpi` | **BARU** |
| Script | `Config`, `Db`, `Master`, `Maintenance`, `Api`, `Rekap`, `Code`, `Tampilan`, `Translate`, `Tpm`, `Auth` | berubah |
| HTML | `App`, `I18n`, `Styles`, `Panduan` | berubah |
| Script / HTML | `Index`, `Message`, `appsscript.json` | tetap |

1. Buat file Script **`Kpi`**, paste semua file yang berubah, Ctrl+S.
2. **Run `setup`** (wajib). Yang dilakukan, aman untuk data lama:
   - baris Form "pilih mesin" dimatikan; pilihan `Preventive` dimatikan **sekali** (kalau admin menyalakannya lagi, setup berikutnya tidak mematikannya); pekerjaan Pending dikeluarkan dari antrean review;
   - field `Selesai · PIC tambahan`, kolom `Projects → Target MTBF (jam)`, 4 kunci `Config` KPI, sheet tersembunyi `KPI data`, tab `KPI <tahun>`;
   - mencatat ID tab pengaturan (setelah ini nama tab boleh diganti). **Ganti nama tab baru boleh setelah `setup` 2.6 jalan**, bukan sebelumnya;
   - jika sheet `Mesin` berisi data, pesan setup menyebut jumlahnya: buat baris `Lines` sendiri untuk mesin yang perlu QR sendiri, lalu cetak QR-nya;
   - terjemahan Inggris lama dari Google di tab `Terjemahan` dikosongkan sekali (2.6.1, lihat CHANGELOG); pesan setup menyebut jumlahnya;
   - tab `Maintenance <baterai>` menjadi laporan per project (2.6.1) dan terlihat setelah `Laporan <tahun>`.
3. Isi `Projects` → `Target MTBF (jam)` dan `Config` → `JAM_OPERASI_PER_HARI`, `HARI_OPERASI`, `TANGGAL_LIBUR`, `KPI_MULAI` (tanggal aplikasi mulai dipakai sungguhan).
4. Deploy → Manage deployments → ✏️ → **New version**. Tidak ada izin baru.
5. QR **line** lama tetap berfungsi. QR **mesin** lama membuka line-nya (tanpa memilih mesin). Kalau mesin dijadikan baris `Lines` sendiri, cetak QR barunya dari Dashboard → QR.
6. Sekali saja, di HP: Riwayat → Download → Excel. Jika muncul pesan "Library Excel tidak bisa dimuat", jaringan memblokir CDN (jsdelivr / cdnjs); file CSV tetap diunduh.

### Ke 2.5.2 (dari 2.5.1)
Buat file Script **`Tpm`**; ganti `Config`, `Master`, `Code`, `Rekap`, `Api`, `Tampilan`, `Translate` (Script) dan `App`, `I18n`, `Panduan` (HTML). Yang lain tetap.
**Run `setup`**: menambah kolom `Discipline` di `Pilihan` (diisi bawaan), jenis kerusakan Operasional / Produk / MES (jika belum ada), 4 kunci TPM di `Config`, dan tab `TPM <project>`. Lalu New version. Tidak ada izin baru.

### Ke 2.5.1 (dari 2.5.0)
Buat file Script `Tampilan`; ganti `Config`, `Code`, `Rekap`, `Panduan`. **Run `setup`** (membuat Ringkasan & Baca Saya, merapikan semua tab), lalu New version.
Dari 2.2.x langsung ke 2.5.1: ikuti langkah 2.5.0 di bawah ditambah file `Tampilan`, cukup satu kali Run `setup`.

### Ke 2.5.0 (dari 2.2.x)

| Jenis | Nama | Status |
|---|---|---|
| Script | `Translate` | **BARU** |
| HTML | `I18n` | **BARU** |
| Script | `Config`, `Master`, `Api`, `Auth`, `Code` | berubah |
| HTML | `Index`, `App`, `Styles`, `Panduan` | berubah |
| Script / HTML | `Db`, `Maintenance`, `Rekap`, `Message` | tetap |

1. Buat file Script `Translate` dan HTML `I18n`, paste semua file yang berubah, Ctrl+S.
2. **Run `setup`** (wajib): menambah kolom `Bahasa` & kolom 中文/English, sheet `Terjemahan`, `Saran`, `Rencana`, dan mengisi label 中文 bawaan.
3. Teknisi China: `Users` → `Bahasa` = `zh`. Opsional: menu → **Isi terjemahan otomatis…** lalu cek istilahnya bersama teknisi China.
4. Deploy → Manage deployments → ✏️ → **New version**. Tidak ada izin baru (LanguageApp tidak butuh scope tambahan).

### Ke 2.2 (dari 2.1 / 2.1.1)

**File di Apps Script** (nama sama dengan `src/`, tanpa ekstensi):

| Jenis | Nama | Status di 2.2 |
|---|---|---|
| HTML | `Panduan` | **BARU**: buat file HTML ini |
| Script | `Config`, `Master`, `Db`, `Maintenance`, `Api`, `Code`, `Rekap` | **berubah** |
| HTML | `Index`, `App`, `Styles` | **berubah** |
| Script | `Auth` | tetap |
| HTML | `Message` | tetap |
| JSON | `appsscript.json` | tetap |

Langkah:
1. Buat file HTML `Panduan`, copy-paste semua file yang berubah. Ctrl+S.
2. Jalankan **`setup`**. Aman untuk data lama: sheet baru (`Sparepart`, `Pemakaian Sparepart`, `Format Laporan`, `Catatan Panduan`) dibuat dengan isi contoh,
   kolom baru ditambah di kanan (`Lines`: Alias, Proses; `Maintenance`: Proses, Stop line, Jenis kerusakan, Detail…, Nama…), baris Form baru ditambahkan, tab `Laporan <tahun>` dibuat.
3. Isi: `Lines` → Proses & Alias; `Sparepart` → ganti contoh dengan katalog asli; `Config` → `NAMA_APLIKASI`.
4. **Deploy → Manage deployments → ✏️ → New version → Deploy.** Bukan "New deployment" (URL berubah, semua QR mati).
5. QR tidak perlu dicetak ulang.

Install baru dari nol: buat spreadsheet → Extensions → Apps Script → paste 17 file + `appsscript.json` → Run `setup` → Deploy web app *Execute as: User accessing*, *Anyone with Google account* → share spreadsheet sebagai Editor ke semua user.

**Apakah update/deploy menghapus data, atau mengacaukan pekerjaan yang sedang berjalan?** Tidak:
- Data ada di **Google Sheet**, kode ada di **Apps Script**. Deploy hanya mengganti kode. `setup` hanya *menambah* sheet/kolom/baris yang belum ada; tidak menghapus data.
- Status, jam mulai, dan total waktu aktif/pause disimpan di sheet, bukan di HP. Pekerjaan yang sedang Aktif/Pause tetap berjalan, timer tidak ter-reset, MTTR tidak berubah.
- HP yang masih membuka versi lama tetap bisa dipakai. Dalam ±1 menit muncul banner **"Versi baru sudah terpasang → Muat ulang"**. Kalau isian dari versi lama tidak cocok dengan server baru, server **menolak** dengan pesan error (tidak menulis data setengah jadi); muat ulang lalu ulangi.
- Saat kode sedang di-paste (sebelum New version), trigger tiap 15 menit memakai kode yang baru disimpan. Paste semua file sekaligus (±5 menit); paling buruk satu jalannya trigger gagal dan dicoba lagi 15 menit kemudian.
- Yang benar-benar berbahaya: **New deployment** (URL baru → semua QR mati), menghapus/mengganti nama sheet atau judul kolom, dan salah file saat menyalin untuk factory kedua.
- Versi baru bermasalah? Deploy → Manage deployments → ✏️ → pilih **versi sebelumnya** → Deploy. Data tidak ikut mundur. Spreadsheet juga punya **File → Version history**.

---

## 3. Dua factory (data terpisah, kode sama)

1. Spreadsheet factory 1 → **File → Make a copy** (Apps Script ikut tersalin).
2. Di salinan: hapus **baris data** (bukan baris judul) di `Maintenance`, `Log`, `Pemakaian Sparepart`; hapus tab `Arsip …`, `Rekap …`, `Laporan …`.
3. Isi `Users`, `Factory`, `Projects`, `Lines`, `Sparepart` factory 2. `Config` → `NAMA_APLIKASI` = mis. "MTTR Factory 2".
4. Extensions → Apps Script → Run **`setup`** → **Deploy → New deployment** (salinan butuh URL sendiri) → cetak QR dari Dashboard → QR.
5. Setiap update kode: paste ke **kedua** file + New version di keduanya. Cek versi lewat menu spreadsheet → **Tentang**.

Sengaja tidak ada tombol "hapus semua data": terlalu berbahaya jika terpencet di file utama.
Rekap gabungan dua factory (opsional): file ketiga dengan `IMPORTRANGE` ke tab `Laporan <tahun>` kedua file.

---

## 4. Panduan edit sheet (apa yang diubah, di mana)

**Membaca spreadsheet (2.5.1).** Mulai dari tab **Ringkasan**; arti tab & warna ada di tab **Baca Saya**.
Warna tab: hijau = mulai di sini · kuning = laporan · biru = pengaturan (boleh diedit admin) · abu-abu = ditulis aplikasi (jangan diedit).
Tab yang jarang dipakai disembunyikan → menu → **Tampilkan semua tab**; menu → **Rapikan tampilan spreadsheet** menyembunyikannya lagi dan memperbaiki format.
Ringkasan hanya berisi rumus ke `Maintenance` (dihitung Google Sheets, bukan aplikasi). Rumus mengikuti locale spreadsheet (Indonesia: pemisah `;`, en_US: `,`) — `setup` menguji sendiri; ganti locale (File → Settings) tidak merusak rumus yang sudah ada. Yang boleh diubah hanya sel tanggal kuning. Data tahun yang sudah diarsipkan tidak ikut dihitung.

Aturan umum: **kolom `Aktif` boleh kosong = aktif** (kecuali di `Users`, wajib `Ya`). Matikan dengan `Tidak`; **jangan hapus baris**, karena riwayat masih merujuk ke baris itu.
Nama header kolom jangan diganti. Urutan kolom boleh diubah.
**Nama tab pengaturan boleh diganti (2.6)**: `Users`, `Factory`, `Projects`, `Lines`, `Sparepart`, `Format Laporan`, `Catatan Panduan`, `Pilihan`, `Form`, `Config`, `Rencana` (mis. `Lines` → "Daftar Line 产线"). Aplikasi mengenali tab lewat ID-nya; Baca Saya ikut memakai nama baru. Tab yang ditulis aplikasi (`Maintenance`, `Log`, `Laporan …`, `Rekap …`, `KPI …`, `TPM …`, `Pending Work`, `Ringkasan`, …) jangan diganti namanya.

| Sheet | Untuk apa | Kolom & contoh |
|---|---|---|
| `Users` | Akses + **nama yang tampil di laporan** | Email · Nama · Peran (`Teknisi`/`Admin`) · Aktif (`Ya`) · Bahasa (`zh` / kosong = Indonesia) |
| `Factory` | Daftar factory/gedung | `F1` · Factory 1 · Bogor |
| `Projects` | Baterai per factory + status project + target KPI | `F1` · `VF7` · Fase `Trial` · Target MTTR `45` · Catatan · Target MTBF (jam) `150` |
| `Lines` | Satu baris = satu unit = satu QR (= Station di laporan, Machine di TPM) | `L03-A` · Formation 1A · **Proses** `Formation` · `F1` · Baterai (kosong = semua project factory) · Area · Aktif · Nama (中文) · Nama (English). Mesin yang perlu QR sendiri = baris sendiri |
| `Mesin` | Tidak dipakai lagi (2.6) | Disembunyikan; dibaca hanya untuk label 中文 data lama. Boleh dihapus setelah semua mesin penting dijadikan baris `Lines` |
| `Sparepart` | Katalog | Jenis Sparepart `Mekanikal` · Nama `Bearing` · Model `6205-2RS` (boleh kosong) · Satuan · Urutan · Aktif |
| `Pemakaian Sparepart` | Ditulis aplikasi (jangan diedit) | 1 baris per part dipakai. Bisa dibuat pivot/filter |
| `Pilihan` | Isi semua pilihan | Jenis · Nilai · Urutan. Jenis: `Jenis Kerusakan`, `Tipe Maintenance`, `Masalah`, `Penyebab`, `Penanganan`, `Alasan Pause`, `Yang Tertunda`, `Alasan Cancel`, atau jenis baru |
| `Form` | Field form | Form · Field · Label · Tipe · Sumber · Wajib · Lainnya isi sendiri · Urutan · Aktif |
| `Format Laporan` | Kolom tab Laporan | Kolom (judul bebas) · Sumber (lihat di bawah) · Urutan · Aktif |
| `Catatan Panduan` | Catatan lokal di halaman Panduan | Untuk (`Teknisi`/`Admin`/`Semua`) · Judul · Isi · Urutan · Aktif |
| `Terjemahan` | Hasil tombol 🌐 (Google Translate) | Teks · Bahasa asal · id · zh · en · Sumber · Diperbarui. Kolom id/zh/en boleh dikoreksi |
| `Saran` | Saran teknisi (ditulis aplikasi) | Tanggal · Nama · Kategori · Isi · Terjemahan · Status · Tanggapan. Tanggapi dari aplikasi (💡 Saran) |
| `Rencana` | Rencana update di Panduan | Judul · Isi · Status · Target · Urutan · Aktif |
| `Ringkasan`, `Baca Saya` | Dibuat aplikasi (setup / tiap malam) | Jangan diedit selain sel tanggal kuning di Ringkasan |
| `Config` | Aturan | `WARN_HOURS` 3 · `ABANDON_HOURS` 4 · `EMAIL_PERINGATAN` · `SHIFT_MULAI` · `MTTR_TIPE` · `NAMA_APLIKASI` · `LAPORAN_JUDUL` · `STOP_LINE_DEFAULT` Corrective · `LAPORAN_LANGSUNG` Ya · `CEK_AKUN` Ya · `TPM_…` · **KPI**: `JAM_OPERASI_PER_HARI` 24 · `HARI_OPERASI` `Sen-Min` (atau `Sen-Sab`, `Sen,Sel,Rab`) · `TANGGAL_LIBUR` `25/12/2026, 01/01/2027` · `KPI_MULAI` (dd/mm/yyyy) |
| `KPI <tahun>`, `KPI data` | Ditulis aplikasi | KPI bulanan; `KPI data` (tersembunyi) = salinan bulan yang sudah ditutup. Jangan diedit |

**Kolom 中文 / English** (`Pilihan`: `Nilai (中文)`, `Nilai (English)`; `Form`: `Label (中文)`; `Lines`: `Nama (中文)`, `Nama (English)` — English dipakai TPM; kosong = terjemahan otomatis):
hanya label tampilan. Kosong = tampil teks Indonesia. Nilai yang tersimpan di `Maintenance` selalu kolom Indonesia, jadi mengganti label 中文 tidak mengubah data lama.

**Jenis sparepart = nilai Jenis Kerusakan** (Elektrikal/Mekanikal/Pneumatik/Program). Kalau berbeda, Dashboard memberi peringatan karena filter otomatis tidak akan cocok.

**Sumber di `Format Laporan`**: `NO`, `Factory`, `Nama factory`, `Project`, `Proses`, `Line`, `Station`, `Tanggal`, `Jam mulai`, `Jam selesai`, `Stop line (1/0)`,
`Durasi stop line`, `Waktu aktif (menit)`, `Jenis kerusakan`, `Masalah + detail`, `Penyebab + detail`, `Penanganan + detail`, `Jenis sparepart`, `Nama sparepart`,
`Model sparepart`, `Jumlah sparepart`, `Catatan`, `Kondisi perbaikan`, `PIC`, `Tipe maintenance`, `Maintenance ID`, atau **nama kolom mana pun di `Maintenance`**.

### Sheet `Form`: mengubah form tanpa coding
- **Ganti label / urutan / wajib**: kolom `Label`, `Urutan`, `Wajib`. (Mis. label Masalah = "Fenomena / masalah" seperti Excel.)
- **Matikan pertanyaan**: `Aktif` = `Tidak` (mis. Mulai · Stop line). Jangan hapus barisnya: `setup` akan menambahkannya lagi.
- **"Lainnya → isi sendiri"**: kolom `Lainnya isi sendiri` (`Ya`/`Tidak`).
- **Tambah field baru**: tambah baris (Tipe `pilihan`/`teks`/`angka`). Kolom dengan nama yang sama dibuat otomatis di `Maintenance`.
- **Field sistem** (Tipe, Baterai, Yang tertunda, Tenggat, Part, Alasan cancel): label/urutan boleh diubah, tidak bisa dimatikan. **PIC tambahan** (Selesai) boleh dimatikan (`Aktif` = `Tidak`).
- Field pilihan yang hanya punya **satu opsi aktif** (mis. Tipe = Corrective) terisi otomatis dan tidak ditanyakan.
- Baris yang tidak valid tidak membuat app error: dilewati dan didaftar di **Dashboard → "Perlu dicek di Google Sheet"** (Admin).

### Pilihan saja vs isian bebas (dan kenapa)
| Field | Bentuk |
|---|---|
| Jenis kerusakan | pilihan saja (kunci laporan & filter sparepart) |
| Masalah, Penyebab, Penanganan | pilihan + "Lainnya" + **detail opsional** |
| Sparepart | katalog + **tambah manual** |
| Pekerjaan dilakukan (pending) | teks wajib |
| Factory, Proses, Baterai, Line, Tipe, Stop line, Tenggat, Jumlah | pilihan saja |

Isian bebas murni membuat rekap tidak berguna ("sensor eror" ≠ "sensor error"). Rutinitas mingguan: **Dashboard → "Isian Lainnya terbanyak"** (termasuk sparepart manual) → jadikan yang sering muncul pilihan tetap di `Pilihan`/`Sparepart`.

---

## 5. Cara pakai teknisi

- **Mulai**: **SCAN QR** → **stop line** (otomatis Ya untuk Corrective) → **MULAI**. Tidak ada pilih mesin / tipe (2.6). Satu line hanya bisa punya satu pekerjaan terbuka.
- **Pause / Pending / Cancel**: seperti 2.1.
- **Selesai**: Jenis kerusakan → Masalah (+ detail) → Penyebab (+ detail) → Penanganan (+ detail) → **PIC tambahan** (tap nama teknisi lain yang ikut, opsional) → Sparepart:
  - **Tidak ada pergantian**, atau
  - **Ada part** → ketik di kotak cari (mis. `6205`) *atau* pilih Jenis → Nama → Model → atur jumlah −/+ → ulangi untuk part lain;
  - tidak ada di katalog → **Tambah manual** (jenis, nama, model, jumlah).
- **QR tidak berfungsi**: Beranda → **Cari line** (ketik ID, nama, atau proses).
- Lupa caranya: tombol **?** di Beranda.
- **Bahasa**: tombol **中 / ID** di Beranda. Teks yang ditulis orang lain tetap bahasa aslinya → **🌐 Terjemahkan / 翻译**. Boleh menulis dalam 中文; laporan menyimpan teks asli.
- **Saran**: Beranda → **💡 Saran**.

---

## 6. Laporan, rekap & arsip (Admin)

- **`Laporan <tahun>`** = format Excel. Satu baris per pekerjaan yang *dimulai* di tahun itu (Cancelled tidak ikut; Pending/Abandoned ikut dengan Kondisi masing-masing).
  Kolom sparepart: satu part per baris dalam sel, urutannya sejajar antar-kolom (Jenis / Nama / Model / Jumlah).
- **`Rekap <tahun>`** = ringkasan per bulan (seperti 2.1).
- Keduanya **diperbarui langsung setiap aksi** (Mulai, Pause, Resume, Pending, Lanjut, Selesai, Cancel, review, Abandoned): hanya baris pekerjaan itu yang ditulis di Laporan, dan angka Rekap dihitung ulang dari data yang sudah di memori.
  Cancel → barisnya dihapus dan NO diurutkan ulang. Matikan dengan `Config` → `LAPORAN_LANGSUNG` = `Tidak` jika tombol terasa terlalu lambat.
- **Bangun ulang penuh** tiap malam ±01:00, lewat Dashboard → **Perbarui Laporan, Rekap & TPM**, atau menu spreadsheet → **Laporan & Rekap tahunan**. Perlu setelah admin **mengedit sheet `Maintenance` secara manual** (edit manual tidak memicu sinkron). Mengubah `Format Laporan` otomatis memicu bangun ulang di aksi berikutnya.
- Kolom terakhir tab Laporan (tersembunyi, "ID sistem …") adalah kunci baris untuk sinkron. Jangan dihapus; kalau terhapus, aksi berikutnya membangun ulang tab.
- Jangan edit tab Laporan/Rekap (ditulis ulang). Perbaiki datanya di `Maintenance`.
- Untuk dikirim: klik kanan tab → **Copy to → New spreadsheet** → File → Download → Microsoft Excel.
- **`Maintenance <baterai>`** (2.6.1) = laporan per project: judul, kolom, warna & belang sama dengan `Laporan <tahun>`, hanya baris project itu, No. 1..n. Isinya rumus ke tab Laporan (selalu terbaru, tombol teknisi tidak lebih lambat), jadi **hanya tahun berjalan**. Butuh kolom `Project` aktif di `Format Laporan`. Jangan diedit; lebar kolom boleh diatur (bertahan).
- **Tab per project boleh dihapus** (2.6.1): hapus tab `TPM <project>` atau `Maintenance <baterai>` → tidak dibuat lagi; saat Perbarui / malam / `setup` aplikasi menulis nama project itu di `Config` → `TPM_DIMATIKAN` / `TAB_BATERAI_DIMATIKAN` (+ `Log`). Nyalakan lagi = hapus namanya dari Config. `Semua` = tidak ada tab sama sekali (TPM: tanpa Google Translate, trigger malam lebih cepat). Tab yang diganti nama tidak disentuh (cara menyimpan salinan).
- **`TPM <project>`** (2.5.2) = format Excel TPM manager ("Statistical Analysis of Issues Reported from Production"): kotak Status Overview (COUNTIF per Discipline), Total tasks, judul kolom baris 8,
  data mulai **B9**: No · Machine · Issue Description · Root Cause · Solution · End Time · Discipline · Responsibility · Date · Notes. Satu tab per project.
  - Isi: pekerjaan `TPM_TIPE` (default Corrective) yang **Completed**, dimulai sejak `TPM_MULAI` (kosong = 1 Januari), urut waktu mulai. Sumber: Machine = mesin (atau line), Issue = Masalah + detail, Root Cause = Penyebab + detail,
    Solution = Penanganan + detail + satu baris sparepart, End Time = jam selesai, Date = tanggal mulai, Responsibility = nama teknisi, Notes = Catatan (tanpa cap waktu).
  - Sel teks = `中文` + baris baru + `(English)`. Pilihan, mesin & line memakai kolom 中文/English di sheet; teks bebas lewat Google Translate + sheet `Terjemahan` (koreksi admin dipakai). Maks 300 teks baru per bahasa sekali jalan; sisanya tetap teks asli dan diterjemahkan saat pembaruan berikutnya.
  - **Discipline** dari `Pilihan` → kolom `Discipline` (Jenis Kerusakan): bawaan Elektrikal/Mekanikal/Pneumatik/Program = Machine, Operasional = Operation, Produk = Product Item, MES = MES. Kosong/salah = Machine (+ peringatan di Dashboard).
  - Nilai statis, dibangun ulang tiap malam, lewat Dashboard → **Perbarui Laporan, Rekap & TPM**, menu spreadsheet → **Perbarui tab TPM**, dan saat `setup`. Tidak di jalur tombol teknisi (terjemahan butuh waktu).
  - Cara kirim: blok **B9 sampai baris terakhir kolom K** → Copy → paste di Excel manager. Jangan edit tab TPM (tertimpa); perbaiki di `Maintenance` / `Pilihan` / `Terjemahan`.
  - Bedanya dengan contoh Excel: Total tasks = jumlah baris sebenarnya (contoh: `COUNT(...)-3`), judul baris 6 dari `TPM_JUDUL` (contoh masih judul template checklist), kolom A (R/Y/G) dan aturan warna R/Y/G sisa template tidak dipakai, tanggal `yyyy-mm-dd`.
- **`KPI <tahun>`** (2.6) = KPI bulanan per **Plant / Project / Line**: Bulan · Level · Nama · Kerusakan · MTTR · Target MTTR · Downtime · Jam operasi · MTBF · Target MTBF · Tercapai (✓ / ✗ MTTR / ✗ MTBF) · Status.
  - Rumus: lihat "Yang baru di 2.6". Nilai statis, dibangun ulang tiap malam, lewat Dashboard → **Perbarui Laporan, Rekap, TPM & KPI**, menu → **Perbarui tab KPI**, saat tutup bulan dan `setup`.
  - **Tutup bulan**: Dashboard (admin) mengingatkan bulan lalu yang belum ditutup + jumlah pekerjaan bulan itu yang masih menunggu review → **Tutup bulan …**. Atau menu → **Tutup bulan KPI…** (bulan mana pun yang sudah lewat).
    Angka bulan itu disalin ke `KPI data` dan sejak itu selalu dipakai, walau data lama diedit. **Tutup ulang** = angka diganti; angka lama & baru dicatat di `Log`.
    Selesaikan review dulu baru tutup bulan: Abandoned yang belum direview tidak dihitung.
  - Cek silang: Kerusakan & MTTR Plant = angka `Rekap` bulan itu (persis, kecuali bulan `KPI_MULAI` jika tanggalnya di tengah bulan). Jumlah baris `TPM <project>` sebulan ≈ Kerusakan project itu; bisa beda sedikit karena TPM memakai tanggal **mulai** dan hanya Completed, KPI memakai tanggal **selesai** dan ikut menghitung Abandoned yang disetujui admin.
- **Statistik** (Dashboard → Statistik): periode (hari ini / tanggal / bulan / tahun / rentang) + filter → lihat per line, proses, project, teknisi (semua PIC), jenis kerusakan, discipline, masalah, sparepart, hari, bulan.
  Ukuran: Jumlah + **Pareto** (biru = ±80% total), MTTR, Downtime, MTBF (line/proses/project). Dasar = kerusakan yang sudah selesai (sama dengan KPI). Tap batang → daftar pekerjaan → Detail.
- **Download Riwayat** (Riwayat → ⬇ Download): pekerjaan yang dimulai di periode + filter & status Riwayat; teknisi = pekerjaannya sendiri, admin "Semua" = semua. Kolom = tab Laporan. File **.xlsx** (tanggal asli, sparepart ke bawah, judul dibekukan, filter), maks 5000 baris. Library Excel (ExcelJS 4.4.0) dimuat dari CDN saat dipakai; gagal → CSV.
- **Hapus data testing** (sebelum mulai pakai sungguhan): menu → **Hapus data testing…** → tanggal mulai pakai (dd/mm/yyyy; kosong = semua) → cek jumlah → ketik `HAPUS`.
  Menghapus permanen pekerjaan yang dimulai sebelum tanggal itu dari `Maintenance`, `Log`, `Pemakaian Sparepart` dan tab Arsip (termasuk sheet yang diproteksi), lalu membangun ulang Laporan, Rekap, TPM & KPI. Bulan KPI yang sudah ditutup s/d tanggal itu dibuka lagi (tutup ulang setelah dicek). Tab `Maintenance <baterai>` & `Pending Work` ikut bersih (rumus). Sheet master tidak disentuh.
  Menghapus baris langsung di tab Laporan/Rekap **tidak bisa**: tab itu selalu dibuat ulang dari `Maintenance`. Backup dulu (File → Make a copy); bisa dikembalikan lewat File → Version history.
- **Arsip** (awal tahun, menu → Arsipkan data tahun lalu): pekerjaan final + Log + **pemakaian sparepart** pindah ke `Arsip <tahun>`, `Arsip Log <tahun>`, `Arsip Sparepart <tahun>`.
  Laporan tahun itu tetap utuh karena ikut membaca tab arsip.

---

## 7. Risiko nyata

1. **Teknisi tetap butuh akses Editor ke spreadsheet.** Makin banyak sheet master, makin besar risiko salah edit. Mitigasi: `Maintenance`, `Log`, `Pemakaian Sparepart` diproteksi *warning-only*, master yang salah menjadi peringatan, ada version history. Solusi sebenarnya: Google Workspace.
2. **Dua factory = dua file = dua kali update.** Kalau salah satu lupa diupdate, kedua factory beda versi. Cek menu Tentang setelah update.
3. **Sparepart hanya catatan pemakaian, bukan stok.** Tidak ada peringatan stok habis.
4. **Mengubah nama/model di katalog tidak mengubah riwayat** (data lama tetap seperti saat dicatat). Itu disengaja; konsekuensinya rekap bisa terpecah jika nama sering diganti.
5. **Bug Google multi-akun.** Browser/HP yang login beberapa akun Google mengirim panggilan aplikasi atas nama *akun utama* browser, bukan akun yang membuka halaman. Akibatnya: ditolak, atau (kalau kedua akun terdaftar) tercatat atas nama yang salah.
   Tidak bisa diperbaiki dari kode (selama aplikasi memakai *Execute as: User accessing* untuk mengenali teknisi). Aplikasi **mendeteksi** dan berhenti dengan petunjuk "Akun Google tidak cocok". Bisa dimatikan: `Config` → `CEK_AKUN` = `Tidak`.
   Solusi di sisi pengguna: Incognito (cepat), browser khusus kerja di HP + "Tambahkan ke layar utama", atau profil Chrome khusus kerja di PC. Jika Google sendiri menampilkan "Sorry, unable to open the file at this time", kode aplikasi belum sempat jalan; pakai solusi yang sama.
6. **Terjemahan mesin, bukan penerjemah manusia.** Istilah pabrik (nama part, singkatan line) bisa salah. Mitigasi: label pilihan/form/mesin memakai kolom 中文 yang diisi & dicek manusia; teks bebas lewat Google Translate dan bisa dikoreksi di sheet `Terjemahan`.
   Google membatasi jumlah terjemahan per hari (kuota *Translations* di developers.google.com/apps-script/guides/services/quotas). Jika habis, tombol 🌐 menampilkan teks asli tanpa error; cache & sheet `Terjemahan` membuat pemakaian kecil.
   Kamus UI 中文 (`src/I18n.html`) dibuat dengan bantuan AI: **minta teknisi China mengecek istilahnya** (koreksi cukup di file itu).
7. **Kamera di dalam app tidak dijamin** di semua HP. Ada cadangan (kamera HP / cari line).
8. **Performa**: jeda tetap ±1–2 detik per perjalanan ke server Apps Script tidak bisa dihilangkan. Tab `Maintenance` dibaca penuh per request → **arsipkan per tahun**.
9. **MTTR dimulai saat teknisi menekan Mulai.** Waktu dari mesin rusak sampai teknisi datang (respon) tidak tercatat, jadi MTTR & downtime lebih kecil dari downtime produksi sebenarnya. Kalau KPI pabrik memakai downtime dari laporan produksi, angkanya akan berbeda.
10. **MTBF sebagus jam operasinya.** `JAM_OPERASI_PER_HARI`, `HARI_OPERASI`, `TANGGAL_LIBUR` yang tidak sesuai jadwal produksi (mis. line yang berhenti 2 minggu) membuat MTBF terlalu tinggi. Line yang melayani dua project dihitung penuh di kedua project, jadi MTBF project lebih tinggi daripada MTBF Plant.
11. **Line = unit**: satu line fisik dengan beberapa mesin penting butuh beberapa baris `Lines` dan beberapa QR. Kalau tidak, dua teknisi tidak bisa mencatat dua mesin di line yang sama bersamaan.
12. **Download .xlsx butuh internet ke CDN** (jsdelivr / cdnjs) saat tombol ditekan; jaringan kantor yang memblokir CDN → otomatis CSV.
13. **Tutup bulan bergantung disiplin admin.** Bulan yang belum ditutup tetap dihitung ulang tiap malam; edit data lama mengubahnya.

---

## 8. Kecepatan

Waktu aksi di Apps Script ditentukan oleh **jumlah panggilan ke Google Sheets**. Hasil `npm run perf`:

| Aksi | 2.1 awal | 2.1.1 | 2.2.1 | 2.2.2 (laporan langsung) | 2.6.0 |
|---|---|---|---|---|---|
| Buka app / scan QR | 72–78 | 10 | 10 | **10** | **10** |
| Mulai | 112 | 12 | 12 | **16** | **16** |
| Selesai | 124 | 12 | 12 / 17 | **18** tanpa part · **23** dengan part | **23** dengan part |
| Pause / Resume | 109 / 74 | 11 | 11 | **15** | **15** |
| Refresh otomatis (60 dtk) | 55 | 10 | 10 | **10** | **10** |
| Dashboard (admin) | | | | 11 | **11** (+ kartu KPI) |
| Statistik / Download | | | | | **6–13** / **13** |

2.5.0 tidak menambah panggilan pada aksi teknisi (terjemahan hanya saat tombol 🌐 ditekan). Buka app dengan cache kosong +1 (sheet `Rencana`); admin +1 per refresh (jumlah saran baru).
Tombol 🌐 dengan 15 teks baru: **1 panggilan Google + 9 Sheets** (teks digabung per panggilan, hasil ditulis sekaligus); teks yang sama berikutnya: 0 (cache).
Ukuran halaman ±58 KB gzip (2.2.6: ±38 KB; kamus 中文 ±11 KB). Diukur di Chromium dengan CPU 4× lebih lambat: teknisi Indonesia tidak lebih lambat dari 2.2.6, tampilan 中文 ±0,1–0,2 detik lebih lama (render huruf Han).

Laporan langsung menambah 4 panggilan per aksi (Selesai/Cancel: 6, karena Rekap ikut dihitung) ≈ 0,3–0,6 detik lebih lama per tombol.
Itu harga "data langsung masuk laporan". Kalau di HP teknisi terasa terlalu lambat: `LAPORAN_LANGSUNG` = `Tidak` (kembali ke 12/17).

Master (termasuk katalog sparepart, format laporan, catatan panduan) di-cache di CacheService dan dihapus otomatis saat spreadsheet diedit.
BOM dihapus, jadi halaman line tidak lagi membawa daftar BOM.

---

## 9. Test & preview

```bash
npm test          # 85 test logika server (mock Sheets + jam palsu + Google Translate palsu)
npm run perf      # jumlah panggilan ke Sheets per aksi
npm run preview   # http://localhost:8787/?as=owner@gmail.com
                  # simulasi QR: &line=L01
```
User preview: `owner@gmail.com` (Admin), `budi@`, `andi@`, `sari@gmail.com` (Teknisi), `li@gmail.com` (Teknisi, bahasa 中文; terjemahan preview berupa `[zh-CN] teks`). Data: 2 factory, proses, line = unit (L01 & L01-W), katalog sparepart, target KPI, PIC tambahan.
**Tidak** diuji: hasil Google Translate asli & kuotanya, OAuth asli, trigger sungguhan, rumus FILTER di Sheets asli, kamera di HP sungguhan, email, tampilan tab Laporan di Google Sheets asli.
