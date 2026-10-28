/**
 * Bahan profil uji UJI=bogor2 (test/seed-tahun.js): katalog uji 483 part, aturan teks Troublelog → Pilihan Bogor,
 * libur nasional, tim teknisi fiktif (@example.com). Master Bogor sendiri ada di test/data/master-bogor.json.
 */
'use strict';

// [jenis, nama, satuan, [model…]] — model pertama = paling sering dipakai (Pareto)
const KATALOG_ = [
  ['Elektrikal', 'Sensor photoelectric', 'pcs', ['Omron E3Z-D61', 'Omron E3Z-R61', 'Omron E3Z-T61', 'Keyence PZ-G51N', 'Keyence PZ-G61N', 'Sick WL4S-3F2230', 'Sick WTB4S-3P2161', 'Panasonic EX-13A', 'Panasonic CX-411']],
  ['Elektrikal', 'Sensor proximity', 'pcs', ['Omron E2E-X5ME1', 'Omron E2E-X2ME1', 'Omron E2E-X10ME1', 'Omron TL-Q5MC1', 'Keyence EM-030', 'Autonics PR12-4DN', 'Autonics PR18-8DN', 'Sick IME12-04BPSZC0K']],
  ['Elektrikal', 'Sensor red switch silinder', 'pcs', ['SMC D-A93', 'SMC D-M9N', 'SMC D-M9B', 'SMC D-M9P', 'Airtac DMSG-020', 'Festo SME-8M']],
  ['Elektrikal', 'Sensor fiber', 'pcs', ['Keyence FS-N11N', 'Keyence FU-35FA', 'Omron E3X-HD11', 'Panasonic FX-301']],
  ['Elektrikal', 'Sensor infrared kamera', 'pcs', ['Keyence PZ-G51N', 'Keyence PZ-V11']],
  ['Elektrikal', 'Kamera vision', 'pcs', ['Keyence CV-X420A', 'Keyence CA-H500M', 'Cognex IS2000', 'Hikrobot MV-CA050', 'Basler acA2440']],
  ['Elektrikal', 'Lensa kamera', 'pcs', ['Computar M1214-MP2', 'Computar M2514-MP2', 'Keyence CA-LH16', 'Fujinon HF16HA']],
  ['Elektrikal', 'Lampu vision', 'pcs', ['CCS LDR2-90', 'Keyence CA-DRW10', 'OPT-RI100']],
  ['Elektrikal', 'Barcode scanner', 'pcs', ['Honeywell 1900GSR', 'Honeywell 1950GSR', 'Zebra DS2208', 'Zebra DS3608', 'Keyence SR-1000', 'Cognex DM262X', 'Datalogic GD4590']],
  ['Elektrikal', 'RFID tag pallet', 'pcs', ['Balluff BIS M-1', 'Balluff BIS VM', 'Omron V680-D1KP66T']],
  ['Elektrikal', 'RFID reader', 'pcs', ['Balluff BIS M-4A7', 'Omron V680-HS63', 'Turck TN-Q80']],
  ['Elektrikal', 'Kabel sensor', 'pcs', ['M12 4 pin 5 m', 'M8 3 pin 2 m', 'M8 4 pin 5 m', 'M12 4 pin 2 m', 'M12 8 pin 5 m', 'M12 4 pin 10 m']],
  ['Elektrikal', 'Kabel LAN', 'pcs', ['Cat6 2 m', 'Cat6 1 m', 'Cat6 5 m', 'Cat6 10 m', 'Cat6 industri 5 m']],
  ['Elektrikal', 'Kabel servo', 'pcs', ['Mitsubishi MR-J3ENCBL5M', 'Mitsubishi MR-PWS1CBL5M', 'Yaskawa JZSP-CSP01', 'Panasonic MFECA0050']],
  ['Elektrikal', 'Power supply', 'pcs', ['Mean Well NDR-240-24', 'Mean Well NDR-120-24', 'Mean Well NDR-480-24', 'Omron S8VK-G24024', 'Omron S8VK-G48024', 'Phoenix QUINT-PS 24V 10A']],
  ['Elektrikal', 'Fuse', 'pcs', ['2A', '1A', '5A', '10A', '16A', '20A']],
  ['Elektrikal', 'MCB', 'pcs', ['Schneider 1P 6A', 'Schneider 1P 10A', 'Schneider 2P 16A', 'Schneider 3P 20A', 'ABB S201 C10', 'ABB S203 C16']],
  ['Elektrikal', 'Relay', 'pcs', ['Omron MY2N 24VDC', 'Omron MY4N 24VDC', 'Omron G2R-1 24VDC', 'Finder 40.52 24VDC', 'Phoenix PLC-RSC 24DC']],
  ['Elektrikal', 'Kontaktor', 'pcs', ['Schneider LC1D09', 'Schneider LC1D18', 'Schneider LC1D32', 'ABB AF09']],
  ['Elektrikal', 'Coil solenoid', 'pcs', ['SMC 24VDC', 'SMC 220VAC', 'Airtac 24VDC', 'Festo 24VDC']],
  ['Elektrikal', 'Motor servo', 'pcs', ['Mitsubishi HG-KR43', 'Mitsubishi HG-KR73', 'Yaskawa SGM7J-04A', 'Panasonic MHMF042L1', 'Delta ECMA-C20604']],
  ['Elektrikal', 'Driver servo', 'pcs', ['Mitsubishi MR-J4-40A', 'Mitsubishi MR-J4-70A', 'Yaskawa SGD7S-2R8A', 'Panasonic MADLN15SE', 'Delta ASD-B2-0421']],
  ['Elektrikal', 'Encoder', 'pcs', ['Omron E6B2-CWZ6C', 'Autonics E40S6', 'Baterai encoder MR-BAT6V1SET']],
  ['Elektrikal', 'Modul PLC', 'pcs', ['Mitsubishi FX5U-32MT', 'Mitsubishi QX42', 'Mitsubishi QY42P', 'Siemens SM1221', 'Siemens SM1222', 'Omron CJ1W-ID231']],
  ['Elektrikal', 'HMI touch panel', 'pcs', ['Weintek MT8071iE', 'Weintek MT8102iE', 'Mitsubishi GT2510', 'Siemens KTP700']],
  ['Elektrikal', 'Inverter', 'pcs', ['Mitsubishi FR-E820-0.75K', 'Mitsubishi FR-D720S-0.4K', 'Delta VFD-M 0.75kW']],
  ['Elektrikal', 'Push button', 'pcs', ['Schneider XB4 hijau', 'Schneider XB4 merah', 'Emergency stop XB4', 'Selector switch 2 posisi']],
  ['Elektrikal', 'Lampu tower', 'pcs', ['Patlite LR6', 'Patlite LR4', 'Werma 2 warna']],
  ['Elektrikal', 'Baterai scanner', 'pcs', ['Li-ion 3.7V', 'Honeywell BAT-SCN01']],
  ['Elektrikal', 'Thermocouple', 'pcs', ['Type K 1 m', 'Type K 3 m', 'PT100 1 m']],
  ['Elektrikal', 'Heater', 'pcs', ['Cartridge 220V 200W', 'Cartridge 220V 400W', 'Band heater 300W']],
  ['Elektrikal', 'Kipas pendingin', 'pcs', ['80 mm 24VDC', '120 mm 24VDC', '120 mm 220VAC']],
  ['Elektrikal', 'Switch jaringan', 'pcs', ['TP-Link 8 port', 'Moxa EDS-208A', 'Hirschmann SPIDER 5TX']],
  ['Elektrikal', 'Komputer industri', 'pcs', ['Advantech IPC-610', 'SSD 256 GB', 'RAM 8 GB DDR4', 'Keyboard + mouse', 'Monitor 22 inch']],
  ['Elektrikal', 'Printer label', 'pcs', ['Zebra ZT411', 'Zebra ZT230', 'Head printer Zebra ZT411', 'Ribbon wax 110 mm', 'Label 50x30 mm']],
  ['Pneumatik', 'Selang PU', 'meter', ['6 mm', '4 mm', '8 mm', '10 mm', '12 mm']],
  ['Pneumatik', 'Fitting push-in', 'pcs', ['10 mm', '4 mm', '6 mm', '8 mm', '12 mm', 'Elbow 6 mm', 'Elbow 8 mm', 'Tee 8 mm']],
  ['Pneumatik', 'Silinder', 'pcs', ['SMC CQ2B32-30D', 'SMC CQ2B20-20D', 'SMC CDQ2B40-50D', 'SMC MGPM20-50', 'Airtac SDA32x25', 'Festo DSNU-25-50']],
  ['Pneumatik', 'Seal kit silinder', 'set', ['SMC CQ2B32', 'SMC CQ2B20', 'SMC CQ2B40', 'Airtac SDA32', 'Festo DSNU-25']],
  ['Pneumatik', 'Solenoid valve', 'pcs', ['SMC SY5120', 'SMC SY3120', 'SMC SY7120', 'SMC VQ1000', 'Airtac 4V210-08', 'Festo VUVG-L14']],
  ['Pneumatik', 'Regulator', 'pcs', ['SMC AR20-02', 'SMC AR30-03', 'SMC AW30-03', 'Festo LR-1/4']],
  ['Pneumatik', 'Filter udara', 'pcs', ['SMC AF30-03', 'SMC AFM30', 'Elemen filter 5 micron']],
  ['Pneumatik', 'Vacuum ejector', 'pcs', ['SMC ZH10', 'SMC ZH13', 'SMC ZX1']],
  ['Pneumatik', 'Suction cup', 'pcs', ['SMC ZP20', 'SMC ZP10', 'SMC ZP32', 'Piab B20']],
  ['Pneumatik', 'Pressure switch', 'pcs', ['SMC ISE30A', 'SMC ZSE30A', 'Keyence AP-V80']],
  ['Pneumatik', 'Speed controller', 'pcs', ['SMC AS2201F', 'SMC AS1201F', 'SMC AS3201F']],
  ['Pneumatik', 'O-ring alat ukur AT', 'pcs', ['NBR 20x2', 'NBR 30x2', 'FKM 20x2', 'Silikon 25x3']],
  ['Pneumatik', 'Balon air tightness', 'pcs', ['Karet 60 mm', 'Karet 40 mm', 'Karet 80 mm']],
  ['Pneumatik', 'Silencer', 'pcs', ['SMC AN10', 'SMC AN20', 'Sintered 1/4']],
  ['Pneumatik', 'Gripper pneumatik', 'pcs', ['SMC MHZ2-16D', 'SMC MHZ2-20D', 'Schunk PGN-plus 64']],
  ['Mekanikal', 'Bearing', 'pcs', ['6205-2RS', '6000-2RS', '6200-2RS', '6201-2RS', '6202-2RS', '6203-2RS', '6204-2RS', '6206-ZZ', '608-ZZ', 'LM10UU', 'LM16UU']],
  ['Mekanikal', 'Linear guide block', 'pcs', ['HIWIN HGH15CA', 'HIWIN HGH20CA', 'HIWIN MGN12H', 'THK HSR15']],
  ['Mekanikal', 'Ball screw', 'pcs', ['HIWIN 1605', 'HIWIN 2005', 'Support BK12']],
  ['Mekanikal', 'Timing belt', 'pcs', ['HTD 5M-450', 'HTD 3M-300', 'HTD 5M-600', 'HTD 8M-800', 'GT2 6 mm']],
  ['Mekanikal', 'Pulley', 'pcs', ['HTD 5M 20T', 'HTD 5M 30T', 'GT2 20T']],
  ['Mekanikal', 'Coupling', 'pcs', ['Jaw 14 mm', 'Jaw 19 mm', 'Bellow 8x10', 'Oldham 10x12']],
  ['Mekanikal', 'Rantai', 'meter', ['RS40', 'RS50', 'RS60']],
  ['Mekanikal', 'Sprocket', 'pcs', ['RS40 15T', 'RS40 20T', 'RS50 15T']],
  ['Mekanikal', 'Roller conveyor', 'pcs', ['Ø50 x 500', 'Ø50 x 700', 'Ø60 x 700']],
  ['Mekanikal', 'Belt conveyor', 'pcs', ['PVC 2 mm lebar 300', 'PU 1.5 mm lebar 200', 'Flat belt 3 mm']],
  ['Mekanikal', 'Motor gearbox', 'pcs', ['SPG 60W 1:30', 'SPG 90W 1:15', 'SEW 0.37 kW', 'Oriental 40W']],
  ['Mekanikal', 'Stopper conveyor', 'pcs', ['30 mm', '20 mm', '40 mm', 'Stopper pneumatik SMC RSQ']],
  ['Mekanikal', 'Baut', 'pcs', ['M6 x 20 SUS', 'M3 x 10 SUS', 'M4 x 12 SUS', 'M5 x 16 SUS', 'M8 x 25 SUS', 'M10 x 30']],
  ['Mekanikal', 'Mur', 'pcs', ['M6 SUS', 'M4 SUS', 'M5 SUS', 'M8 SUS']],
  ['Mekanikal', 'Pin', 'pcs', ['Dowel 4x16', 'Dowel 6x20', 'Pin locating 8 mm']],
  ['Mekanikal', 'Pegas', 'pcs', ['Tekan 0.5x5x20', 'Tekan 1x10x30', 'Tarik 1x8x40']],
  ['Mekanikal', 'Gripper / jig OCV', 'pcs', ['FX021', 'FX022', 'FX031', 'Jig Limo7', 'Jig E22H', 'Jig 2W']],
  ['Mekanikal', 'Static mixer lem', 'pcs', ['MC 10-24', 'MC 06-24', 'MC 13-24', 'MFH 08-24']],
  ['Mekanikal', 'Nozzle lem', 'pcs', ['1.2 mm', '0.8 mm', '1.0 mm', '1.5 mm', '2.0 mm']],
  ['Mekanikal', 'Inlet valve lem', 'pcs', ['2K', '1K', 'Check valve 2K']],
  ['Mekanikal', 'Lem 2K', 'cartridge', ['Kuning / biru', 'Hitam', 'Abu-abu']],
  ['Mekanikal', 'Lensa pelindung laser', 'pcs', ['120 x 5 mm', '90 x 3 mm', 'Ø30 x 2 mm', 'Ø38 x 2 mm']],
  ['Mekanikal', 'Nozzle laser', 'pcs', ['Ø1.5 single', 'Ø2.0 double', 'Cu Ø3']],
  ['Mekanikal', 'Elektroda las', 'pcs', ['Cu Cr Zr Ø16', 'Tip ultrasonic 20 kHz']],
  ['Mekanikal', 'Bit / socket torsi', 'pcs', ['Bit hex 4', 'Bit hex 5', 'Socket 10 mm', 'Socket 13 mm']],
  ['Mekanikal', 'Bantalan karet', 'pcs', ['Shore 60 10 mm', 'Shore 70 5 mm', 'Anti slip pad']],
  ['Mekanikal', 'Profil aluminium', 'pcs', ['3030', '4040', 'Bracket 4040']],
  ['Mekanikal', 'Pelumas', 'pcs', ['Grease Shell Gadus S2', 'Oli THK AFB-LF', 'Spray WD-40']],
  ['Program', 'Backup program PLC', 'kali', ['', 'Mitsubishi GX Works', 'Siemens TIA Portal']],
  ['Program', 'Lisensi software', 'pcs', ['Vision Keyence', 'Windows 10 IoT']],
  ['Program', 'Dongle / USB key', 'pcs', ['CodeMeter', 'Sentinel HL']],
  ['Program', 'Kartu memori', 'pcs', ['SD 8 GB', 'SD 32 GB', 'CF 2 GB', 'USB 32 GB']],
  ['Program', 'Baterai PLC', 'pcs', ['Mitsubishi Q6BAT', 'Mitsubishi FX3U-32BL', 'Siemens CR2032', 'Omron CJ1W-BAT01']],
  ['MES', 'Lisensi MES client', 'pcs', ['Client 1 PC']],
  ['MES', 'Printer MES', 'pcs', ['Epson TM-T82', 'Zebra GK420t']]
];
// Varian ukuran untuk part yang memang punya banyak ukuran (baut / selang / O-ring / fitting) sampai tepat 483 baris
const VARIAN_ = [
  ['Mekanikal', 'Baut', 'pcs', (i) => 'M' + [3, 4, 5, 6, 8, 10, 12][i % 7] + ' x ' + [8, 12, 16, 20, 25, 30, 35, 40, 50][Math.floor(i / 7) % 9] + (i % 2 ? ' SUS' : ' hitam')],
  ['Pneumatik', 'O-ring alat ukur AT', 'pcs', (i) => ['NBR', 'FKM', 'Silikon'][i % 3] + ' ' + (10 + 2 * Math.floor(i / 3)) + 'x' + [1.5, 2, 2.5, 3][i % 4]],
  ['Pneumatik', 'Fitting push-in', 'pcs', (i) => ['Lurus', 'Elbow', 'Tee', 'Reducer'][i % 4] + ' ' + [4, 6, 8, 10, 12, 16][Math.floor(i / 4) % 6] + ' mm ' + ['PT1/8', 'PT1/4', 'PT3/8'][Math.floor(i / 24) % 3]],
  ['Mekanikal', 'Bearing', 'pcs', (i) => ['60', '62', '63', '68', '69'][i % 5] + String(Math.floor(i / 5) % 12).padStart(2, '0') + ['-2RS', '-ZZ', ''][Math.floor(i / 60) % 3]]
];
function katalog() {
  const out = [], seen = new Set();
  const add = (j, n, s, m) => { const k = (j + '|' + n + '|' + m).toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push([j, n, m, s]); };
  KATALOG_.forEach(([j, n, s, models]) => models.forEach(m => add(j, n, s, m)));
  for (let i = 0, v = 0; out.length < 483 && i < 4000; i++) { const [j, n, s, f] = VARIAN_[v]; add(j, n, s, f(i)); if (i % 40 === 39) v = (v + 1) % VARIAN_.length; }
  if (out.length !== 483) throw new Error('katalog uji: ' + out.length + ' ≠ 483');
  return out;
}

// Teks Troublelog → nama part katalog (aturan pertama yang cocok menang)
const PART_RULE = [[/lensa/, 'Lensa pelindung laser'], [/red switch/, 'Sensor red switch silinder'], [/infrared/, 'Sensor infrared kamera'],
  [/fiber|serat optik/, 'Sensor fiber'], [/sensor (photo|foto)|photoelectric|fotoelektrik/, 'Sensor photoelectric'], [/sensor/, 'Sensor proximity'],
  [/kamera|camera/, 'Kamera vision'], [/scanner|barcode|scan/, 'Barcode scanner'], [/selang/, 'Selang PU'], [/fitting/, 'Fitting push-in'],
  [/balon/, 'Balon air tightness'], [/(ring|karet).*(alat ukur|\bat\b)|teflon/, 'O-ring alat ukur AT'], [/seal|karet|ring/, 'Seal kit silinder'],
  [/silinder|cylinder/, 'Silinder'], [/mixer|selongsong/, 'Static mixer lem'], [/nozzle|nozel/, 'Nozzle lem'], [/valve|katup/, 'Inlet valve lem'],
  [/selenoid|solenoid|coil/, 'Coil solenoid'], [/regulator/, 'Regulator'], [/suction|vacuum|vakum/, 'Suction cup'], [/rfid/, 'RFID tag pallet'],
  [/\blan\b/, 'Kabel LAN'], [/kabel servo|encoder/, 'Kabel servo'], [/kabel|cable/, 'Kabel sensor'], [/power su/, 'Power supply'],
  [/sikring|fuse/, 'Fuse'], [/\bmcb\b/, 'MCB'], [/kontaktor|contactor/, 'Kontaktor'], [/relay/, 'Relay'], [/driver/, 'Driver servo'],
  [/servo/, 'Motor servo'], [/\bplc\b/, 'Modul PLC'], [/hmi|touch/, 'HMI touch panel'], [/printer|label/, 'Printer label'],
  [/gripper|griper|\bjig\b|clamp/, 'Gripper / jig OCV'], [/stopper|stoper/, 'Stopper conveyor'], [/bearing|laher/, 'Bearing'],
  [/timing|belt/, 'Timing belt'], [/roller/, 'Roller conveyor'], [/motor/, 'Motor gearbox'], [/baut|baud|bolt|screw/, 'Baut'], [/\bnut\b|\bmur\b/, 'Mur'],
  [/pegas|spring/, 'Pegas'], [/ganti lem|lem habis|pergantian lem/, 'Lem 2K'], [/heater/, 'Heater'], [/kipas|\bfan\b/, 'Kipas pendingin'],
  [/baterai scanner|baterai/, 'Baterai scanner']];

// Teks Troublelog → Pilihan Bogor (Penyebab / Penanganan)
const PENYEBAB = [[/jaringan|network|internet|server|\bmes\b|komputer|\bpc\b|wifi/, 'Jaringan / MES / komputer'],
  [/bug|program|software|parameter|offs[ei]|setting|limit|teach|aplikasi|komunikasi|communication/, 'Program / parameter / bug'],
  [/nitrogen|material|lem (tidak|kurang|beda)|glue (ng|beda)/, 'Material tidak sesuai (lem / nitrogen)'],
  [/kotor|debu|kering|gumpal|kontamin|tersumbat|mampet|bercak/, 'Kotor / tersumbat'],
  [/kabel|cable|konektor|connector|soket|socket|\blan\b|loss|longgar|putus/, 'Kabel / konektor longgar / putus'],
  [/angin|tekanan|pressure|silinder|cylinder|pneumatic|pneumatik/, 'Silinder / sensor / tekanan angin'],
  [/baut|baud|bolt|screw|kendur|patah|crack|pecah|lepas/, 'Baut kendur / part patah'],
  [/aus|rusak|broken|mati|habis|bocor|robek|getas|weak|lemah/, 'Komponen aus / rusak / habis'],
  [/operator|salah|tertabrak|ditabrak/, 'Kesalahan operasi'],
  [/robot|home|posisi|stuck|servo|encoder|zero/, 'Posisi robot / servo hilang'],
  [/\bng\b|vision|photo|foto|kamera|camera/, 'Vision / kamera NG']];
const PENANGANAN = [[/vendor|supplier|china|cina|nanshi|nanchi|\btka\b|remote|tiongkok/, 'Remote / panggil vendor'],
  [/ganti|penggantian|pergantian|tuker|tukar|replace|\bbaru\b/, 'Ganti part'],
  [/program|parameter|software|bug|offset|teach/, 'Perbaiki program / parameter'],
  [/bersih|clean|flushing/, 'Bersihkan'],
  [/kencang|tighten|sambung|connect|hubungkan|pasang/, 'Kencangkan / sambung ulang'],
  [/adjust|setting|kalibrasi|calibrat|sesuai|modifikasi/, 'Adjust / setting ulang'],
  [/home|reset|init|restart|start|auto|manual/, 'Home / reset / restart']];
const DEF_PENYEBAB = { vision: 'Vision / kamera NG', robot: 'Posisi robot / servo hilang', lem: 'Material tidak sesuai (lem / nitrogen)', mes: 'Jaringan / MES / komputer',
  printer: 'Jaringan / MES / komputer', angin: 'Silinder / sensor / tekanan angin', uji: 'Kabel / konektor longgar / putus' };
const BELUM_TAHU = 'Belum diketahui (normal lagi setelah reset)';
const PAUSE = { istirahat: 'Istirahat / sholat', part: 'Ambil part / alat', operator: 'Menunggu operator / produksi' };

// Libur nasional Indonesia Nov 2024 – Okt 2026 (perkiraan dari SKB; cukup untuk uji jam operasi / MTBF, bukan kalender resmi)
const LIBUR = ['2024-12-25',
  '2025-01-01', '2025-01-27', '2025-01-29', '2025-03-29', '2025-03-31', '2025-04-01', '2025-04-18', '2025-05-01', '2025-05-12', '2025-05-29',
  '2025-06-01', '2025-06-06', '2025-06-27', '2025-08-17', '2025-09-05', '2025-12-25',
  '2026-01-01', '2026-01-16', '2026-02-17', '2026-03-19', '2026-03-20', '2026-03-21', '2026-04-03', '2026-05-01', '2026-05-14', '2026-05-27',
  '2026-05-31', '2026-06-01', '2026-06-16', '2026-08-17', '2026-08-25'];

// Tim fiktif 24/hari: 3 grup shift × 6 + non-shift 3 (≥ 16 aktif → PIC tambahan s/d 15 bisa diuji)
const GRUP = {
  A: [['agus', 'Agus Setiawan'], ['rudi', 'Rudi Hartono'], ['fajar', 'Fajar Nugroho'], ['wanglei', 'Wang Lei 王磊', 'zh'], ['yusuf', 'Yusuf Maulana'], ['andre', 'Andre Saputra']],
  B: [['dimas', 'Dimas Prasetyo'], ['eko', 'Eko Saputra'], ['hendra', 'Hendra Wijaya'], ['rizal', 'Rizal Fauzi'], ['wahyu', 'Wahyu Hidayat'], ['irfan', 'Irfan Hakim']],
  C: [['bayu', 'Bayu Pratama'], ['joko', 'Joko Susilo'], ['rian', 'Rian Hidayat'], ['zhangwei', 'Zhang Wei 张伟', 'zh'], ['slamet', 'Slamet Riyadi'], ['deni', 'Deni Kurniawan']],
  D: [['ilham', 'Ilham Ramadhan'], ['taufik', 'Taufik Hidayat'], ['liming', 'Li Ming 李明', 'zh']]
};

module.exports = { katalog, PART_RULE, PENYEBAB, PENANGANAN, DEF_PENYEBAB, BELUM_TAHU, PAUSE, LIBUR, GRUP };

if (require.main === module) {
  const k = katalog(), per = {};
  k.forEach(r => { per[r[0]] = (per[r[0]] || 0) + 1; });
  console.log(k.length + ' part · ' + JSON.stringify(per) + ' · ' + new Set(k.map(r => r[1])).size + ' nama');
  const names = new Set(k.map(r => r[1])), miss = PART_RULE.map(r => r[1]).filter(n => !names.has(n));
  console.log('nama di aturan tanpa katalog:', miss.length ? miss : 'tidak ada');
}
