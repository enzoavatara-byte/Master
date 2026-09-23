# Web App MTTR (Trial)

Pencatatan maintenance via QR scan. Google Apps Script + Google Sheets, mobile-first.
Durasi = Finish − Start, dengan kedua timestamp dibuat di **server** (Asia/Jakarta).

```
SCAN QR → IN_PROGRESS → COMPLETE → COMPLETED (Testing OK / NG)
                 ↓
            CANCELLED / ABANDONED (> 8 jam, otomatis → antrian review)
```

---

## 1. Struktur

| File | Isi |
|---|---|
| `src/appsscript.json` | Manifest: timezone, scope OAuth, setting web app |
| `src/Config.js` | Nama sheet, header, status, role, default config |
| `src/Db.js` | Helper baca/tulis sheet, lock, format tanggal |
| `src/Auth.js` | Cocokkan email login ke sheet `Users` |
| `src/Maintenance.js` | State machine + semua fungsi `api*` yang dipanggil UI |
| `src/Code.js` | `doGet`, `setup()`, trigger `markAbandoned()`, menu spreadsheet |
| `src/Index.html`, `App.html`, `Styles.html` | UI (satu halaman, 4 tab) |
| `src/Message.html` | Halaman Access Denied / error |
| `test/run.js` | Test logika server dengan mock (tanpa Google) |

### Sheet

| Sheet | Kolom |
|---|---|
| `Users` | Email, Name, Role (`ME` / `Supervisor` / `Admin`), Department, Status (`Active` / lainnya) |
| `Lines` | Line ID, Line Name, Machine, Department, Location, Status |
| `Maintenance` | Maintenance ID, Line ID, User Email, Start Time, Finish Time, Status, Problem, Action Taken, Part Replaced, Testing Result, Duration (min), **Closed By, Note, Reviewed By, Reviewed At** |
| `Config` | Key, Value, Description (`ABANDON_HOURS` = 8) |

Kolom dibaca berdasarkan **nama header**, bukan posisi. Boleh geser kolom, jangan ganti nama header.

### Hak akses

| Aksi | ME | Supervisor | Admin |
|---|---|---|---|
| Start maintenance | ✓ | ✓ | ✓ |
| Complete / Cancel milik sendiri | ✓ | ✓ | ✓ |
| Complete / Cancel milik orang lain | – | ✓ | ✓ |
| Riwayat | milik sendiri | semua | semua |
| Review ABANDONED | – | ✓ | ✓ |
| Halaman QR | – | – | ✓ |

---

## 2. Setup pertama kali (±15 menit)

1. Buat Google Spreadsheet baru (nama bebas, mis. `MTTR Trial DB`).
2. **Extensions → Apps Script**. Hapus isi `Code.gs` bawaan.
3. Buat file sesuai folder `src/` (nama sama, tanpa ekstensi `.js` → Apps Script jadikan `.gs`):
   `Config`, `Db`, `Auth`, `Maintenance`, `Code` (Script) dan `Index`, `App`, `Styles`, `Message` (HTML). Copy-paste isinya.
4. **Project Settings → centang "Show appsscript.json"**, lalu ganti isinya dengan `src/appsscript.json`.
5. Di editor, pilih fungsi `setup` → **Run**. Izinkan akses (akan muncul peringatan *"Google hasn't verified this app"* → Advanced → Go to project).
   `setup()` membuat semua sheet, set timezone, mendaftarkan email Anda sebagai **Admin**, dan memasang trigger ABANDONED (tiap 15 menit). Aman dijalankan ulang.
6. Isi sheet `Users` dan `Lines` (lihat bagian 4).
7. **Deploy → New deployment → Web app**
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone with Google account**
   - Salin URL yang berakhiran `/exec`.
8. **Share spreadsheet** ke setiap email di `Users` dengan akses **Editor** (lihat bagian 6 — ini wajib, bukan opsional).
9. Buka URL `/exec` → tab **QR Line** → **Cetak**. Tempel QR di masing-masing line.

**Alternatif pakai clasp** (kalau terbiasa CLI):
```bash
npm i -g @google/clasp && clasp login
cp .clasp.json.example .clasp.json   # isi scriptId dari Project Settings
clasp push && clasp deploy
```

### Update kode setelah deploy
Deploy → **Manage deployments** → edit (ikon pensil) → Version: **New version** → Deploy.
Jangan bikin "New deployment" — itu menghasilkan URL baru dan **semua QR yang sudah ditempel jadi mati**.

---

## 3. Alur pakai

- **ME**: scan QR dengan kamera HP → halaman line terbuka → **START**. Selesai kerja → isi Problem, Action Taken, Part Replaced, Testing OK/NG → **COMPLETE**.
- **Testing NG**: tetap tersimpan `COMPLETED`. Kalau mesin masih rusak, START maintenance baru di line yang sama.
- **Salah scan / salah line**: *Batalkan maintenance* (alasan wajib). Tidak ada Finish Time/Duration.
- **Lupa COMPLETE > 8 jam**: otomatis `ABANDONED`. ME tidak bisa menutupnya lagi; Supervisor/Admin memutuskan di tab **Review**:
  isi Finish Time manual (+catatan) → `COMPLETED`, atau Cancel → `CANCELLED`.
- **Export**: tab **Riwayat** → filter → *Download CSV*, atau buka sheet `Maintenance` langsung.

---

## 4. Menambah User / Line / QR

- **User baru**: tambah baris di `Users` (Email persis sama dengan akun Google-nya, Status `Active`) **dan** share spreadsheet ke email tsb sebagai Editor.
- **Nonaktifkan user**: ubah Status jadi `Inactive` (jangan hapus baris — riwayat masih merujuk emailnya).
- **Line baru**: tambah baris di `Lines`, Status `Active`. Buka tab **QR Line**, cetak QR-nya.
- **Isi QR** = `URL_EXEC?line=LINE_ID`. Line ID hanya boleh huruf, angka, `-`, `_`, `.` (karakter lain dibuang demi keamanan).
- **Ubah threshold ABANDONED**: ubah `Value` pada `ABANDON_HOURS` di sheet `Config`. Berlaku di run trigger berikutnya.

---

## 5. Troubleshooting

| Gejala | Penyebab paling mungkin | Solusi |
|---|---|---|
| Access Denied padahal sudah di `Users` | Email beda (typo, akun Google lain di HP), Status bukan `Active`, atau Role salah ketik | Cek email di pesan Access Denied, samakan dengan sheet |
| "You do not have permission to access the requested document" | Spreadsheet belum di-share ke user | Share sebagai Editor |
| Email tampil "(tidak terdeteksi)" | Deployment di-set *Execute as: Me* | Ubah ke *User accessing the web app* |
| QR membuka halaman "Line tidak ditemukan" | Line ID di QR ≠ sheet `Lines` | Samakan, atau cetak ulang QR |
| QR membuka URL lama / error 404 | Pernah bikin *New deployment* | Pakai URL deployment lama, atau cetak ulang semua QR |
| ABANDONED tidak pernah muncul | Trigger hilang | Jalankan `setup()` lagi, cek menu Triggers (ikon jam) |
| "Server sedang sibuk" | Lock dipegang proses lain > 10 detik | Coba lagi; jika sering, cek Executions log |
| Error lain | – | Apps Script editor → **Executions** untuk stack trace |

---

## 6. Hal yang WAJIB diketahui sebelum trial (risiko nyata)

1. **Akun personal Gmail memaksa "Execute as: User accessing".** Di akun personal, Apps Script *tidak memberi* email pengguna jika web app dijalankan sebagai pemilik. Konsekuensinya:
   - setiap ME harus punya akses **Editor** ke spreadsheet → mereka **bisa mengedit/menghapus data langsung di sheet**, melewati semua validasi aplikasi;
   - setiap ME akan melihat layar izin *"Google hasn't verified this app"* saat pertama kali membuka.

   Untuk trial ini bisa diterima (gunakan *Version history* di Sheets untuk audit/pemulihan, dan *Protected ranges* bila perlu). Untuk production, migrasi ke **akun institusi Google Workspace** menyelesaikan keduanya: deploy *Execute as: Me* + *Anyone within domain*, spreadsheet tidak perlu di-share ke ME.
2. **"8 jam tanpa update" = 8 jam sejak Start.** Tanpa Pause, tidak ada aksi "update" di tengah jalan, jadi Start Time adalah satu-satunya acuan. Trigger berjalan tiap 15 menit → ABANDONED terjadi antara 8j00m–8j15m.
3. **Perbaikan yang benar-benar > 8 jam** akan jadi ABANDONED meski ME masih bekerja. Aplikasi menampilkan peringatan di 90% threshold. Kalau di trial ini sering terjadi, threshold-nya salah — naikkan di `Config`, jangan dibiarkan.
4. **Kuota Apps Script** (akun personal): 90 menit runtime trigger/hari, ~30 eksekusi simultan. Trigger 15 menit ≈ 96 run/hari × <1 detik — aman untuk trial.
5. **Performa**: tiap aksi membaca seluruh sheet `Maintenance`. Nyaman sampai beberapa ribu baris; di atas ~10.000 baris mulai lambat → itulah waktu untuk archiving (v2).

## 7. Deviasi dari spec (sengaja)

| Spec | Implementasi | Alasan |
|---|---|---|
| Lock hanya di START | Lock juga di COMPLETE, CANCEL, review, dan trigger ABANDONED | Mencegah race "ME menekan COMPLETE tepat saat trigger menandai ABANDONED" dan double-submit. Biayanya nol untuk volume trial. |
| Kolom Maintenance sesuai spec | + `Closed By`, `Note`, `Reviewed By`, `Reviewed At` | Finish Time hasil review adalah input manusia, bukan timestamp server. Tanpa penanda, data itu tidak bisa dipisahkan saat analisis MTTR — dan itu merusak premis utama sistem. |
| Field form "proposed" | Problem & Action Taken wajib, Part Replaced opsional (kosong → `-`), Testing wajib | Minimum agar record COMPLETED punya makna. Ubah di `apiComplete` jika hasil validasi ME berbeda. |

## 8. Test

```bash
npm test   # atau: node test/run.js
```
Menguji state machine, lock, akses, ABANDONED, review, filter riwayat dengan mock Sheets.
**Tidak** menguji: perilaku asli Google (izin OAuth, trigger sungguhan, kuota), dan UI di HP sungguhan. Itu harus diuji manual saat trial (checklist Definition of Done di spec).
