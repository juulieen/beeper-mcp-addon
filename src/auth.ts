/**
 * Token storage and OAuth login against Beeper Desktop's local OAuth server
 * (authorization code + PKCE, dynamic client registration).
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import type { AddressInfo } from "node:net";
import { backend, deleteSecret, describe, readSecret, saveSecret } from "./secret-store.js";

export const BASE_URL = (process.env.BEEPER_URL ?? "http://localhost:23373").replace(/\/$/, "");

export { TOKEN_FILE } from "./secret-store.js";

type StoredToken = { access_token: string; scope?: string; client_id?: string; base_url?: string; created_at?: string };

const parse = (raw?: string) => {
  if (!raw) return undefined;
  try {
    return raw.startsWith("{") ? (JSON.parse(raw) as StoredToken).access_token : raw;
  } catch {
    return undefined;
  }
};

/** BEEPER_ACCESS_TOKEN wins; otherwise the token saved by `beeper-mcp-addon login` in the OS secret store. */
export async function getToken(explicitFile?: string): Promise<string | undefined> {
  if (explicitFile) return parse((await readFile(explicitFile, "utf8").catch(() => "")).trim());
  if (process.env.BEEPER_ACCESS_TOKEN?.trim()) return process.env.BEEPER_ACCESS_TOKEN.trim();
  return parse(await readSecret());
}

export { describe as describeBackend, backend } from "./secret-store.js";

export const NO_TOKEN_HELP =
  "No Beeper token found. Run `npx beeper-mcp-addon login` (opens Beeper to approve access),\n" +
  "or set BEEPER_ACCESS_TOKEN to a token from Beeper Desktop > Settings > Developers.";

const b64url = (buf: Buffer) => buf.toString("base64url");

const escapeHTML = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function openBrowser(url: string) {
  // No shell anywhere: on Windows, `cmd /c start` would split the URL at each "&".
  const [cmd, args] =
    platform() === "darwin" ? ["open", [url]] : platform() === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function login({ scope = "read write", timeoutMs = 5 * 60_000 } = {}) {
  // 1. Local callback server on a random port.
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => ((resolveCode = res), (rejectCode = rej)));

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") return void res.writeHead(404).end();
    // Anything without our state is not Beeper answering this login: ignore it, don't fail the login.
    if (url.searchParams.get("state") !== state) return void res.writeHead(404).end();
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const ok = !error && code;
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>beeper-mcp-addon</title>` +
        `<body style="font:16px system-ui;padding:3rem;text-align:center">` +
        (ok ? "<h2>✅ Connected to Beeper</h2><p>You can close this tab.</p>" : `<h2>❌ Authorization failed</h2><p>${escapeHTML(error ?? "invalid response")}</p>`),
    );
    if (ok) resolveCode(code!);
    else rejectCode(new Error(`Authorization failed: ${error ?? "missing code"}`));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirectURI = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;

  try {
    // 2. Register this CLI as a public OAuth client.
    const client = await postJSON<{ client_id: string }>(`${BASE_URL}/oauth/register`, {
      client_name: "beeper-mcp-addon",
      client_uri: "https://github.com/juulieen/beeper-mcp-addon",
      redirect_uris: [redirectURI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope,
    });

    // 3. Send the user to Beeper to approve.
    const authURL = new URL(`${BASE_URL}/oauth/authorize`);
    for (const [k, v] of Object.entries({
      client_id: client.client_id,
      redirect_uri: redirectURI,
      response_type: "code",
      scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }))
      authURL.searchParams.set(k, v);

    console.error(`Opening Beeper to approve access (${scope})…\nIf nothing opens, visit:\n\n  ${authURL}\n`);
    openBrowser(authURL.toString());

    const timer = setTimeout(() => rejectCode(new Error("Timed out waiting for approval.")), timeoutMs);
    const code = await codePromise.finally(() => clearTimeout(timer));

    // 4. Exchange the code for a token.
    const res = await fetch(`${BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        redirect_uri: redirectURI,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
    const token = (await res.json()) as { access_token: string; scope?: string };

    // 5. Save it in the OS secret store.
    const stored: StoredToken = {
      access_token: token.access_token,
      scope: token.scope ?? scope,
      client_id: client.client_id,
      base_url: BASE_URL,
      created_at: new Date().toISOString(),
    };
    const where = describe(await saveSecret(JSON.stringify(stored)));
    return { ...stored, where };
  } finally {
    server.close();
  }
}

export async function logout() {
  const token = parse(await readSecret());
  if (token) {
    await fetch(`${BASE_URL}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }).catch(() => {});
  }
  await deleteSecret();
  return Boolean(token);
}

export async function status() {
  const token = await getToken();
  if (!token) return { loggedIn: false as const };
  const res = await fetch(`${BASE_URL}/oauth/introspect`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
  const info = res?.ok ? ((await res.json()) as { active?: boolean; scope?: string }) : undefined;
  return {
    loggedIn: true as const,
    source: process.env.BEEPER_ACCESS_TOKEN?.trim() ? "BEEPER_ACCESS_TOKEN" : describe(await backend()),
    active: info?.active,
    scope: info?.scope,
    reachable: Boolean(res),
  };
}
