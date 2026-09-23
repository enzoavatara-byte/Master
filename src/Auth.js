/**
 * Autentikasi: email Google yang sedang login dicocokkan ke sheet Users.
 * Setiap fungsi api* WAJIB memanggil requireUser_() — jangan pernah percaya role dari client.
 */

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

/** @return {{email:string, authorized:boolean, name?:string, role?:string, department?:string}} */
function getCurrentUser_() {
  var email = currentEmail_();
  if (!email) return { email: '', authorized: false };
  var rows = readTable_(APP.SHEETS.USERS);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r['Email']).trim().toLowerCase() !== email) continue;
    var role = normalizeRole_(r['Role']);
    if (!isActiveStatus_(r['Status']) || !role) return { email: email, authorized: false };
    return {
      email: email,
      authorized: true,
      name: String(r['Name'] || email),
      role: role,
      department: String(r['Department'] || '')
    };
  }
  return { email: email, authorized: false };
}

function normalizeRole_(raw) {
  var v = String(raw || '').trim().toLowerCase();
  var roles = APP.ROLES;
  for (var k in roles) {
    if (roles[k].toLowerCase() === v) return roles[k];
  }
  return null;
}

/**
 * @param {string[]=} allowedRoles kosong = semua role yang aktif.
 */
function requireUser_(allowedRoles) {
  var u = getCurrentUser_();
  if (!u.authorized) throw new Error('ACCESS_DENIED: email ' + (u.email || '(tidak terdeteksi)') + ' tidak terdaftar atau nonaktif.');
  if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(u.role) === -1) {
    throw new Error('Role ' + u.role + ' tidak punya akses ke fitur ini.');
  }
  return u;
}

function isReviewer_(user) {
  return user.role === APP.ROLES.SUPERVISOR || user.role === APP.ROLES.ADMIN;
}
