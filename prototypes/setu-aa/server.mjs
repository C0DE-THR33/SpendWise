// Setu AA sandbox probe — one file, no dependencies, nothing but the AA.
//
// Answers two questions and nothing else:
//   1. Does data actually come through the Setu sandbox?
//   2. What does it look like when it reaches us — on every channel it can
//      arrive by (API response, browser redirect, webhook)?
//
// No database, no parsing, no app code. Every outbound call and every
// inbound hit is shown raw on the page and appended to log.jsonl next to
// this file.
//
// Run:
//   node prototypes/setu-aa/server.mjs        then open http://localhost:4200
//
// Credentials come from the repo's .env (SETU_CLIENT_ID, SETU_CLIENT_SECRET,
// SETU_PRODUCT_INSTANCE_ID). SETU_AA_BASE_URL there is deliberately ignored —
// it usually points at the local mock, and this probe exists to talk to the
// real sandbox. Override with SETU_PROBE_BASE_URL if you really mean to.
//
// Webhooks: Setu can only reach /webhook on a public URL. Run a tunnel
// (e.g. `cloudflared tunnel --url http://localhost:4200`) and set
// <tunnel>/webhook as the notification URL on the Bridge. Without that, the
// API responses and the redirect still show everything; webhooks just won't
// appear.

import { createServer } from "node:http";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(HERE, "..", "..", ".env");
const LOG_FILE = join(HERE, "log.jsonl");
const PORT = Number(process.env.PORT ?? 4200);

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const BASE_URL = (process.env.SETU_PROBE_BASE_URL ?? "https://fiu-sandbox.setu.co").replace(/\/+$/, "");
// The live sandbox only serves these under /v2; the unversioned path 401s
// with valid credentials (see src/lib/setu.ts).
const API = `${BASE_URL}/v2`;

const creds = {
  "x-client-id": process.env.SETU_CLIENT_ID ?? "",
  "x-client-secret": process.env.SETU_CLIENT_SECRET ?? "",
  "x-product-instance-id": process.env.SETU_PRODUCT_INSTANCE_ID ?? "",
};
const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k);

// --- state (in memory; the log file is the durable record) ----------------

const events = []; // newest first
const consentRanges = new Map(); // consentId -> { from, to } it was raised with
let last = { consentId: "", sessionId: "", approvalUrl: "" };

function record(kind, detail) {
  const event = { at: new Date().toISOString(), kind, ...detail };
  events.unshift(event);
  appendFileSync(LOG_FILE, JSON.stringify(event) + "\n");
  console.log(`[${event.at}] ${kind}${detail.status ? ` → ${detail.status}` : ""}`);
  return event;
}

// --- Setu calls ------------------------------------------------------------

async function setu(method, path, body) {
  const started = Date.now();
  let status = 0;
  let response;
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...creds },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    try {
      response = JSON.parse(text);
    } catch {
      response = text;
    }
  } catch (error) {
    response = { networkError: String(error) };
  }
  record("setu-call", {
    request: { method, url: `${API}${path}`, body },
    status,
    ms: Date.now() - started,
    response,
  });
  return { status, response };
}

function monthsAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setMonth(d.getMonth() - n);
  return d;
}

async function raiseConsent(mobile, origin) {
  const digits = mobile.replace(/\D/g, "").slice(-10);
  const range = { from: monthsAgo(12).toISOString(), to: new Date().toISOString() };
  const { response } = await setu("POST", "/consents", {
    consentDuration: { unit: "MONTH", value: "12" },
    vua: digits,
    dataRange: range,
    redirectUrl: `${origin}/redirect`,
  });
  if (response?.id) {
    consentRanges.set(response.id, range);
    last.consentId = response.id;
    last.approvalUrl = response.url ?? "";
  }
}

async function createSession(consentId) {
  // A session's range must sit inside the consent's. Prefer what the gateway
  // says the consent covers, then what we raised it with, then a guess.
  const { response: consent } = await setu("GET", `/consents/${encodeURIComponent(consentId)}?expanded=true`);
  const range =
    consent?.detail?.dataRange ??
    consent?.dataRange ??
    consentRanges.get(consentId) ?? { from: monthsAgo(6).toISOString(), to: new Date().toISOString() };

  const { response } = await setu("POST", "/sessions", {
    consentId,
    dataRange: { from: range.from, to: range.to },
    format: "json",
  });
  if (response?.id) last.sessionId = response.id;
}

// --- HTTP ------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
  });
}

function redirectHome(res) {
  res.writeHead(303, { Location: "/" });
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const origin = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;

  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page());
    }

    if (req.method === "GET" && url.pathname === "/events.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(events, null, 2));
    }

    // Where Setu sends the browser back after the approval screens.
    if (req.method === "GET" && url.pathname === "/redirect") {
      record("inbound-redirect", { query: Object.fromEntries(url.searchParams) });
      const id = url.searchParams.get("id");
      if (id) last.consentId = id;
      return redirectHome(res);
    }

    // Setu's notifications (CONSENT_STATUS_UPDATE, SESSION_STATUS_UPDATE…).
    if (req.method === "POST" && url.pathname === "/webhook") {
      const raw = await readBody(req);
      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {}
      record("inbound-webhook", { headers: req.headers, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end('{"success":true}');
    }

    if (req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const value = (form.get("value") ?? "").trim();

      if (url.pathname === "/consent" && value) await raiseConsent(value, origin);
      else if (url.pathname === "/consent-status" && value)
        await setu("GET", `/consents/${encodeURIComponent(value)}?expanded=true`);
      else if (url.pathname === "/session" && value) await createSession(value);
      else if (url.pathname === "/session-status" && value)
        await setu("GET", `/sessions/${encodeURIComponent(value)}`);
      else if (url.pathname === "/clear") events.length = 0;

      return redirectHome(res);
    }

    res.writeHead(404);
    res.end("not found");
  } catch (error) {
    record("probe-error", { error: String(error?.stack ?? error) });
    redirectHome(res);
  }
});

// --- page ------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function summary(e) {
  if (e.kind === "setu-call") return `${e.request.method} ${e.request.url.replace(API, "")} → ${e.status} (${e.ms} ms)`;
  if (e.kind === "inbound-redirect") return `browser came back: ${new URLSearchParams(e.query)}`;
  if (e.kind === "inbound-webhook") return `webhook: ${e.body?.type ?? "(no type)"}`;
  return e.kind;
}

function form(action, label, value, placeholder) {
  return `<form method="post" action="${action}">
    <input name="value" value="${esc(value)}" placeholder="${placeholder}">
    <button>${label}</button></form>`;
}

function page() {
  const banner = missing.length
    ? `<p class="bad">Missing in .env: ${missing.join(", ")}</p>`
    : "";
  const approve = last.approvalUrl
    ? `<p>Approve here → <a href="${esc(last.approvalUrl)}" target="_blank">${esc(last.approvalUrl)}</a></p>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Setu AA probe</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:14px/1.45 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;background:#fafafa;color:#111}
  code,pre{font:12px ui-monospace,Consolas,monospace}
  pre{background:#fff;border:1px solid #ddd;padding:10px;overflow:auto;max-height:480px;margin:6px 0 0}
  form{display:flex;gap:8px;margin:6px 0}
  input{flex:1;padding:6px 8px;font:inherit}
  button{padding:6px 12px;font:inherit;cursor:pointer}
  .steps{background:#fff;border:1px solid #ddd;padding:12px 16px}
  details{border-bottom:1px solid #e5e5e5;padding:8px 0}
  summary{cursor:pointer}
  .t{color:#888}.bad{color:#b00020;font-weight:600}
  .k-setu-call{color:#0b57d0}.k-inbound-redirect,.k-inbound-webhook{color:#137333;font-weight:600}.k-probe-error{color:#b00020}
</style></head><body>
<h1>Setu AA probe</h1>
<p>Talking to <code>${esc(API)}</code></p>${banner}
<div class="steps">
  <b>1. Raise a consent</b> (mobile number)${form("/consent", "Create consent", "9999999999", "mobile")}
  ${approve}
  <b>2. Read the consent back</b>, after approving${form("/consent-status", "Get consent", last.consentId, "consent id")}
  <b>3. Ask for the data</b> (creates a data session)${form("/session", "Create session", last.consentId, "consent id")}
  <b>4. Read the data</b>, repeat until COMPLETED / PARTIAL${form("/session-status", "Get session", last.sessionId, "session id")}
</div>
<h2>What came through <small class="t">(newest first, also in prototypes/setu-aa/log.jsonl)</small></h2>
<form method="post" action="/clear"><button>Clear</button><a href="/events.json" style="margin-left:auto">raw JSON</a></form>
${
  events.length
    ? events
        .map(
          (e, i) => `<details${i === 0 ? " open" : ""}><summary><span class="t">${e.at.slice(11, 19)}</span>
  <span class="k-${e.kind}">${esc(summary(e))}</span></summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details>`,
        )
        .join("")
    : "<p class='t'>Nothing yet.</p>"
}
</body></html>`;
}

server.listen(PORT, () => {
  console.log(`Setu AA probe on http://localhost:${PORT}  →  ${API}`);
  if (missing.length) console.warn(`Missing in .env: ${missing.join(", ")}`);
});
