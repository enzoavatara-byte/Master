/**
 * Autentikasi: email Google yang sedang login dicocokkan ke sheet Users.
 * Setiap fungsi api* WAJIB memanggil requireUser_() — jangan pernah percaya peran dari client.
 */

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

/** @return {{email:string, authorized:boolean, name?:string, role?:string}} */
function getCurrentUser_() {
  resetMaster_(); // memo per request (di Apps Script tiap panggilan = eksekusi baru; ini untuk test & trigger)
  var email = currentEmail_();
  if (!email) return { email: '', authorized: false };
  var u = userByEmail_()[email];
  var role = u && APP.ROLE_ALIASES[u.peran.trim().toLowerCase()];
  if (!u || !isYes_(u.aktif) || !role) return { email: email, authorized: false };
  return { email: email, authorized: true, name: u.name || email, role: role, lang: u.lang || 'id' };
}

/**
 * Email → baris Users yang dipakai: baris aktif pertama, atau baris pertama jika tidak ada yang aktif. Email yang ditulis
 * dua kali (mis. baris lama dinonaktifkan lalu ditambah baris baru) tetap satu orang: peran & nama dari baris yang sama.
 */
function userByEmail_() {
  var map = {};
  masterData_().users.forEach(function (u) {
    if (!u.email) return;
    var cur = map[u.email];
    if (!cur || (!isYes_(cur.aktif) && isYes_(u.aktif))) map[u.email] = u;
  });
  return map;
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
  var map = {}, users = userByEmail_();
  Object.keys(users).forEach(function (e) { map[e] = users[e].name; });
  return map;
}

function adminEmails_() {
  return masterData_().users.filter(function (u) {
    return isYes_(u.aktif) && APP.ROLE_ALIASES[u.peran.trim().toLowerCase()] === APP.ROLES.ADMIN;
  }).map(function (u) { return u.email; });
}
