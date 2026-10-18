# MTTR Maintenance 2.2

Pencatatan maintenance via scan QR. Google Apps Script + Google Sheets, mobile-first.
**MTTR = rata-rata waktu *aktif* pekerjaan Corrective** (Pause, Pending, dan Preventive dicatat terpisah). Semua waktu dicatat server (Asia/Jakarta).

**Prinsip utama: aplikasi diubah lewat Google Sheet, bukan lewat kode.** Factory, project baterai, line (proses, alias), mesin, katalog sparepart,
isi pilihan, field form, format laporan, catatan panduan, dan batas waktu semuanya berupa sheet. Ubah sheet → request berikutnya langsung memakai data baru, tanpa deploy ulang.

```
scan QR line/mesin → (pilih mesin, tipe, stop line) → MULAI → Aktif ⇄ Pause
                                     Aktif/Pause → Pending → (lanjut, user mana pun, konfirmasi QR) → Aktif
                                     Aktif → Completed          (jenis kerusakan, masalah, penyebab, penanganan, sparepart)
                                     Aktif/Pause → Cancelled    (alasan wajib → review Admin)
                                     > 3 jam tanpa konfirmasi → peringatan → tidak dijawab s/d 4 jam → Abandoned
```

Riwayat versi: [CHANGELOG.md](CHANGELOG.md). Panduan singkat untuk teknisi & admin juga ada **di dalam aplikasi** (tombol **?**).

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

## 2. Upgrade dari 2.1 / 2.1.1

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

Install baru dari nol: buat spreadsheet → Extensions → Apps Script → paste 12 file + `appsscript.json` → Run `setup` → Deploy web app *Execute as: User accessing*, *Anyone with Google account* → share spreadsheet sebagai Editor ke semua user.

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
3. Isi `Users`, `Factory`, `Projects`, `Lines`, `Mesin`, `Sparepart` factory 2. `Config` → `NAMA_APLIKASI` = mis. "MTTR Factory 2".
4. Extensions → Apps Script → Run **`setup`** → **Deploy → New deployment** (salinan butuh URL sendiri) → cetak QR dari Dashboard → QR.
5. Setiap update kode: paste ke **kedua** file + New version di keduanya. Cek versi lewat menu spreadsheet → **Tentang**.

Sengaja tidak ada tombol "hapus semua data": terlalu berbahaya jika terpencet di file utama.
Rekap gabungan dua factory (opsional): file ketiga dengan `IMPORTRANGE` ke tab `Laporan <tahun>` kedua file.

---

## 4. Panduan edit sheet (apa yang diubah, di mana)

Aturan umum: **kolom `Aktif` boleh kosong = aktif** (kecuali di `Users`, wajib `Ya`). Matikan dengan `Tidak`; **jangan hapus baris**, karena riwayat masih merujuk ke baris itu.
Nama header kolom jangan diganti. Urutan kolom boleh diubah.

| Sheet | Untuk apa | Kolom & contoh |
|---|---|---|
| `Users` | Akses + **nama yang tampil di laporan** | Email · Nama · Peran (`Teknisi`/`Admin`) · Aktif (`Ya`) |
| `Factory` | Daftar factory/gedung | `F1` · Factory 1 · Bogor |
| `Projects` | Baterai per factory + status project | `F1` · `VF7` · Fase `Trial` · Target MTTR `45` · Catatan |
| `Lines` | Satu baris = satu QR | `L03-A` · Formation 1A · **Alias** `F1A, Formasi satu` · **Proses** `Formation` · `F1` · Baterai · Grup `L03` · Area |
| `Mesin` | Mesin per line (= Station di laporan) | `M-CHG` · Charger · Line ID `L03` (grup) atau `L03-A` |
| `Sparepart` | Katalog | Jenis Sparepart `Mekanikal` · Nama `Bearing` · Model `6205-2RS` (boleh kosong) · Satuan · Urutan · Aktif |
| `Pemakaian Sparepart` | Ditulis aplikasi (jangan diedit) | 1 baris per part dipakai. Bisa dibuat pivot/filter |
| `Pilihan` | Isi semua pilihan | Jenis · Nilai · Urutan. Jenis: `Jenis Kerusakan`, `Tipe Maintenance`, `Masalah`, `Penyebab`, `Penanganan`, `Alasan Pause`, `Yang Tertunda`, `Alasan Cancel`, atau jenis baru |
| `Form` | Field form | Form · Field · Label · Tipe · Sumber · Wajib · Lainnya isi sendiri · Urutan · Aktif |
| `Format Laporan` | Kolom tab Laporan | Kolom (judul bebas) · Sumber (lihat di bawah) · Urutan · Aktif |
| `Catatan Panduan` | Catatan lokal di halaman Panduan | Untuk (`Teknisi`/`Admin`/`Semua`) · Judul · Isi · Urutan · Aktif |
| `Config` | Aturan | `WARN_HOURS` 3 · `ABANDON_HOURS` 4 · `EMAIL_PERINGATAN` · `SHIFT_MULAI` · `MTTR_TIPE` · `NAMA_APLIKASI` · `LAPORAN_JUDUL` · `STOP_LINE_DEFAULT` Corrective · `LAPORAN_LANGSUNG` Ya |

**Jenis sparepart = nilai Jenis Kerusakan** (Elektrikal/Mekanikal/Pneumatik/Program). Kalau berbeda, Dashboard memberi peringatan karena filter otomatis tidak akan cocok.

**Sumber di `Format Laporan`**: `NO`, `Factory`, `Nama factory`, `Project`, `Proses`, `Line`, `Station`, `Tanggal`, `Jam mulai`, `Jam selesai`, `Stop line (1/0)`,
`Durasi stop line`, `Waktu aktif (menit)`, `Jenis kerusakan`, `Masalah + detail`, `Penyebab + detail`, `Penanganan + detail`, `Jenis sparepart`, `Nama sparepart`,
`Model sparepart`, `Jumlah sparepart`, `Catatan`, `Kondisi perbaikan`, `PIC`, `Tipe maintenance`, `Maintenance ID`, atau **nama kolom mana pun di `Maintenance`**.

### Sheet `Form`: mengubah form tanpa coding
- **Ganti label / urutan / wajib**: kolom `Label`, `Urutan`, `Wajib`. (Mis. label Masalah = "Fenomena / masalah" seperti Excel.)
- **Matikan pertanyaan**: `Aktif` = `Tidak` (mis. Mulai · Stop line). Jangan hapus barisnya: `setup` akan menambahkannya lagi.
- **"Lainnya → isi sendiri"**: kolom `Lainnya isi sendiri` (`Ya`/`Tidak`).
- **Tambah field baru**: tambah baris (Tipe `pilihan`/`teks`/`angka`). Kolom dengan nama yang sama dibuat otomatis di `Maintenance`.
- **Field sistem** (Mesin, Tipe, Baterai, Yang tertunda, Tenggat, Part, Alasan cancel): label/urutan boleh diubah, tidak bisa dimatikan.
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

- **Mulai**: **SCAN QR** → mesin → tipe → **stop line** (otomatis Ya untuk Corrective) → **MULAI**.
- **Pause / Pending / Cancel**: seperti 2.1.
- **Selesai**: Jenis kerusakan → Masalah (+ detail) → Penyebab (+ detail) → Penanganan (+ detail) → Sparepart:
  - **Tidak ada pergantian**, atau
  - **Ada part** → ketik di kotak cari (mis. `6205`) *atau* pilih Jenis → Nama → Model → atur jumlah −/+ → ulangi untuk part lain;
  - tidak ada di katalog → **Tambah manual** (jenis, nama, model, jumlah).
- **QR tidak berfungsi**: Beranda → **Cari line** (bisa ketik alias atau proses).
- Lupa caranya: tombol **?** di Beranda.

---

## 6. Laporan, rekap & arsip (Admin)

- **`Laporan <tahun>`** = format Excel. Satu baris per pekerjaan yang *dimulai* di tahun itu (Cancelled tidak ikut; Pending/Abandoned ikut dengan Kondisi masing-masing).
  Kolom sparepart: satu part per baris dalam sel, urutannya sejajar antar-kolom (Jenis / Nama / Model / Jumlah).
- **`Rekap <tahun>`** = ringkasan per bulan (seperti 2.1).
- Keduanya **diperbarui langsung setiap aksi** (Mulai, Pause, Resume, Pending, Lanjut, Selesai, Cancel, review, Abandoned): hanya baris pekerjaan itu yang ditulis di Laporan, dan angka Rekap dihitung ulang dari data yang sudah di memori.
  Cancel → barisnya dihapus dan NO diurutkan ulang. Matikan dengan `Config` → `LAPORAN_LANGSUNG` = `Tidak` jika tombol terasa terlalu lambat.
- **Bangun ulang penuh** tiap malam ±01:00, lewat Dashboard → **Perbarui Laporan & Rekap**, atau menu spreadsheet → **Laporan & Rekap tahunan**. Perlu setelah admin **mengedit sheet `Maintenance` secara manual** (edit manual tidak memicu sinkron). Mengubah `Format Laporan` otomatis memicu bangun ulang di aksi berikutnya.
- Kolom terakhir tab Laporan (tersembunyi, "ID sistem …") adalah kunci baris untuk sinkron. Jangan dihapus; kalau terhapus, aksi berikutnya membangun ulang tab.
- Jangan edit tab Laporan/Rekap (ditulis ulang). Perbaiki datanya di `Maintenance`.
- Untuk dikirim: klik kanan tab → **Copy to → New spreadsheet** → File → Download → Microsoft Excel.
- **Arsip** (awal tahun, menu → Arsipkan data tahun lalu): pekerjaan final + Log + **pemakaian sparepart** pindah ke `Arsip <tahun>`, `Arsip Log <tahun>`, `Arsip Sparepart <tahun>`.
  Laporan tahun itu tetap utuh karena ikut membaca tab arsip.

---

## 7. Risiko nyata

1. **Teknisi tetap butuh akses Editor ke spreadsheet.** Makin banyak sheet master, makin besar risiko salah edit. Mitigasi: `Maintenance`, `Log`, `Pemakaian Sparepart` diproteksi *warning-only*, master yang salah menjadi peringatan, ada version history. Solusi sebenarnya: Google Workspace.
2. **Dua factory = dua file = dua kali update.** Kalau salah satu lupa diupdate, kedua factory beda versi. Cek menu Tentang setelah update.
3. **Sparepart hanya catatan pemakaian, bukan stok.** Tidak ada peringatan stok habis.
4. **Mengubah nama/model di katalog tidak mengubah riwayat** (data lama tetap seperti saat dicatat). Itu disengaja; konsekuensinya rekap bisa terpecah jika nama sering diganti.
5. **Kamera di dalam app tidak dijamin** di semua HP. Ada cadangan (kamera HP / cari line).
6. **Performa**: jeda tetap ±1–2 detik per perjalanan ke server Apps Script tidak bisa dihilangkan. Tab `Maintenance` dibaca penuh per request → **arsipkan per tahun**.

---

## 8. Kecepatan

Waktu aksi di Apps Script ditentukan oleh **jumlah panggilan ke Google Sheets**. Hasil `npm run perf`:

| Aksi | 2.1 awal | 2.1.1 | 2.2.1 | 2.2.2 (laporan langsung) |
|---|---|---|---|---|
| Buka app / scan QR | 72–78 | 10 | 10 | **10** |
| Mulai | 112 | 12 | 12 | **16** |
| Selesai | 124 | 12 | 12 / 17 | **18** tanpa part · **23** dengan part |
| Pause / Resume | 109 / 74 | 11 | 11 | **15** |
| Refresh otomatis (60 dtk) | 55 | 10 | 10 | **10** |

Laporan langsung menambah 4 panggilan per aksi (Selesai/Cancel: 6, karena Rekap ikut dihitung) ≈ 0,3–0,6 detik lebih lama per tombol.
Itu harga "data langsung masuk laporan". Kalau di HP teknisi terasa terlalu lambat: `LAPORAN_LANGSUNG` = `Tidak` (kembali ke 12/17).

Master (termasuk katalog sparepart, format laporan, catatan panduan) di-cache di CacheService dan dihapus otomatis saat spreadsheet diedit.
BOM dihapus, jadi halaman line tidak lagi membawa daftar BOM.

---

## 9. Test & preview

```bash
npm test          # 58 test logika server (mock Sheets + jam palsu)
npm run perf      # jumlah panggilan ke Sheets per aksi
npm run preview   # http://localhost:8787/?as=owner@gmail.com
                  # simulasi QR: &line=L01   QR mesin: &line=L11&mesin=M-E1
```
User preview: `owner@gmail.com` (Admin), `budi@`, `andi@`, `sari@gmail.com` (Teknisi). Data: 2 factory, proses, alias, sub-line A/B, mesin, katalog sparepart.
**Tidak** diuji: OAuth asli, trigger sungguhan, rumus FILTER di Sheets asli, kamera di HP sungguhan, email, tampilan tab Laporan di Google Sheets asli.
