'use strict';

// Dev 3's real ledger is in prizeLedger.js. Re-export everything so existing
// call sites (server, tests) keep their import paths and signatures unchanged.
const ledger = require('./prizeLedger');

module.exports = {
  generatePrizeCode: ledger.generatePrizeCode,
  redeemCode: ledger.redeemCode,
  getLedger: ledger.getLedger,
  getLeaderboard: ledger.getLeaderboard,
  // Backward-compat alias: prizeCode.test.js calls resetIssuedCodes().
  resetIssuedCodes: ledger.resetLedger,
  resetLedger: ledger.resetLedger,
  PREFIX: ledger.PREFIX,
  CODE_LENGTH: ledger.CODE_LENGTH,
  ALPHABET: ledger.ALPHABET,
};
