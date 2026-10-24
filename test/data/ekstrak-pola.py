# Dipakai sekali: python3 -I test/data/ekstrak-pola.py <Troublelog.xlsx> test/data/pola-troublelog.json
# Ekstrak pola dari Troublelog asli (xlsx tidak di-commit). Nama orang (kolom PIC) TIDAK disimpan, hanya jumlahnya.
import openpyxl, sys, re, json, collections, datetime as dt
wb = openpyxl.load_workbook(sys.argv[1], data_only=True); ws = wb.worksheets[0]
rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if any(r[:16])]
clean = lambda s: re.sub(r'\s+', ' ', str(s or '').replace(' ', ' ')).strip(' .,;')
anon = lambda s: re.sub(r'\bmr\.?\s*[A-Za-z]+', 'atasan', s, flags=re.I)   # nama orang di teks → jabatan
K = [('vision', r'vision|photo ?po|foto ?po|photopoint|kamera|camera|ccd'), ('robot', r'robot|home posisi|home robot|posisi home|stuck'),
     ('lem', r'\blem\b|glue|mixer|adhesive|gluing|pengeleman'), ('rfid', r'rfid'), ('conveyor', r'conveyor|konveyor|palet|pallet|baki|tray'),
     ('sensor', r'sensor|photoelectric|fotoelektrik|infrared'), ('mes', r'\bmes\b|komputer|computer|\bpc\b|\blan\b|aplikasi|software|server|jaringan|internet|bug'),
     ('angin', r'angin|bocor|leak|silinder|cylinder|pneumatic|selang|valve|katup|vacuum|vakum|pressure'), ('uji', r'\bng\b|eol|ocv|air ?tight|kedap|\bat\b|thickness|hioki|test'),
     ('printer', r'printer|print|scanner|scan|barcode|label'), ('mekanik', r'baut|patah|kendur|lepas|jig|gripper|griper|bearing|belt|rantai|chain'),
     ('listrik', r'kabel|fuse|power|listrik|mati|stop kontak|relay|mcb|servo|motor|driver'), ('laser', r'laser|welding|las\b|pengelasan|nozzle|nozel')]
def inc(s):
    m = re.match(r'\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*/?\s*(\d{1,2})?[.:]?(\d{2})?', str(s or ''))
    if not m: return None
    y, mo, d, h, mi = m.groups()
    try: return dt.datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0))
    except ValueError: return None
cases, hours, wds, durs = [], [0] * 24, [0] * 7, []
for r in rows:
    p, c, a = anon(clean(r[5])), anon(clean(r[12])), anon(clean(r[13]))
    if not (c or p) or not a or re.match(r'^\d{4}\.\d', p): continue          # baris rusak (kolom bergeser)
    if not p: p = c
    t = (p + ' ' + c + ' ' + a).lower()
    k = next((key for key, pat in K if re.search(pat, t)), 'mekanik')
    m = re.search(r'(\d+)', str(r[11] or ''))
    dur = int(m.group(1)) if m and 1 <= int(m.group(1)) <= 600 else None
    st = str(r[8] or '').lower()
    stop = not re.search(r'normal|running|operasi|operated|unsolved', st)
    wait = bool(re.search(r'menunggu|mrnunggu|sedang', str(r[9] or '').lower()))
    npic = max(1, min(3, len(re.findall(r'@', str(r[7] or ''))) or (1 + len(re.findall(r'\bdan\b|,|;', str(r[7] or ''))))))
    w = inc(r[4])
    if w: hours[w.hour] += 1; wds[w.weekday()] += 1
    if dur: durs.append(dur)
    cases.append({'k': k, 'proc': clean(r[3]).lower(), 'p': p, 'c': c, 'a': a, 'dur': dur, 'stop': stop, 'wait': wait, 'npic': npic})
out = {'sumber': 'Troublelog F1 (Google Form), %d laporan 2 Jul–21 Okt 2026; teks teknis asli, nama orang dihapus' % len(rows),
       'jam': hours, 'hari': wds, 'durasi': sorted(durs), 'kasus': cases}
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
print(len(cases), 'kasus ·', collections.Counter(c['k'] for c in cases).most_common(), '· durasi', len(durs), '· stop', sum(c['stop'] for c in cases), '· tunggu', sum(c['wait'] for c in cases))
