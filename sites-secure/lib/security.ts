const encoder = new TextEncoder();
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) || [], x => parseInt(x, 16));
}
export function randomHex(size = 32): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(size)));
}
export async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
export async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(salt) as BufferSource, iterations: 310000 }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
export function constantEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function base32(bytes: Uint8Array): string {
  let buffer = 0, bits = 0, output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(buffer >>> bits) & 31]; }
  }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}
function fromBase32(value: string): Uint8Array {
  let buffer = 0, bits = 0; const output: number[] = [];
  for (const char of value.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(char); if (index < 0) throw new Error("Invalid TOTP secret");
    buffer = (buffer << 5) | index; bits += 5;
    if (bits >= 8) { bits -= 8; output.push((buffer >>> bits) & 255); }
  }
  return Uint8Array.from(output);
}
export function newTotpSecret(): string { return base32(crypto.getRandomValues(new Uint8Array(20))); }
export function totpUri(username: string, secret: string): string {
  return `otpauth://totp/Priolab:${encodeURIComponent(username)}?secret=${secret}&issuer=Priolab&algorithm=SHA1&digits=6&period=30`;
}
async function totpAt(secret: string, step: number): Promise<string> {
  const message = new Uint8Array(8); const view = new DataView(message.buffer);
  view.setUint32(4, step, false);
  const key = await crypto.subtle.importKey("raw", fromBase32(secret) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource));
  const offset = mac[mac.length - 1] & 15;
  const value = (((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]) % 1000000;
  return String(value).padStart(6, "0");
}
export async function verifyTotp(secret: string, code: string, lastStep: number): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(Date.now() / 30000);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && constantEqual(await totpAt(secret, step), code)) return step;
  }
  return null;
}
function toBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function aesKey(secret: string): Promise<CryptoKey> {
  const bytes = fromBase64(secret);
  if (bytes.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes");
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptTotp(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await aesKey(secret), encoder.encode(value)));
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}
export async function decryptTotp(value: string, secret: string): Promise<string> {
  const [iv, cipher] = value.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) as BufferSource }, await aesKey(secret), fromBase64(cipher) as BufferSource));
}
