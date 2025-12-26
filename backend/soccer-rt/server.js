const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8080);
const MAX_CLIENTS = 2;

const rooms = new Map();

function createRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

function createAcceptKey(key) {
  return crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function encodeFrame(payload, opcode = 1) {
  const data = Buffer.from(payload);
  const len = data.length;
  const head = [];
  head.push(0x80 | opcode);
  if (len < 126) {
    head.push(len);
  } else if (len < 65536) {
    head.push(126, (len >> 8) & 0xff, len & 0xff);
  } else {
    head.push(127, 0, 0, 0, 0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
  }
  return Buffer.concat([Buffer.from(head), data]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }
  const byte1 = buffer[0];
  const byte2 = buffer[1];
  const opcode = byte1 & 0x0f;
  const masked = (byte2 & 0x80) === 0x80;
  let len = byte2 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    len = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) {
      return null;
    }
    len = low;
    offset += 8;
  }

  const maskOffset = masked ? 4 : 0;
  if (buffer.length < offset + maskOffset + len) {
    return null;
  }

  let payload = buffer.slice(offset + maskOffset, offset + maskOffset + len);
  if (masked) {
    const mask = buffer.slice(offset, offset + 4);
    const decoded = Buffer.alloc(len);
    for (let i = 0; i < len; i += 1) {
      decoded[i] = payload[i] ^ mask[i % 4];
    }
    payload = decoded;
  }

  return {
    opcode,
    payload,
    length: offset + maskOffset + len,
  };
}

function sendJson(socket, data) {
  socket.write(encodeFrame(JSON.stringify(data)));
}

function broadcast(room, data, except) {
  room.clients.forEach((client) => {
    if (client !== except) {
      sendJson(client.socket, data);
    }
  });
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { id: roomId, clients: [] });
  }
  return rooms.get(roomId);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("soccer-rt online");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  let roomId = url.searchParams.get("room");
  if (!roomId) {
    roomId = createRoomId();
  }

  const room = getRoom(roomId);
  if (room.clients.length >= MAX_CLIENTS) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    socket.destroy();
    return;
  }

  const role = room.clients.length === 0 ? "host" : "guest";
  const acceptKey = createAcceptKey(key);

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n",
    ].join("\r\n")
  );

  const client = { socket, role, roomId, buffer: Buffer.alloc(0) };
  room.clients.push(client);

  sendJson(socket, { type: "welcome", role, roomId, peers: room.clients.length - 1 });
  broadcast(room, { type: "peer", status: "joined" }, client);

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length) {
      const frame = decodeFrame(client.buffer);
      if (!frame) {
        break;
      }
      client.buffer = client.buffer.slice(frame.length);

      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(frame.payload, 0x0a));
        continue;
      }
      if (frame.opcode !== 0x1) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(frame.payload.toString("utf8"));
      } catch (err) {
        continue;
      }

      if (message.type === "input" && client.role === "guest") {
        broadcast(room, { type: "input", input: message.input || {} }, client);
      }
      if (message.type === "state" && client.role === "host") {
        broadcast(room, { type: "state", state: message.state || {} }, client);
      }
    }
  });

  socket.on("close", () => {
    const roomNow = rooms.get(roomId);
    if (!roomNow) {
      return;
    }
    roomNow.clients = roomNow.clients.filter((entry) => entry !== client);
    broadcast(roomNow, { type: "peer", status: "left" });
    if (roomNow.clients.length === 0) {
      rooms.delete(roomId);
    }
  });

  socket.on("error", () => {
    socket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`soccer-rt listening on ${PORT}`);
});
