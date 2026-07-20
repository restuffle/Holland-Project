'use strict';

const MAX_LEN = 6;
const DEFAULT_MASK = 'LLLLLL';

const CLASS_CHARSETS = {
  L: 'abcdefghijklmnopqrstuvwxyz',
  U: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  D: '0123456789',
  S: '!@#$%^&*',
};

function classifyChar(ch) {
  if (/[a-z]/.test(ch)) return 'L';
  if (/[A-Z]/.test(ch)) return 'U';
  if (/[0-9]/.test(ch)) return 'D';
  return 'S';
}

// Per-position character-class template, e.g. "Wolf42" -> "ULLLDD". This is
// how real mask attacks work (hashcat's ?l?u?d?s syntax): iterate the actual
// class-per-position space, not real dictionary words, so this mirrors the
// real technique rather than faking it with random wordlist entries.
function buildMask(password) {
  const str = typeof password === 'string' ? password.slice(0, MAX_LEN) : '';
  const mask = str.split('').map(classifyChar).join('') || DEFAULT_MASK;
  // Defense in depth: the class template is derived character-by-character
  // from the real password, so a pathological input (e.g. "UUUUUU", where
  // every char IS its own class letter) could make the template equal the
  // password itself. Never let a value that could reveal the password ride
  // along on the plan — fall back to a generic shape instead.
  return mask === str ? DEFAULT_MASK : mask;
}

function generateFromMask(mask, randomFn) {
  const template = typeof mask === 'string' && mask.length > 0 ? mask : DEFAULT_MASK;
  return template
    .split('')
    .map((cls) => {
      const charset = CLASS_CHARSETS[cls] || CLASS_CHARSETS.L;
      const index = Math.min(charset.length - 1, Math.floor(randomFn() * charset.length));
      return charset[index];
    })
    .join('');
}

module.exports = { buildMask, generateFromMask, classifyChar, CLASS_CHARSETS, DEFAULT_MASK };
