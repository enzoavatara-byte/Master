# MTTR Maintenance 2.0

Pencatatan maintenance line via scan QR. Google Apps Script + Google Sheets, mobile-first.
**MTTR hanya dihitung dari waktu kerja Aktif.** Waktu Pause dan Pending dicatat terpisah. Semua waktu dicatat oleh server (Asia/Jakarta).

```
scan QR → Aktif ⇄ Pause
          Aktif/Pause → Pending → (lanjut, user mana pun, konfirmasi QR) → Aktif
          Aktif → Completed          (masuk MTTR)
          Aktif/Pause → Cancelled    (alasan wajib → review Admin)
          > 3 jam tanpa konfirmasi → peringatan (banner + email) → tidak dijawab s/d 4 jam → Abandoned (review Admin)
```

Versi 1 (trial `IN_PROGRESS → COMPLETED`) masih ada di branch `claude/google-app-script-web-app-waahwz`.
2.0 **bukan upgrade in-place**: skema sheet berbeda. Pakai spreadsheet baru.

---

## 1. Apa yang baru dibanding v1

| v1 | 2.0 |
|---|---|
| Durasi = Selesai − Mulai | Tiga timer terpisah: aktif, pause, pending. MTTR = rata-rata **waktu aktif** |
| Tidak ada Pause / Pending | Pause (alasan 1 tap), Pending (satu form), lanjut Pending oleh teknisi lain dengan ID yang sama |
| Form teks bebas | Dropdown Masalah / Penyebab / Penanganan / Part + jumlah, dari sheet `Pilihan` |
| ABANDONED setelah 8 jam, tanpa peringatan | Peringatan 3 jam ke teknisi (banner + email), Abandoned 4 jam jika tidak dijawab |
| Tanpa log | Tab `Log` append-only: setiap kejadian tercatat, semua durasi bisa diaudit ulang |
| ID acak `MT-20260930-...` | ID terbaca: `L03-260930-02` (line + tanggal + urut) |
| 4 tab, tampilan polos | Beranda dengan grafik 7 hari + MTTR + aktivitas terbaru, tab Pending gaya kartu, bottom sheet untuk form |
| Tab turunan tidak ada | `Maintenance E22H`, `Maintenance E245`, `Pending Work` otomatis via rumus FILTER |

Tap dari scan QR sampai timer jalan: **1 tap** (baterai sudah terpilih = baterai terakhir di line itu).

---

## 2. Struktur

| File | Isi |
|---|---|
| `src/Config.js` | Nama sheet, header, status, peran, isi awal dropdown, config default |
| `src/Db.js` | Helper baca/tulis sheet berdasarkan header, lock, format |
| `src/Auth.js` | Cocokkan email login ke sheet `Users` |
| `src/Maintenance.js` | State machine (start, pause, resume, pending, lanjut, complete, cancel) + trigger `checkTimeouts` |
| `src/Api.js` | Dashboard, halaman line, pending, riwayat, review, QR |
| `src/Code.js` | `doGet`, `setup()`, rumus tab turunan, menu spreadsheet |
| `src/Index.html`, `App.html`, `Styles.html` | UI satu halaman, 5 tab |
| `src/Message.html` | Halaman Access Denied / error |
| `test/run.js` | 22 test logika server dengan mock Sheets + jam palsu |
| `test/preview.js` | Preview UI lokal tanpa Google, dengan data contoh |

### Sheet

| Tab | Diisi oleh | Kolom |
|---|---|---|
| `Log` | Kode, **tambah baris saja** | Timestamp, Maintenance ID, Kejadian, User, Detail |
| `Maintenance` | Kode, satu baris per ID (dicari berdasarkan ID, bukan nomor baris) | Kolom spec + tambahan (lihat §7) |
| `Maintenance E22H` / `E245` | Rumus FILTER (satu tab per baterai di `Pilihan`) | Sama dengan Maintenance |
| `Pending Work` | Rumus FILTER status = Pending | ID, Line, Baterai, Yang tertunda, Tenggat, Teknisi terakhir, Lama pending (jam) |
| `Users` | Admin | Email, Nama, Peran (`Teknisi` / `Admin`), Aktif (`Ya` / `Tidak`) |
| `Lines` | Admin | Line ID, Nama Line, Area, Aktif |
| `Pilihan` | Admin | Jenis, Nilai, Aktif. Jenis: Baterai, Masalah, Penyebab, Penanganan, Part, Alasan Pause, Yang Tertunda, Alasan Cancel |
| `Config` | Admin | WARN_HOURS (3), ABANDON_HOURS (4), EMAIL_PERINGATAN (Ya/Tidak), SHIFT_MULAI (07:00,15:00,23:00) |

Kolom dibaca berdasarkan **nama header**. Boleh geser kolom, jangan ganti nama header. Jika kolom `Maintenance` digeser, jalankan `setup()` lagi supaya rumus tab turunan ikut.

### Hak akses

| Aksi | Teknisi | Admin |
|---|---|---|
| Mulai, pause, resume, pending, selesai pekerjaan sendiri | ✓ | ✓ |
| Lanjutkan pending siapa pun (dengan scan QR) | ✓ | ✓ |
| Cancel pekerjaan sendiri | ✓ | ✓ |
| Cancel pekerjaan orang lain | – | ✓ |
| Review | lihat item miliknya, tandai Pending "sudah dicek" | semua; putuskan Cancelled & Abandoned |
| Riwayat | pekerjaan yang pernah diikuti | + semua teknisi, link ke Sheet |
| QR Line | – | ✓ |

Aturan keras (dijaga server + LockService): satu teknisi hanya punya satu pekerjaan Aktif/Pause; satu line hanya punya satu pekerjaan Aktif/Pause.

---

## 3. Setup (±15 menit)

1. Buat **Google Spreadsheet baru** (mis. `MTTR 2.0 DB`).
2. **Extensions → Apps Script**. Hapus isi `Code.gs`.
3. Buat file sesuai `src/` (nama sama, tanpa ekstensi): Script `Config`, `Db`, `Auth`, `Maintenance`, `Api`, `Code`; HTML `Index`, `App`, `Styles`, `Message`. Copy-paste isinya.
4. **Project Settings → centang "Show appsscript.json"**, ganti isinya dengan `src/appsscript.json`.
5. Pilih fungsi `setup` → **Run** → izinkan akses. Ini membuat semua tab, rumus FILTER, isi dropdown awal, mendaftarkan Anda sebagai **Admin**, dan memasang trigger `checkTimeouts` (tiap 15 menit). Aman dijalankan ulang.
6. Isi `Users`, `Lines`, dan **ganti isi `Pilihan` Masalah/Penyebab/Penanganan/Part** (isi awal hanya contoh).
7. **Deploy → New deployment → Web app**: Execute as **User accessing the web app**, Who has access **Anyone with Google account**. Salin URL `/exec`.
8. **Share spreadsheet** ke setiap email di `Users` sebagai **Editor** (wajib, lihat §6).
9. Buka URL `/exec` → tab **QR Line** → **Cetak**, tempel di line.

Alternatif clasp: `cp .clasp.json.example .clasp.json` (isi scriptId), `clasp push && clasp deploy`.

**Update kode:** Deploy → Manage deployments → edit → Version: New version. **Jangan** "New deployment": URL berubah dan semua QR yang tertempel mati.

---

## 4. Alur pakai

- **Mulai**: scan QR → halaman line → (baterai sudah terpilih) **MULAI MAINTENANCE**.
- **Pause**: Pause → tap alasan (langsung tersimpan) → tombol besar **RESUME**.
- **Pending**: satu form (sudah dikerjakan, yang tertunda, tenggat, catatan). Muncul di tab Pending semua user & di halaman line saat QR di-scan.
- **Lanjutkan pending**: scan QR line → kartu pending → **Lanjutkan** (tanpa scan ulang). Dari tab Pending: Lanjutkan → scan QR di dalam app. Jika kamera tidak bisa dibuka di dalam app, app meminta scan dengan kamera HP (hasilnya sama).
- **Selesai**: Masalah, Penyebab, Penanganan, Part (Tidak ada / pilih + jumlah), catatan. Pilih "Lainnya" → catatan wajib.
- **Cancel**: alasan wajib → masuk review Admin, tidak masuk MTTR.
- **Peringatan 3 jam**: banner di app + email → **Masih lanjut** (timer tidak direset), Pending, atau Cancel.

---

## 5. Keputusan terbuka di spec → default yang dipakai

Semua bisa diubah; ini dipilih supaya aplikasi bisa jalan sekarang, bukan karena pasti benar.

| Pertanyaan di spec | Default di 2.0 | Cara ubah |
|---|---|---|
| Review Pending: apa yang direview? | Admin atau teknisi terkait menandai "sudah dicek" (+catatan). Status pending tidak berubah | `apiReview` di `Api.js` |
| Siapa menetapkan tenggat, apa jika lewat? | Teknisi yang mem-pending. Lewat tenggat = merah & paling atas di tab Pending. Tidak ada eskalasi otomatis | – |
| Abandoned: dikoreksi atau dikeluarkan? | Admin memilih per kasus: **Hitung** (isi menit aktif sebenarnya) atau **Keluarkan**. Catatan wajib | – |
| Isi dropdown | Contoh generik di `Pilihan`. **Wajib diganti** bersama teknisi senior sebelum dipakai | Edit sheet `Pilihan` |
| Email peringatan boleh? | Ya, bisa dimatikan | `Config` → `EMAIL_PERINGATAN` = `Tidak` |

---

## 6. Risiko nyata (baca sebelum go-live)

1. **Teknisi harus punya akses Editor ke spreadsheet** (akun Gmail personal memaksa "Execute as: User accessing"). Artinya mereka *bisa* mengedit sheet langsung dan melewati validasi. Mitigasi di 2.0: tab `Maintenance` dan `Log` diproteksi *warning-only*, dan `Log` memungkinkan audit. Solusi sebenarnya: **Google Workspace** (deploy "Execute as: Me", sheet tidak perlu di-share).
2. **Kamera di dalam Apps Script web app tidak dijamin jalan** (iframe Google bisa memblokir izin kamera). Fallback-nya sudah ada (scan pakai kamera HP), tapi **uji di HP teknisi yang sebenarnya** sebelum memutuskan alur konfirmasi QR.
3. **Konfirmasi QR mencegah kelalaian, bukan kecurangan.** Isi QR hanya URL `?line=L03`. Orang yang niat bisa mengetik URL itu. Kalau ini masalah, yang dibutuhkan adalah QR bertoken yang dirotasi, bukan fitur UI.
4. **Pause/resume dihitung sebagai "konfirmasi masih bekerja"** untuk timer 3 jam (lihat §7). Jika teknisi pause lalu pulang, peringatan baru muncul 3 jam setelah pause itu.
5. **Kuota Gmail personal**: ±100 email/hari dan 90 menit runtime trigger/hari. Trigger 15 menit = 96 run/hari (<1 detik per run). Aman di volume normal.
6. **Performa**: setiap aksi membaca seluruh `Maintenance`. Nyaman sampai beberapa ribu baris; di atas ~10.000 perlu arsip per tahun. `Log` hanya dibaca penuh saat membuka Detail.

---

## 7. Deviasi dari spec (sengaja)

| Spec | Implementasi | Alasan |
|---|---|---|
| Satu tab `Master` untuk user, line, dropdown | Tiga tab: `Users`, `Lines`, `Pilihan` (+ `Config`) | Tiga tabel dengan header berbeda di satu tab tidak bisa dibaca berdasarkan header. Rentan rusak saat admin menambah baris |
| Kolom Maintenance sesuai spec | + `Masuk MTTR`, `Status sejak`, `Konfirmasi terakhir`, `Peringatan pada`, `Teknisi terlibat`, `Pekerjaan dilakukan`, `Catatan`, `Direview oleh/pada`, `Catatan review` | `Status sejak` = dasar akumulasi timer. `Masuk MTTR` membuat rumus MTTR di sheet trivial (`AVERAGEIF`) dan memisahkan Abandoned yang dikoreksi manusia |
| 3 jam "sejak mulai atau konfirmasi terakhir" | Pause & resume juga dihitung konfirmasi | Teknisi yang baru menekan tombol jelas masih ada. Tanpa ini, orang yang pause 2j50m lalu resume langsung kena peringatan |
| Abandoned setelah 4 jam | Abandoned setelah 4 jam **dan** minimal 1 jam sejak peringatan | Jika trigger telat / script mati, teknisi tidak boleh langsung Abandoned tanpa sempat diperingatkan |
| Selesai dari Aktif | Dari Pause harus Resume dulu | Sesuai flowchart. Selesai saat Pause akan membuat waktu terakhir ambigu |
| Peringatan tampil di Review admin "dengan pilihan" | Admin melihat daftar peringatan (read-only). Jawaban tetap dari teknisi | Admin tidak tahu apakah pekerjaan masih berjalan. Yang tahu teknisi (alasan yang sama dengan spec) |

---

## 8. Test & preview

```bash
npm test          # 22 test logika server (mock Sheets + jam palsu)
npm run preview   # http://localhost:8787/?as=owner@gmail.com  (tambah &line=L01 untuk simulasi scan QR)
```
User contoh di preview: `owner@gmail.com` (Admin), `budi@`, `andi@`, `sari@gmail.com` (Teknisi).

**Tidak** diuji: izin OAuth asli, trigger sungguhan, rumus FILTER di Sheets asli, kamera di HP sungguhan, email. Itu harus diuji manual pada hari pertama trial.
