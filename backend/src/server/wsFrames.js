'use strict';

/**
 * Minimal RFC 6455 WebSocket framing — dependency-free (npm registry is not
 * reachable from the dev sandbox, and the kiosk deployment has no internet
 * dependency anyway).
 *
 * Scope: exactly what the crack-session stream needs.
 * - Server → client: unmasked text frames, close frames, pong.
 * - Client → server: masked frames are unmasked and parsed (text, close, ping).
 * - No fragmentation support (all our messages are small single frames; a
 *   fragmented client frame is treated as a protocol error by the caller).
 */

const crypto = require('node:crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODES = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

/** Sec-WebSocket-Accept value for a handshake key. */
function acceptKey(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(secWebSocketKey + WS_GUID)
    .digest('base64');
}

/**
 * Encode a frame. Server frames are unmasked; pass `mask: true` for
 * client-side frames (used by tests acting as a browser client).
 */
function encodeFrame(opcode, payload, { mask = false } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
  const len = data.length;

  let headerLen = 2;
  if (len >= 126 && len <= 0xffff) headerLen += 2;
  else if (len > 0xffff) headerLen += 8;
  if (mask) headerLen += 4;

  const frame = Buffer.alloc(headerLen + len);
  frame[0] = 0x80 | opcode; // FIN + opcode

  let offset = 2;
  if (len < 126) {
    frame[1] = len;
  } else if (len <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }

  if (mask) {
    frame[1] |= 0x80;
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i += 1) {
      frame[offset + i] = data[i] ^ maskKey[i % 4];
    }
  } else {
    data.copy(frame, offset);
  }

  return frame;
}

function encodeText(text, opts) {
  return encodeFrame(OPCODES.TEXT, text, opts);
}

function encodeClose(code = 1000, reason = '', opts) {
  const reasonBuf = Buffer.from(reason, 'utf8');
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  return encodeFrame(OPCODES.CLOSE, payload, opts);
}

function encodePong(payload = Buffer.alloc(0), opts) {
  return encodeFrame(OPCODES.PONG, payload, opts);
}

/**
 * Incremental frame parser. Feed it socket chunks; it emits complete frames
 * as { opcode, payload (Buffer), closeCode?, closeReason? }.
 */
class FrameParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /** @returns {Array<{opcode:number, payload:Buffer, closeCode?:number, closeReason?:string}>} */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];

    for (;;) {
      const frame = this._tryParseOne();
      if (!frame) break;
      frames.push(frame);
    }
    return frames;
  }

  _tryParseOne() {
    const buf = this.buffer;
    if (buf.length < 2) return null;

    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (buf.length < offset + 2) return null;
      payloadLen = buf.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('frame too large');
      payloadLen = Number(big);
      offset += 8;
    }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + payloadLen) return null;

    let payload = Buffer.from(buf.subarray(offset, offset + payloadLen));
    if (maskKey) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= maskKey[i % 4];
      }
    }

    this.buffer = buf.subarray(offset + payloadLen);

    const frame = { opcode, payload };
    if (opcode === OPCODES.CLOSE && payload.length >= 2) {
      frame.closeCode = payload.readUInt16BE(0);
      frame.closeReason = payload.subarray(2).toString('utf8');
    }
    return frame;
  }
}

module.exports = {
  OPCODES,
  acceptKey,
  encodeFrame,
  encodeText,
  encodeClose,
  encodePong,
  FrameParser,
};
