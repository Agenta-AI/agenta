// POST /api/license-registrations: a self-hosted instance asks for a free
// registration key. The worker signs a `self_hosted_registered` license key for
// the email and sends it with the activation link. It stores nothing; the mail
// provider keeps the email it sends.
//
// Worker secrets (set with `wrangler secret put`, never committed):
//   LICENSE_SIGNING_KEY  Ed25519 private key, PKCS#8 PEM
//   LOOPS_API_KEY        Loops API key for the transactional email

export const REGISTRATION_PATH = "/api/license-registrations";

const KEY_PREFIX = "agenta_license_v1";
const REGISTERED_PLAN = "self_hosted_registered";

// The Loops transactional email that carries the key. Create it in Loops with the
// data variables `licenseKey` and `activationUrl`, then put its id here.
const LOOPS_TRANSACTIONAL_ID = "REPLACE_WITH_LOOPS_TRANSACTIONAL_ID";
const LOOPS_URL = "https://app.loops.so/api/v1/transactional";

/** A Workers rate limit binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RegistrationEnv {
  LICENSE_SIGNING_KEY?: string;
  LOOPS_API_KEY?: string;
  REGISTRATION_IP_LIMIT?: RateLimiter;
  REGISTRATION_EMAIL_LIMIT?: RateLimiter;
}

// The body is four short fields; anything larger is not a registration.
const MAX_BODY_BYTES = 2048;

export interface RegistrationEmail {
  to: string;
  licenseKey: string;
  activationUrl: string;
}

export interface MailSender {
  send(email: RegistrationEmail): Promise<void>;
}

export interface Registration {
  email: string;
  instance_id: string;
  agenta_version: string;
  web_url: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^v\d+\.\d+\.\d+\S*$/;

/** The registration in the body, or null when a field is missing or wrong. */
export function parseRegistration(body: unknown): Registration | null {
  if (!body || typeof body !== "object") return null;
  const { email, instance_id, agenta_version, web_url } = body as Record<
    string,
    unknown
  >;
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !EMAIL.test(email) ||
    typeof instance_id !== "string" ||
    !UUID.test(instance_id) ||
    typeof agenta_version !== "string" ||
    !VERSION.test(agenta_version) ||
    typeof web_url !== "string" ||
    web_url.length > 512 ||
    !isHttpUrl(web_url)
  ) {
    return null;
  }
  return { email, instance_id, agenta_version, web_url };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/** A license key in the format the API checks: `agenta_license_v1.<payload>.<signature>`. */
export async function signRegistrationKey(
  privateKeyPem: string,
  email: string,
  now: Date = new Date(),
): Promise<string> {
  const payload = {
    key_id: crypto.randomUUID(),
    plan: REGISTERED_PLAN,
    customer: email,
    seats: null,
    issued_at: now.toISOString(),
    expires_at: null,
    telemetry: "required",
  };
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(body),
  );
  return `${KEY_PREFIX}.${body}.${base64url(new Uint8Array(signature))}`;
}

export function activationUrl(webUrl: string, licenseKey: string): string {
  return `${webUrl.replace(/\/+$/, "")}/m/settings?tab=license#key=${licenseKey}`;
}

export function loopsMailSender(apiKey: string): MailSender {
  return {
    async send(email) {
      const response = await fetch(LOOPS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionalId: LOOPS_TRANSACTIONAL_ID,
          email: email.to,
          // The person asked for product updates when they registered.
          addToAudience: true,
          dataVariables: {
            licenseKey: email.licenseKey,
            activationUrl: email.activationUrl,
          },
        }),
      });
      if (!response.ok) throw new Error(`Loops answered ${response.status}`);
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function error(status: number, code: string, message: string): Response {
  return json(status, { error: { code, status, message } });
}

/** The body text, or null when it is larger than `MAX_BODY_BYTES`. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function allowed(limiter: RateLimiter, key: string): Promise<boolean> {
  return (await limiter.limit({ key })).success;
}

const TOO_MANY = () =>
  error(429, "too_many_requests", "Too many registrations. Try again later.");

export async function handleRegistration(
  request: Request,
  env: RegistrationEnv,
  mailSender?: MailSender,
): Promise<Response> {
  // A limiter or body read that throws must still answer the JSON error, not a platform page.
  try {
    return await register(request, env, mailSender);
  } catch {
    return error(503, "unavailable", "Registration is not available.");
  }
}

async function register(
  request: Request,
  env: RegistrationEnv,
  mailSender?: MailSender,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const ipLimit = env.REGISTRATION_IP_LIMIT;
  const emailLimit = env.REGISTRATION_EMAIL_LIMIT;
  // A missing binding is a deploy mistake; refuse rather than run without a limit.
  if (!ipLimit || !emailLimit) {
    return error(503, "unavailable", "Registration is not available.");
  }
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await allowed(ipLimit, ip))) return TOO_MANY();

  const text = await readBody(request);
  if (text === null) {
    return error(413, "body_too_large", "The registration is too large.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const registration = parseRegistration(body);
  if (!registration) {
    return error(400, "invalid_registration", "The registration is not valid.");
  }
  const emailKey = registration.email.toLowerCase();
  if (!(await allowed(emailLimit, emailKey))) {
    return TOO_MANY();
  }

  const sender =
    mailSender ??
    (env.LOOPS_API_KEY ? loopsMailSender(env.LOOPS_API_KEY) : null);
  if (!env.LICENSE_SIGNING_KEY || !sender) {
    return error(503, "unavailable", "Registration is not available.");
  }

  let licenseKey: string;
  try {
    licenseKey = await signRegistrationKey(
      env.LICENSE_SIGNING_KEY,
      registration.email,
    );
  } catch {
    return error(503, "unavailable", "Registration is not available.");
  }
  try {
    await sender.send({
      to: registration.email,
      licenseKey,
      activationUrl: activationUrl(registration.web_url, licenseKey),
    });
  } catch {
    return error(502, "mail_failed", "The email could not be sent.");
  }

  return json(202, {});
}
