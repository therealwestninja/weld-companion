// Feature B2 (rotate-45): opt-in ENCRYPTED credential export lets a user carry their own
// API keys/tokens to another device without the default scrub ever shipping a plaintext
// key. This extracts the real wcEncryptSecrets/wcDecryptSecrets from the userscript and
// proves: round-trips under the right passphrase, and REJECTS a wrong passphrase (AES-GCM
// auth-tag), so a leaked file is inert.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'weld-companion.user.js'), 'utf8');
const from = src.indexOf('  function wcSubtle()');
const to = src.indexOf('  function exportState(');
assert.ok(from > 0 && to > from, 'located the crypto helpers');

const sandbox = {
  crypto, TextEncoder, TextDecoder, Promise, JSON, Error,
  bytesToB64: (u8) => Buffer.from(u8).toString('base64'),
  b64ToBytes: (s) => new Uint8Array(Buffer.from(s, 'base64')),
};
vm.createContext(sandbox);
vm.runInContext(src.slice(from, to) + '\nthis.wcEncryptSecrets = wcEncryptSecrets; this.wcDecryptSecrets = wcDecryptSecrets;', sandbox);

(async () => {
  const secrets = { aiKeys: { openai: 'sk-LIVE-abc', anthropic: 'sk-ant-xyz' }, aiEndpoints: { localai: 'https://gw.me/v1' }, ghToken: 'ghp_TOKEN', bridge: { token: 'brdg' } };

  const blob = await sandbox.wcEncryptSecrets(secrets, 'correct horse battery staple');
  // the ciphertext must not leak any plaintext secret
  const blobStr = JSON.stringify(blob);
  assert.ok(blob.v === 1 && blob.kdf === 'PBKDF2-SHA256' && blob.salt && blob.iv && blob.ct, 'B2: well-formed blob');
  for (const leak of ['sk-LIVE-abc', 'sk-ant-xyz', 'ghp_TOKEN', 'gw.me', 'brdg']) {
    assert.ok(!blobStr.includes(leak), 'B2: no plaintext secret in the blob: ' + leak);
  }

  // right passphrase -> exact round-trip
  const back = await sandbox.wcDecryptSecrets(blob, 'correct horse battery staple');
  assert.deepEqual(back, secrets, 'B2: round-trips under the right passphrase');

  // wrong passphrase -> rejects (file is inert without it)
  await assert.rejects(sandbox.wcDecryptSecrets(blob, 'wrong passphrase'), 'B2: wrong passphrase is rejected');

  // tampered ciphertext -> rejects (AES-GCM integrity)
  const tampered = Object.assign({}, blob, { ct: blob.ct.slice(0, -4) + (blob.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') });
  await assert.rejects(sandbox.wcDecryptSecrets(tampered, 'correct horse battery staple'), 'B2: tampered blob is rejected');

  // malformed blob -> rejects, no throw-through
  await assert.rejects(sandbox.wcDecryptSecrets({}, 'x'), 'B2: malformed blob rejected');

  console.log('Secrets-crypto (B2) gate passed');
})().catch(e => { console.error(e); process.exit(1); });
