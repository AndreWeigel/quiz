// HTTP Basic Auth. Any username; the password must equal one of the named
// config secrets (compared in constant time). None of them set => locked (503).
const crypto = require('node:crypto');
const config = require('./config');

function passwordGate(realm, ...secretNames) {
  return function gate(req, res, next) {
    const secrets = secretNames.map((n) => config[n]).filter(Boolean);
    const deny = (msg, code = 401) => {
      if (code === 401) res.set('WWW-Authenticate', `Basic realm="quiz ${realm}"`);
      res.status(code).send(msg);
    };
    if (!secrets.length) return deny(`Locked — set ${secretNames[0]} to enable.`, 503);
    const [, b64 = ''] = (req.headers.authorization || '').split(' ');
    const pass = Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':');
    const a = Buffer.from(pass);
    const ok = secrets.some((s) => {
      const b = Buffer.from(s);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
    if (!ok) return deny('Auth required.');
    next();
  };
}

const basicAuth = passwordGate('admin', 'ADMIN_TOKEN');

module.exports = { basicAuth, passwordGate };
