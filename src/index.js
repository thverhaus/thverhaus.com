import { DurableObject } from "cloudflare:workers";

// Parakóði: stafróf án stafa sem er auðvelt að rugla saman (0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_FIELD = 2048;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function randomCode() {
  // 248 er stærsta margfeldi af 31 sem kemst í bæti, svo dreifingin sé jöfn.
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 248 && code.length < CODE_LENGTH) code += ALPHABET[byte % 31];
    }
  }
  return code;
}

function randomSecret() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeCode(raw) {
  const code = decodeURIComponent(raw).toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

function text(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return required ? null : "";
  }
  if (typeof value !== "string" || value.length > MAX_FIELD) return null;
  return value.trim();
}

function httpUrl(value, options) {
  const clean = text(value, options);
  if (clean === null || clean === "") return clean;
  try {
    const { protocol } = new URL(clean);
    return protocol === "http:" || protocol === "https:" ? clean : null;
  } catch {
    return null;
  }
}

function validatePayload(input) {
  if (!input || typeof input !== "object") return null;
  const name = text(input.name);
  const epgUrl = httpUrl(input.epgUrl);
  if (name === null || epgUrl === null) return null;

  if (input.type === "m3u") {
    const url = httpUrl(input.url, { required: true });
    return url ? { type: "m3u", name, url, epgUrl } : null;
  }
  if (input.type === "xtream") {
    const server = httpUrl(input.server, { required: true });
    const username = text(input.username, { required: true });
    const password = text(input.password, { required: true });
    return server && username && password
      ? { type: "xtream", name, server, username, password, epgUrl }
      : null;
  }
  return null;
}

function slot(env, code) {
  return env.PAIRING.get(env.PAIRING.idFromName(code));
}

async function createPair(env) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const secret = randomSecret();
    const expiresAt = Date.now() + TTL_MS;
    if (await slot(env, code).create(await sha256(secret), expiresAt)) {
      return json({ code, secret, expiresInSeconds: TTL_MS / 1000 }, 201);
    }
  }
  return json({ error: "busy" }, 503);
}

async function submitPair(request, env, code) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const payload = validatePayload(parsed);
  if (!payload) return json({ error: "invalid" }, 400);

  const result = await slot(env, code).submit(payload);
  if (result === "ok") return json({ ok: true });
  return json({ error: result }, result === "used" ? 409 : 404);
}

async function takePair(request, env, code) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer ([0-9a-f]{64})$/);
  if (!match) return json({ error: "forbidden" }, 403);

  const result = await slot(env, code).take(await sha256(match[1]));
  if (result.status === "pending") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (result.status === "ready") return json(result.payload);
  return json({ error: result.status }, result.status === "forbidden" ? 403 : 404);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/pair") {
      return request.method === "POST" ? createPair(env) : json({ error: "method" }, 405);
    }

    const match = pathname.match(/^\/api\/pair\/([^/]+)$/);
    if (match) {
      let code = null;
      try {
        code = normalizeCode(match[1]);
      } catch {
        code = null;
      }
      if (!code) return json({ error: "not_found" }, 404);
      if (request.method === "PUT") return submitPair(request, env, code);
      if (request.method === "GET") return takePair(request, env, code);
      return json({ error: "method" }, 405);
    }

    return json({ error: "not_found" }, 404);
  },
};

// Eitt hólf fyrir hvern kóða. Durable Object tryggir að kóði sé aðeins notaður einu sinni.
export class PairingSlot extends DurableObject {
  async load() {
    const state = await this.ctx.storage.get("state");
    if (state && state.expiresAt <= Date.now()) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return state || null;
  }

  async create(secretHash, expiresAt) {
    if (await this.load()) return false;
    await this.ctx.storage.put("state", { secretHash, expiresAt, payload: null });
    await this.ctx.storage.setAlarm(expiresAt);
    return true;
  }

  async submit(payload) {
    const state = await this.load();
    if (!state) return "not_found";
    if (state.payload) return "used";
    await this.ctx.storage.put("state", { ...state, payload });
    return "ok";
  }

  async take(secretHash) {
    const state = await this.load();
    if (!state) return { status: "not_found" };
    if (state.secretHash !== secretHash) return { status: "forbidden" };
    if (!state.payload) return { status: "pending" };
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    return { status: "ready", payload: state.payload };
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
