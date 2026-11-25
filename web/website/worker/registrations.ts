// POST /api/license-registrations: a self-hosted instance asks for a free
// registration key. The worker signs a `self_hosted_registered` license key for
// the email and sends it with the activation link. It stores nothing itself; Loops
// keeps the contact, marked as a self-hosted registration.
//
// Worker secrets (set with `wrangler secret put`, never committed):
//   LICENSE_SIGNING_KEY  Ed25519 private key of the registration key pair, PKCS#8 PEM
//   LOOPS_API_KEY        Loops API key for the transactional email
// Worker variable (`vars` in both wrangler configs, not secret):
//   LOOPS_TRANSACTIONAL_ID  id of the Loops transactional email that carries the key
//   LOOPS_PRODUCT_UPDATES_LIST_ID  id of the Loops mailing list for product updates;
//                                  empty, the contact joins no list

export const REGISTRATION_PATH = "/api/license-registrations";

const KEY_PREFIX = "agenta_license_v1";
const REGISTERED_PLAN = "self_hosted_registered";

// The id the API knows the registration key pair by (`SIGNING_KEYS` in
// api/ee/src/core/licenses/keys.py). The API accepts that key pair only for
// `self_hosted_registered`. Change it together with LICENSE_SIGNING_KEY when the key
// pair rotates.
export const REGISTRATION_SIGNING_KEY_ID = "registration-1";

const LOOPS_URL = "https://app.loops.so/api/v1/transactional";
const LOOPS_CONTACT_URL = "https://app.loops.so/api/v1/contacts/update";

/** A Workers rate limit binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RegistrationEnv {
  LICENSE_SIGNING_KEY?: string;
  LOOPS_API_KEY?: string;
  // The Loops transactional email, made with the data variables `licenseKey` and
  // `activationUrl`.
  LOOPS_TRANSACTIONAL_ID?: string;
  LOOPS_PRODUCT_UPDATES_LIST_ID?: string;
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

/** Marks the registered email in the contact list. */
export interface ContactRecorder {
  record(registration: Registration, registeredAt: Date): Promise<void>;
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
    signing_key_id: REGISTRATION_SIGNING_KEY_ID,
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

export function loopsMailSender(
  apiKey: string,
  transactionalId: string,
): MailSender {
  return {
    async send(email) {
      const response = await fetch(LOOPS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionalId,
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

// The contact properties must exist in Loops before the first call (Audience page or
// API settings): agentaVersion, agentaInstanceId and agentaPlan as strings,
// agentaRegisteredAt as a date.
export function loopsContactRecorder(
  apiKey: string,
  productUpdatesListId: string | undefined,
): ContactRecorder {
  return {
    async record(registration, registeredAt) {
      const response = await fetch(LOOPS_CONTACT_URL, {
        // Loops creates the contact when the email is not in the audience yet.
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: registration.email,
          source: "self-hosted registration",
          userGroup: "self-hosted",
          agentaVersion: registration.agenta_version,
          agentaInstanceId: registration.instance_id,
          // Loops reads `YYYY-MM-DDTHH:mm:ss` without an offset as UTC.
          agentaRegisteredAt: registeredAt.toISOString().slice(0, 19),
          agentaPlan: REGISTERED_PLAN,
          ...(productUpdatesListId
            ? { mailingLists: { [productUpdatesListId]: true } }
            : {}),
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
  contactRecorder?: ContactRecorder,
): Promise<Response> {
  // A limiter or body read that throws must still answer the JSON error, not a platform page.
  try {
    return await register(request, env, mailSender, contactRecorder);
  } catch {
    return error(503, "unavailable", "Registration is not available.");
  }
}

async function register(
  request: Request,
  env: RegistrationEnv,
  mailSender?: MailSender,
  contactRecorder?: ContactRecorder,
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
    (env.LOOPS_API_KEY && env.LOOPS_TRANSACTIONAL_ID
      ? loopsMailSender(env.LOOPS_API_KEY, env.LOOPS_TRANSACTIONAL_ID)
      : null);
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

  // The key already went out, so a failed contact update must not fail the registration.
  const recorder =
    contactRecorder ??
    (env.LOOPS_API_KEY
      ? loopsContactRecorder(
          env.LOOPS_API_KEY,
          env.LOOPS_PRODUCT_UPDATES_LIST_ID,
        )
      : null);
  if (recorder) {
    try {
      await recorder.record(registration, new Date());
    } catch (cause) {
      console.error("Loops contact update failed", cause);
    }
  }

  return json(202, {});
}
