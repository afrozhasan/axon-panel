import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateSecret(bytes = 20) {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const clean = String(input).replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentCode(secret, timestamp = Date.now()) {
  return hotp(secret, Math.floor(timestamp / 1000 / STEP_SECONDS));
}

export function verifyCode(secret, token, window = 1) {
  if (typeof token !== "string" || !new RegExp(`^\\d{${DIGITS}}$`).test(token)) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = hotp(secret, Math.floor((now + offset * STEP_SECONDS * 1000) / 1000 / STEP_SECONDS));
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(token))) return true;
  }
  return false;
}

export function otpauthUri({ secret, account, issuer = "Axon Panel" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
