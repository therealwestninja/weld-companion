// Feature B1 (rotate-45): a user-curated allowlist lets an approved generator reach a
// local/private host the SSRF guard blocks by default — WITHOUT opening the guard. The
// allowlist is read only from GM storage (never page-settable). This test extracts the
// real sbFetchGuard cluster from the shipped userscript and proves the offset is sound.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'weld-companion.user.js'), 'utf8');
const from = src.indexOf('  function sbParseHeaders(');
const to = src.indexOf('  function sbServiceFetch(');
assert.ok(from > 0 && to > from, 'located the fetch-guard cluster');

let ALLOW = [];
const sandbox = { gget: (k, d) => (k === 'fetchAllowlist' ? ALLOW : d), URL, console };
vm.createContext(sandbox);
vm.runInContext(src.slice(from, to) + '\nthis.sbFetchGuard = sbFetchGuard; this.sbHostAllowed = sbHostAllowed;', sandbox);
const guard = sandbox.sbFetchGuard;

// ---- default (no allowlist): private/local hosts are BLOCKED (the guard is intact) ----
ALLOW = [];
for (const u of ['http://192.168.1.50:8080/x', 'http://127.0.0.1:11434/api', 'http://localhost/x', 'http://10.0.0.5/', 'http://[::1]/', 'http://my-nas.local/']) {
  assert.equal(guard(u).ok, false, 'blocked by default: ' + u);
}
assert.equal(guard('http://93.184.216.34/').ok, true, 'a public IP is allowed by default');

// ---- user allowlists their LAN box: THAT host passes, others still blocked ----
ALLOW = ['192.168.1.50', 'my-nas.local'];
assert.equal(guard('http://192.168.1.50:8080/api').ok, true, 'B1: allowlisted LAN host passes');
assert.equal(guard('http://192.168.1.50/other').ok, true, 'B1: any port/path on the allowlisted host');
assert.equal(guard('http://MY-NAS.LOCAL/share').ok, true, 'B1: case-insensitive host match');
assert.equal(guard('http://192.168.1.51/api').ok, false, 'B1: a neighbouring host is NOT allowed');
assert.equal(guard('http://127.0.0.1/api').ok, false, 'B1: loopback still blocked unless allowlisted');

// ---- the offset must NOT weaken the scheme guard ----
ALLOW = ['192.168.1.50'];
assert.equal(guard('file:///etc/passwd').ok, false, 'B1: non-http scheme stays blocked even for an allowlisted-looking host');
assert.equal(guard('ftp://192.168.1.50/').ok, false, 'B1: ftp blocked for an allowlisted host');

// ---- a junk/empty allowlist entry can never match a host ----
ALLOW = ['', '   ', null, 42];
assert.equal(guard('http://192.168.1.50/').ok, false, 'B1: blank/invalid entries never match');
assert.equal(sandbox.sbHostAllowed(''), false, 'B1: empty host never allowed');

// ---- loopback allowlisting (Ollama / local model on 127.0.0.1) works when opted in ----
ALLOW = ['127.0.0.1', 'localhost'];
assert.equal(guard('http://127.0.0.1:11434/api/chat').ok, true, 'B1: user can reach their local model server');
assert.equal(guard('http://localhost:1234/v1').ok, true, 'B1: localhost allowlisted');

console.log('Fetch-allowlist (B1) security gate passed');
