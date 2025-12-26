const http = require("http");
const net = require("net");

const REDIS_HOST = process.env.REDIS_HOST || "redis";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const SCORE_SET_KEY = process.env.SCORE_SET_KEY || "flappy:scores";
const PORT = Number(process.env.PORT || 8080);
const TOP_LIMIT = 5;

function encodeCommand(args) {
  return `*${args.length}\r\n${args
    .map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`)
    .join("")}`;
}

function parseRESP(input, offset = 0) {
  if (offset >= input.length) {
    return null;
  }
  const type = input[offset];
  const lineEnd = input.indexOf("\r\n", offset);
  if (lineEnd === -1) {
    return null;
  }

  if (type === "+" || type === "-") {
    const value = input.slice(offset + 1, lineEnd);
    return { value, offset: lineEnd + 2 };
  }

  if (type === ":") {
    const value = Number(input.slice(offset + 1, lineEnd));
    return { value, offset: lineEnd + 2 };
  }

  if (type === "$") {
    const len = Number(input.slice(offset + 1, lineEnd));
    if (len === -1) {
      return { value: null, offset: lineEnd + 2 };
    }
    const start = lineEnd + 2;
    const end = start + len;
    if (input.length < end + 2) {
      return null;
    }
    const value = input.slice(start, end);
    return { value, offset: end + 2 };
  }

  if (type === "*") {
    const count = Number(input.slice(offset + 1, lineEnd));
    if (count === -1) {
      return { value: null, offset: lineEnd + 2 };
    }
    let cursor = lineEnd + 2;
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const parsed = parseRESP(input, cursor);
      if (!parsed) {
        return null;
      }
      items.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: items, offset: cursor };
  }

  return null;
}

function redisCommand(args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: REDIS_HOST, port: REDIS_PORT }, () => {
      socket.write(encodeCommand(args));
    });

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const parsed = parseRESP(buffer);
      if (!parsed) {
        return;
      }
      socket.end();
      resolve(parsed.value);
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

function normalizeName(name) {
  const clean = String(name || "").trim().slice(0, 16);
  return clean || "Player";
}

function toScoreList(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const scores = [];
  for (let i = 0; i < raw.length; i += 2) {
    const entry = raw[i];
    const score = Number(raw[i + 1]);
    if (typeof entry === "string" && Number.isFinite(score)) {
      scores.push({ name: entry, score });
    }
  }
  return scores;
}

function createScoreService(redis) {
  async function getTopScores(limit = TOP_LIMIT) {
    const raw = await redis(["ZREVRANGE", SCORE_SET_KEY, 0, limit - 1, "WITHSCORES"]);
    return toScoreList(raw);
  }

  async function submitScore(name, score) {
    await redis(["ZADD", SCORE_SET_KEY, "GT", String(score), name]);
    const scores = await getTopScores(TOP_LIMIT);
    return scores;
  }

  async function getBestScore() {
    const scores = await getTopScores(1);
    return scores.length ? scores[0].score : 0;
  }

  return { getTopScores, submitScore, getBestScore };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (err) {
        reject(err);
      }
    });
  });
}

const scoreService = createScoreService(redisCommand);

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/score") {
    try {
      const best = await scoreService.getBestScore();
      sendJson(res, 200, { best });
    } catch (err) {
      sendJson(res, 500, { error: "redis_unavailable" });
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/scores") {
    try {
      const scores = await scoreService.getTopScores(TOP_LIMIT);
      const best = scores.length ? scores[0].score : 0;
      sendJson(res, 200, { best, scores });
    } catch (err) {
      sendJson(res, 500, { error: "redis_unavailable" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/score") {
    try {
      const data = await readJson(req);
      const score = Number(data.score);
      if (!Number.isFinite(score) || score < 0) {
        sendJson(res, 400, { error: "invalid_score" });
        return;
      }
      const name = normalizeName(data.name);
      const scores = await scoreService.submitScore(name, score);
      const best = scores.length ? scores[0].score : 0;
      sendJson(res, 200, { best, scores });
    } catch (err) {
      sendJson(res, 400, { error: "invalid_json" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/scores") {
    try {
      const data = await readJson(req);
      const score = Number(data.score);
      if (!Number.isFinite(score) || score < 0) {
        sendJson(res, 400, { error: "invalid_score" });
        return;
      }
      const name = normalizeName(data.name);
      const scores = await scoreService.submitScore(name, score);
      const best = scores.length ? scores[0].score : 0;
      sendJson(res, 200, { best, scores });
    } catch (err) {
      sendJson(res, 400, { error: "invalid_json" });
    }
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(PORT, () => {
  console.log(`score-api listening on ${PORT}`);
});
