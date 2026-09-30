// Run inside the Priolab container, with the temporary password on stdin.
// This script does not expose an account-creation endpoint to the internet.
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const raw = readFileSync(0, 'utf8');
const password = raw.replace(/\r?\n$/, '');
if (password.length < 8 || password.length > 128) {
  console.error('Temporary password must be 8–128 characters.');
  process.exit(1);
}
const key = Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'base64');
if (key.length !== 32) {
  console.error('APP_ENCRYPTION_KEY must contain 32 base64-encoded bytes.');
  process.exit(1);
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let buffer = 0, bits = 0, output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(buffer >>> bits) & 31]; }
  }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
const secret = base32(randomBytes(20));
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]);
const encryptedSecret = `${iv.toString('base64')}.${ciphertext.toString('base64')}`;
const db = new DatabaseSync(process.env.PRIOLAB_DB_PATH || '/data/priolab.sqlite');
try {
  db.exec('BEGIN IMMEDIATE');
  const count = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
  if (count !== 0) {
    db.exec('ROLLBACK');
    console.error('Admin setup stopped: users already exist. No account was changed.');
    process.exitCode = 1;
  } else {
    db.prepare("INSERT INTO users (id, username, salt, password_hash, totp_secret, last_totp_step, role, status, must_change_password, created_at) VALUES (?, 'admin', ?, ?, ?, -1, 'admin', 'pending', 1, ?)")
      .run(randomUUID(), salt.toString('hex'), hash, encryptedSecret, Date.now());
    db.exec('COMMIT');
    console.log('Created admin. First login requires a new complex password and Google Authenticator enrollment.');
  }
} catch (error) {
  if (db.isOpen) { try { db.exec('ROLLBACK'); } catch {} }
  console.error('Admin setup failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
} finally {
  db.close();
}
