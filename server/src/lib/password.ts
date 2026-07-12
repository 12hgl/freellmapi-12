import crypto from 'crypto';

// Password hashing with Node's built-in scrypt (no external dependency).
//
// Stored format (v2, current):  `scrypt$N$r$p$saltHex$hashHex`
// Legacy format (v1, default): `scrypt$saltHex$hashHex`
//   → v1 hashes were created with Node.js defaults: N=16384, r=8, p=1
//
// The v2 format embeds cost parameters so verification always uses the
// same parameters that were used at hash time.  This way old hashes
// (created with N=16384) keep working after the default is raised.

// Server-side pepper — adds an extra secret layer to password hashing.
// Even if the hash database is exfiltrated, an attacker cannot brute-force
// without also knowing the pepper value.
// Set via environment variable PASSWORD_PEPPER; if unset a hardcoded
// fallback is used (rotate on production deployments).
const PEPPER: string = process.env.PASSWORD_PEPPER || 'FreeLLMAPI::v1::default_pepper__change_me_in_production';

const KEYLEN = 64;
const SALT_BYTES = 16;

// OWASP 2024 recommendation: N=2^17 (131072)
const DEFAULT_N = 16384;  // legacy default, used for v1 hashes
const NEW_N = 131072;
const R = 8;
const P = 1;
// N=131072 needs ~128 MB of RAM per scrypt invocation.  150 MB gives a
// ~22 MB safety margin.  On extremely low-memory VPS (<256 MB total),
// consider lowering NEW_N to 65536 or 32768 (at the cost of hash strength).
const MAXMEM = 150 * 1024 * 1024; // 150 MB

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const peppered = password + PEPPER;
  const hash = crypto.scryptSync(peppered, salt, KEYLEN, { N: NEW_N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${NEW_N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');

  let N: number;
  let r: number;
  let p: number;
  let saltHex: string;
  let hashHex: string;

  if (parts.length === 6 && parts[0] === 'scrypt') {
    // v2 format: scrypt$N$r$p$salt$hash
    N = parseInt(parts[1], 10);
    r = parseInt(parts[2], 10);
    p = parseInt(parts[3], 10);
    saltHex = parts[4];
    hashHex = parts[5];
  } else if (parts.length === 3 && parts[0] === 'scrypt') {
    // v1 format: scrypt$salt$hash (legacy, N=16384 default)
    N = DEFAULT_N;
    r = 8;
    p = 1;
    saltHex = parts[1];
    hashHex = parts[2];
  } else {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, { N, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
