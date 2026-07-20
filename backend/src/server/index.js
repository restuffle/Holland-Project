'use strict';

const { createServer } = require('./httpServer');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer({ adminToken: process.env.ADMIN_TOKEN });

server.listen(PORT, HOST, () => {
  // No password data is ever logged — this is the only log line, plus the
  // one below. The admin token gates /admin/* (ledger, leaderboard, redeem);
  // give it to prize-table staff only, don't post it anywhere public.
  console.log(`Operation Vault Breach backend listening on http://${HOST}:${PORT}`);
  console.log(`Admin dashboard token (staff only): ${server.adminToken}`);
});
