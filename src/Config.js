/**
 * Konfigurasi global. Semua nama sheet, header, status, dan role didefinisikan di sini
 * supaya tidak ada string "ajaib" yang tersebar di file lain.
 */
var APP = {
  NAME: 'MTTR Trial',
  TZ: 'Asia/Jakarta',
  DATE_FMT: 'yyyy-MM-dd HH:mm:ss',

  SHEETS: {
    USERS: 'Users',
    LINES: 'Lines',
    MAINT: 'Maintenance',
    CONFIG: 'Config'
  },

  HEADERS: {
    Users: ['Email', 'Name', 'Role', 'Department', 'Status'],
    Lines: ['Line ID', 'Line Name', 'Machine', 'Department', 'Location', 'Status'],
    Maintenance: [
      'Maintenance ID', 'Line ID', 'User Email', 'Start Time', 'Finish Time', 'Status',
      'Problem', 'Action Taken', 'Part Replaced', 'Testing Result', 'Duration (min)',
      // Kolom audit (tambahan di luar spec, lihat README bagian "Deviasi dari spec")
      'Closed By', 'Note', 'Reviewed By', 'Reviewed At'
    ],
    Config: ['Key', 'Value', 'Description']
  },

  STATUS: {
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    ABANDONED: 'ABANDONED'
  },

  ROLES: {
    ME: 'ME',
    SUPERVISOR: 'Supervisor',
    ADMIN: 'Admin'
  },

  TESTING: ['OK', 'NG'],

  CONFIG_DEFAULTS: {
    ABANDON_HOURS: { value: 8, description: 'Jam tanpa update sebelum IN_PROGRESS otomatis jadi ABANDONED (provisional)' }
  },

  LOCK_TIMEOUT_MS: 10000,
  TRIGGER_MINUTES: 15
};

/** Membaca nilai dari sheet Config, fallback ke default. */
function getConfig_(key) {
  var def = APP.CONFIG_DEFAULTS[key] ? APP.CONFIG_DEFAULTS[key].value : null;
  var sh = SpreadsheetApp.getActive().getSheetByName(APP.SHEETS.CONFIG);
  if (!sh) return def;
  var rows = readTable_(APP.SHEETS.CONFIG);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Key']).trim() === key) {
      var v = rows[i]['Value'];
      return (v === '' || v === null) ? def : v;
    }
  }
  return def;
}

function getAbandonHours_() {
  var h = Number(getConfig_('ABANDON_HOURS'));
  return (isFinite(h) && h > 0) ? h : APP.CONFIG_DEFAULTS.ABANDON_HOURS.value;
}
