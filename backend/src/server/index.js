'use strict';

const { createServer } = require('./httpServer');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer();

server.listen(PORT, HOST, () => {
  // No password data is ever logged — this is the only log line.
  console.log(`Operation Vault Breach backend listening on http://${HOST}:${PORT}`);
});
