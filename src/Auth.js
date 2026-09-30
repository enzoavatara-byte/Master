/**
 * Autentikasi: email Google yang sedang login dicocokkan ke sheet Users.
 * Setiap fungsi api* WAJIB memanggil requireUser_() — jangan pernah percaya peran dari client.
 */

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

/** @return {{email:string, authorized:boolean, name?:string, role?:string}} */
function getCurrentUser_() {
  var email = currentEmail_();
  if (!email) return { email: '', authorized: false };
  var rows = readTable_(APP.SHEETS.USERS);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r['Email']).trim().toLowerCase() !== email) continue;
    var role = APP.ROLE_ALIASES[String(r['Peran'] || '').trim().toLowerCase()];
    if (!isYes_(r['Aktif']) || !role) return { email: email, authorized: false };
    return { email: email, authorized: true, name: String(r['Nama'] || email), role: role };
  }
  return { email: email, authorized: false };
}

/** @param {string[]=} allowedRoles kosong = semua peran yang aktif. */
function requireUser_(allowedRoles) {
  var u = getCurrentUser_();
  if (!u.authorized) throw new Error('ACCESS_DENIED: email ' + (u.email || '(tidak terdeteksi)') + ' tidak terdaftar atau nonaktif.');
  if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(u.role) === -1) {
    throw new Error('Peran ' + u.role + ' tidak punya akses ke fitur ini.');
  }
  return u;
}

function isAdmin_(user) {
  return user.role === APP.ROLES.ADMIN;
}

function userNameMap_() {
  var map = {};
  readTable_(APP.SHEETS.USERS).forEach(function (u) {
    map[String(u['Email']).trim().toLowerCase()] = String(u['Nama'] || u['Email']);
  });
  return map;
}

function adminEmails_() {
  return readTable_(APP.SHEETS.USERS).filter(function (u) {
    return isYes_(u['Aktif']) && APP.ROLE_ALIASES[String(u['Peran'] || '').trim().toLowerCase()] === APP.ROLES.ADMIN;
  }).map(function (u) { return String(u['Email']).trim().toLowerCase(); });
}
