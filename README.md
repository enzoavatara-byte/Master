# MTTR Maintenance 2.1

Pencatatan maintenance via scan QR. Google Apps Script + Google Sheets, mobile-first.
**MTTR = rata-rata waktu *aktif* pekerjaan Corrective** (Pause, Pending, dan Preventive dicatat terpisah). Semua waktu dicatat server (Asia/Jakarta).

**Prinsip utama 2.1: aplikasi diubah lewat Google Sheet, bukan lewat kode.** Factory, project baterai, line & sub-line, mesin, BOM,
isi dropdown, field form (label, wajib, urutan, field tambahan), dan batas waktu semuanya berupa sheet. Ubah sheet → request berikutnya langsung memakai data baru, tanpa deploy ulang.

```
scan QR line/mesin → (pilih mesin) → MULAI → Aktif ⇄ Pause
                                     Aktif/Pause → Pending → (lanjut, user mana pun, konfirmasi QR) → Aktif
                                     Aktif → Completed          (Corrective → masuk MTTR)
                                     Aktif/Pause → Cancelled    (alasan wajib → review Admin)
                                     > 3 jam tanpa konfirmasi → peringatan → tidak dijawab s/d 4 jam → Abandoned
```

Versi sebelumnya: 2.0 ada di riwayat git branch ini, v1 di branch `claude/google-app-script-web-app-waahwz`.

---

## 1. Yang baru di 2.1

| Permintaan | Implementasi |
|---|---|
| Editable tanpa coding | Sheet `Factory`, `Projects`, `Lines`, `Mesin`, `BOM`, `Pilihan`, `Form`, `Config` (§3) |
| Pilihan cepat + isian bebas | Setiap field pilihan bisa punya **"Lainnya"** → kolom isian (wajib diisi). Disimpan `Lainnya: <teks>` |
| Factory 1 = VF7 & Limo7, Factory 2 = E22H & E245 | Sheet `Projects`. Line di Factory 2 hanya menampilkan E22H/E245 |
| Line A & B di sebagian line | Tiap sub-line = baris sendiri di `Lines` + kolom `Grup` (mis. `L03`). Mesin/BOM bisa dipasang di Grup |
| Tracking per mesin | Sheet `Mesin`, mesin dipilih saat Mulai (atau **QR mesin** = langsung terpilih). **Kunci per mesin**: 2 teknisi bisa kerja di 2 mesin pada line yang sama |
| Preventive / Corrective | Dipilih saat Mulai (default Corrective). Preventive **tidak masuk MTTR** (`Config` → `MTTR_TIPE`) |
| BOM sparepart per line | Sheet `BOM`; tampil di halaman line; part BOM line itu muncul paling atas di form Selesai |
| Cari line jika QR tidak berfungsi | "Cari line" dengan filter factory/baterai + pencarian |
| Filter factory/baterai/line | Satu filter di Beranda, Pending, Review, Riwayat, Dashboard (tersimpan di HP) |
| Dashboard MTTR | MTTR Corrective, Corrective vs Preventive, tren 12 minggu, **mesin paling sering bermasalah**, line terbanyak, masalah, teknisi, isian "Lainnya" terbanyak, **status project** |
| Scan QR tanpa keluar web app | Tombol "SCAN QR" di Beranda (kamera di dalam app). Cadangan: aplikasi kamera HP / cari line |
| Rekap per tahun | Tab **`Rekap <tahun>`** (Jan–Des, per bulan + total), diperbarui tiap malam; arsip data per tahun lewat menu (§4b) |

Dari scan sampai timer jalan: **QR mesin = 1 tap** (Mulai), **QR line = 2 tap** (mesin → Mulai). Tipe dan baterai sudah terisi default.

---

## 2. Upgrade dari 2.0 (atau install baru)

**File di Apps Script** (nama sama dengan `src/`, tanpa ekstensi):

| Jenis | Nama | Status di 2.1 |
|---|---|---|
| Script | `Config` | **berubah** |
| Script | `Master` | **BARU**: buat file ini |
| Script | `Rekap` | **BARU**: buat file ini |
| Script | `Db` | **berubah** |
| Script | `Auth` | **berubah** |
| Script | `Maintenance` | **berubah** |
| Script | `Api` | **berubah** |
| Script | `Code` | **berubah** |
| HTML | `Index` | **berubah** |
| HTML | `App` | **berubah** |
| HTML | `Styles` | **berubah** |
| HTML | `Message` | tetap |
| JSON | `appsscript.json` | tetap |

Langkah:
1. Copy-paste semua file yang berubah + buat file script `Master` dan `Rekap`. Ctrl+S.
2. Jalankan **`setup`** lagi. Aman untuk data 2.0: kolom baru ditambah di kanan, data lama tidak dihapus, dan sheet baru dibuat beserta isi awalnya.
3. Isi sheet sesuai §3 (minimal: kolom `Factory ID` di `Lines`, dan `Mesin` jika ingin tracking per mesin).
4. **Deploy → Manage deployments → ✏️ → New version → Deploy.** Bukan "New deployment" (URL berubah, semua QR mati).
5. Cetak ulang QR **hanya jika** menambah QR mesin (Dashboard → tombol **QR**). QR line lama tetap berfungsi.

Install baru dari nol: sama seperti 2.0 (buat spreadsheet → Extensions → Apps Script → paste 11 file + `appsscript.json` → Run `setup` → Deploy web app *Execute as: User accessing*, *Anyone with Google account* → share spreadsheet sebagai Editor ke semua user).

---

## 3. Panduan edit sheet (apa yang diubah, di mana)

Aturan umum: **kolom `Aktif` boleh kosong = aktif** (kecuali di `Users`, wajib `Ya`). Matikan dengan `Tidak`; **jangan hapus baris**, karena riwayat masih merujuk ke baris itu.
Nama header kolom jangan diganti. Urutan kolom boleh diubah.

| Sheet | Untuk apa | Kolom & contoh |
|---|---|---|
| `Factory` | Daftar factory/gedung | `F1` · Factory 1 · Bogor |
| `Projects` | **Baterai per factory** + status project di dashboard | `F1` · `VF7` · Fase `Trial` · Target MTTR `45` · Catatan |
| `Lines` | Satu baris = satu QR | `L03-A` · Formation 1A · `F1` · Baterai (kosong = semua project F1; isi `VF7` untuk membatasi) · Grup `L03` · Area |
| `Mesin` | Daftar mesin per line | `M-CHG` · Charger · Line ID `L03` (Grup → ada di L03-A & L03-B) atau `L03-A` (hanya di A) |
| `BOM` | Sparepart per line | Line ID (`L01` / Grup `L03` / `*` = semua line) · Mesin ID (opsional) · Part Number · Nama Part · Qty · Satuan · Lokasi Simpan · Stok Minimum |
| `Pilihan` | Isi semua dropdown | Jenis · Nilai · Urutan. Jenis: `Tipe Maintenance`, `Masalah`, `Penyebab`, `Penanganan`, `Part`, `Alasan Pause`, `Yang Tertunda`, `Alasan Cancel`, atau jenis baru buatan sendiri |
| `Form` | Field form | Form · Field · Label · Tipe · Sumber · Wajib · Lainnya isi sendiri · Urutan · Aktif (detail di bawah) |
| `Config` | Aturan & batas | `WARN_HOURS` 3 · `ABANDON_HOURS` 4 · `EMAIL_PERINGATAN` Ya/Tidak · `SHIFT_MULAI` · `MTTR_TIPE` Corrective |
| `Users` | Akses | Email · Nama · Peran (`Teknisi`/`Admin`) · Aktif (`Ya`) |

### Sheet `Form`: mengubah form tanpa coding
- **Form**: `Mulai`, `Pause`, `Pending`, `Selesai`, `Cancel`.
- **Ganti label / urutan / wajib**: ubah kolom `Label`, `Urutan`, `Wajib`.
- **Nyalakan/matikan "Lainnya → isi sendiri"**: kolom `Lainnya isi sendiri` (`Ya`/`Tidak`). Tidak perlu menulis "Lainnya" di `Pilihan`; otomatis ditambahkan.
- **Tambah field baru** (mis. "Kondisi akhir mesin" di Selesai): tambah baris → Form `Selesai`, Field `Kondisi akhir`, Tipe `pilihan`, Sumber `Kondisi`, lalu isi Jenis `Kondisi` di `Pilihan`. Kolom dengan nama yang sama **dibuat otomatis** di `Maintenance`. Tipe: `pilihan` / `teks` / `angka`.
- **Field sistem** (`Tipe` = `sistem`, plus Yang tertunda, Tenggat, Part, Alasan cancel): label/urutan boleh diubah, tapi **tidak bisa dimatikan atau dihapus**. Kalau terhapus, app memakai default dan `setup` mengembalikan barisnya.
- Baris yang tidak valid (tipe tidak dikenal, nama field bentrok dengan kolom sistem, baterai tidak ada di `Projects`) **tidak membuat app error**: dilewati dan didaftar di **Dashboard → "Perlu dicek di Google Sheet"** (Admin).

### Field mana yang pilihan saja vs isian bebas (dan kenapa)
| Field | Bentuk |
|---|---|
| Masalah, Penyebab, Penanganan, Mesin, Part, Alasan Pause, Yang Tertunda, Alasan Cancel | pilihan + "Lainnya" → isian |
| Pekerjaan dilakukan (pending) | teks wajib |
| Catatan | teks opsional |
| Factory, Baterai, Line, Tipe, Tenggat, Qty | **pilihan saja**: ini kunci filter & dashboard; isian bebas = data tercecer |

Isian bebas murni (tanpa pilihan) membuat dashboard tidak berguna ("sensor eror" ≠ "sensor error"). Rutinitasnya: seminggu sekali buka **Dashboard → "Isian Lainnya terbanyak"**, lalu jadikan yang sering muncul sebagai pilihan tetap di `Pilihan`/`Mesin`.

---

## 4. Cara pakai teknisi

- **Mulai**: tap **SCAN QR** (atau kamera HP) → chip mesin (sudah terpilih jika pakai QR mesin) → **MULAI**. Mesin yang sedang dikerjakan tampil abu-abu beserta nama teknisinya.
- **Pause**: tap alasan → langsung tersimpan. "Lainnya" → ketik alasan → Pause.
- **Pending**: satu form. **Lanjutkan** dari tab Pending wajib scan QR di dalam app; lewat kamera HP, halaman line sudah menampilkan tombol Lanjutkan.
- **Selesai**: pilih Masalah/Penyebab/Penanganan; Part: "Tidak ada" atau pilih dari **BOM line** / part umum / "Lainnya".
- **QR tidak berfungsi**: Beranda → **Cari line**, filter factory/baterai, ketik nama.

---

## 4b. Rekap tahunan & arsip (Admin)

**Rekap** — tab `Rekap <tahun>` di spreadsheet, tahun kalender Jan–Des (WIB):

| Kolom | Arti |
|---|---|
| Pekerjaan selesai / Corrective / Preventive | Jumlah pekerjaan Completed, menurut **bulan selesai** |
| MTTR Corrective (menit) | Rata-rata waktu aktif pekerjaan *Masuk MTTR = Ya*. Baris Total = rata-rata setahun (tertimbang), **bukan** rata-rata 12 angka bulanan |
| Total waktu aktif / pause / pending (jam) | Dari pekerjaan Completed + Abandoned yang dihitung |
| Cancelled / Abandoned / Abandoned dihitung | Menurut bulan cancel/abandoned |

- Diperbarui **otomatis tiap malam ±01:00** (trigger `refreshRekap`; di bulan Januari tahun lalu juga ikut diperbarui).
- Manual: spreadsheet → menu **MTTR 2.1 → Rekap tahunan (buat / perbarui)…** → isi tahun.
- Untuk mentor: klik kanan tab `Rekap 2026` → **Copy to → New spreadsheet** → buka → **File → Download → Microsoft Excel (.xlsx)**. (File → Download langsung dari spreadsheet utama ikut membawa semua tab.)
- Nilainya statis (bukan rumus), jadi tetap benar setelah data diarsipkan.
- Dashboard → periode **"Tahun ini"** menampilkan angka yang sama secara langsung.

**Arsip** — awal tahun (Februari), Dashboard Admin mengingatkan jika data tahun lalu belum diarsipkan:
1. Spreadsheet → menu **MTTR 2.1 → Arsipkan data tahun lalu…** → tahun (default tahun lalu) → konfirmasi.
2. Urutannya aman: rekap tahun itu dibuat ulang → pekerjaan final + Log-nya **disalin** ke tab `Arsip <tahun>` & `Arsip Log <tahun>` → diverifikasi → baru dihapus dari `Maintenance`/`Log`. Jika verifikasi gagal, tidak ada yang dihapus. Aman dijalankan ulang (tidak dobel).
3. **Tidak dipindah**: pekerjaan Aktif/Pause/Pending dan yang masih *Perlu review* — tetap di tab aktif dan bisa dilanjutkan di tahun baru.
4. Setelah diarsipkan, pekerjaan itu tidak tampil lagi di Riwayat/Detail aplikasi (data tetap ada di tab arsip).
5. Arsip sengaja di tab spreadsheet yang sama, bukan file terpisah: membuat file baru butuh izin akses ke *semua* spreadsheet setiap teknisi. Kalau ingin file terpisah, admin bisa klik kanan tab arsip → Copy to → New spreadsheet.

---

## 5. Keputusan admin yang masih berjalan (default saat ini)

| Pertanyaan | Default | Diubah di |
|---|---|---|
| Preventive masuk MTTR? | Tidak | `Config` → `MTTR_TIPE` (mis. `Corrective,Preventive`) |
| Mesin wajib dipilih saat Mulai? | Ya, jika line punya mesin di `Mesin` | `Form` → Mulai · Mesin ID · Wajib |
| Mesin di Grup dipakai bersama sub-line? | **Tidak**: tiap sub-line punya unit mesin itu sendiri (kunci per sub-line) | Jika fisiknya satu mesin bersama, daftarkan di satu sub-line saja |
| Bogor & Cikarang | Satu spreadsheet, dipisah `Factory` | (lihat §6 #2) |
| Abandoned | Admin memilih: hitung (menit dikoreksi) atau keluarkan | Tab Review |

---

## 6. Risiko nyata

1. **Teknisi tetap butuh akses Editor ke spreadsheet** (akun Gmail personal). Karena sekarang admin mengedit banyak sheet master, risiko salah edit naik. Mitigasi: `Maintenance` & `Log` diproteksi *warning-only*, master yang tidak valid menjadi peringatan (bukan error), dan Google Sheets punya version history. Solusi sebenarnya: Google Workspace.
2. **Akun Google terpisah untuk Bogor & Cikarang = data terpisah**, sehingga dashboard tidak bisa membandingkan factory. Disarankan satu spreadsheet + kolom `Factory`. Jika harus dipisah, kodenya sama, tinggal di-deploy dua kali.
3. **Kamera di dalam app tidak dijamin** (iframe Apps Script bisa memblokir). Ada cadangan, tapi **uji di HP teknisi asli** sebelum menjanjikan "scan tanpa keluar app".
4. **Stok Minimum di BOM hanya angka referensi.** Tanpa pencatatan stok masuk/keluar, angka itu tidak akan pernah memberi peringatan. Tracking stok = proyek terpisah.
5. **Performa** (lihat §6b): Apps Script punya jeda tetap ±1–2 detik per perjalanan ke server yang tidak bisa dihilangkan. Yang bisa dikendalikan sudah dipangkas: sheet master di-cache, data awal ikut halaman, aksi tidak membaca ulang data. Tab `Maintenance` tetap dibaca penuh per request, jadi **arsipkan per tahun** (§4b).

---

## 6b. Kecepatan

Waktu sebuah aksi di Apps Script ditentukan oleh **jumlah panggilan ke Google Sheets**, bukan jumlah data. Hasil `npm run perf` (panggilan per aksi):

| Aksi | 2.1 awal | 2.1.1 |
|---|---|---|
| Buka app / scan QR | 72–78 (2 perjalanan) | **10** (1 perjalanan) |
| Mulai / Selesai | 112 / 124 | **12** |
| Pause / Resume | 109 / 74 | **11** |
| Refresh otomatis (60 dtk) | 55 | **10** |

Caranya:
- **Cache master** (Users, Factory, Projects, Lines, Mesin, BOM, Pilihan, Form, Config) di CacheService, dipakai bersama semua user. Dihapus otomatis saat ada yang **mengedit spreadsheet** (trigger `onEdit` + `onMasterChange`), jadi perubahan sheet tetap langsung terlihat. Pengaman: kedaluwarsa sendiri setelah 10 menit. Menu **MTTR 2.1 → Muat ulang data master** untuk memaksa.
- **Data awal ditanam di halaman** saat dibuka (tidak menunggu perjalanan kedua).
- **Aksi tidak membaca ulang** data setelah menulis; tampilan dihitung dari data yang sudah di memori.
- Font tidak diambil dari Google Fonts; library QR hanya dimuat di halaman QR.

Yang **tidak** bisa dipercepat di Apps Script: jeda tetap per perjalanan ke server (±1–2 detik, lebih lama saat "cold start" setelah lama tidak dipakai). Jika target "instan seperti aplikasi HP", itu butuh backend lain — bukan Apps Script.

---

## 7. Test & preview

```bash
npm test          # 45 test logika server (mock Sheets + jam palsu)
npm run perf      # jumlah panggilan ke Sheets per aksi
npm run preview   # http://localhost:8787/?as=owner@gmail.com
                  # simulasi QR: &line=L01   QR mesin: &line=L11&mesin=M-E1
```
User preview: `owner@gmail.com` (Admin), `budi@`, `andi@`, `sari@gmail.com` (Teknisi). Data: 2 factory, line L03 dengan sub-line A/B, mesin, BOM.
**Tidak** diuji: OAuth asli, trigger sungguhan, rumus FILTER di Sheets asli, kamera di HP sungguhan, email.
