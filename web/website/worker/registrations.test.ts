import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import {
  REGISTRATION_PATH,
  handleRegistration,
  parseRegistration,
  type MailSender,
  type RateLimiter,
  type RegistrationEmail,
  type RegistrationEnv,
} from "./registrations";

const VALID = {
  email: "ada@example.com",
  instance_id: "0f8b8a52-6a3e-4a1c-9d8e-2b7c4f1e9a10",
  agenta_version: "v0.128.11",
  web_url: "https://agenta.example.com/",
};

// A throwaway key pair made for the test run; it signs nothing real.
let privatePem: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  privatePem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----\n`;
  publicKey = pair.publicKey;
});

function fakeSender() {
  const sent: RegistrationEmail[] = [];
  const sender: MailSender = {
    async send(email) {
      sent.push(email);
    },
  };
  return { sender, sent };
}

/** A rate limiter that allows `limit` calls per key, and records the keys. */
function limiter(limit = Infinity) {
  const keys: string[] = [];
  const binding: RateLimiter = {
    async limit({ key }) {
      keys.push(key);
      return { success: keys.filter((seen) => seen === key).length <= limit };
    },
  };
  return { binding, keys };
}

function withLimits(env: RegistrationEnv = {}): RegistrationEnv {
  return {
    REGISTRATION_IP_LIMIT: limiter().binding,
    REGISTRATION_EMAIL_LIMIT: limiter().binding,
    ...env,
  };
}

function post(body: unknown): Request {
  return new Request(`https://agenta.ai${REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function fromBase64url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

describe("parseRegistration", () => {
  it("accepts a full registration", () => {
    expect(parseRegistration(VALID)).toEqual(VALID);
  });

  it.each([
    ["no email", { ...VALID, email: undefined }],
    ["an email without a domain", { ...VALID, email: "ada@" }],
    ["an instance id that is not a UUID", { ...VALID, instance_id: "abc" }],
    ["a version without the v form", { ...VALID, agenta_version: "0.128.11" }],
    [
      "a web url that is not http",
      { ...VALID, web_url: "javascript:alert(1)" },
    ],
    [
      "a web url with a user name",
      { ...VALID, web_url: "https://user:pass@agenta.example.com" },
    ],
  ])("refuses %s", (_, body) => {
    expect(parseRegistration(body)).toBeNull();
  });
});

describe("handleRegistration", () => {
  it("signs a registered key and sends it once with the activation link", async () => {
    const { sender, sent } = fakeSender();

    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({});
    expect(sent).toHaveLength(1);

    const [{ to, licenseKey, activationUrl }] = sent;
    expect(to).toBe("ada@example.com");
    expect(activationUrl).toBe(
      `https://agenta.example.com/m/settings?tab=license#key=${licenseKey}`,
    );

    const [prefix, body, signature] = licenseKey.split(".");
    expect(prefix).toBe("agenta_license_v1");
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      fromBase64url(signature),
      new TextEncoder().encode(body),
    );
    expect(valid).toBe(true);

    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    expect(payload).toMatchObject({
      plan: "self_hosted_registered",
      customer: "ada@example.com",
      seats: null,
      expires_at: null,
      telemetry: "required",
    });
    expect(payload.key_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(payload.issued_at))).toBe(false);
  });

  it("answers 400 and sends nothing for a body that is not valid", async () => {
    const { sender, sent } = fakeSender();

    for (const body of ["not json", { ...VALID, email: "nope" }]) {
      const response = await handleRegistration(
        post(body),
        withLimits({ LICENSE_SIGNING_KEY: privatePem }),
        sender,
      );
      expect(response.status).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });

  it("answers 503 when the signing key is not set", async () => {
    const { sender, sent } = fakeSender();

    const response = await handleRegistration(
      post(VALID),
      withLimits(),
      sender,
    );

    expect(response.status).toBe(503);
    expect(sent).toHaveLength(0);
  });

  it("answers 502 when the email cannot be sent", async () => {
    const sender: MailSender = {
      async send() {
        throw new Error("down");
      },
    };

    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    expect(response.status).toBe(502);
  });

  it("answers 413 and sends nothing for a body over the size limit", async () => {
    const { sender, sent } = fakeSender();
    const large = new Request(`https://agenta.ai${REGISTRATION_PATH}`, {
      method: "POST",
      // A stream has no Content-Length, so the limit must hold while reading.
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(`{"pad":"${"x".repeat(4096)}"}`),
          );
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

    const response = await handleRegistration(
      large,
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    expect(response.status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it("answers 429 and sends nothing past the per email limit", async () => {
    const { sender, sent } = fakeSender();
    const email = limiter(1);
    const env = withLimits({
      LICENSE_SIGNING_KEY: privatePem,
      REGISTRATION_EMAIL_LIMIT: email.binding,
    });

    const first = await handleRegistration(post(VALID), env, sender);
    const second = await handleRegistration(
      post({ ...VALID, email: "ADA@example.com" }),
      env,
      sender,
    );

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(email.keys).toEqual(["ada@example.com", "ada@example.com"]);
    expect(sent).toHaveLength(1);
  });

  it("answers 429 before reading the body past the per IP limit", async () => {
    const { sender, sent } = fakeSender();
    const request = post(VALID);
    request.headers.set("CF-Connecting-IP", "192.0.2.1");

    const response = await handleRegistration(
      request,
      withLimits({
        LICENSE_SIGNING_KEY: privatePem,
        REGISTRATION_IP_LIMIT: limiter(0).binding,
      }),
      sender,
    );

    expect(response.status).toBe(429);
    expect(request.bodyUsed).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("refuses to run without the rate limit bindings", async () => {
    const { sender, sent } = fakeSender();

    const response = await handleRegistration(
      post(VALID),
      { LICENSE_SIGNING_KEY: privatePem },
      sender,
    );

    expect(response.status).toBe(429);
    expect(sent).toHaveLength(0);
  });

  it("answers 405 for a method other than POST", async () => {
    const response = await handleRegistration(
      new Request(`https://agenta.ai${REGISTRATION_PATH}`),
      {},
    );

    expect(response.status).toBe(405);
  });
});

describe("worker routing", () => {
  it("sends the registration path to the registration handler, not to assets", async () => {
    const env = {
      ASSETS: {
        async fetch(): Promise<Response> {
          throw new Error("assets must not be called");
        },
      },
      MEDIA: { head: async () => null, get: async () => null },
      ...withLimits(),
    };

    const response = await worker.fetch(post(VALID), env);

    // No secrets in this env, so the handler answers for itself.
    expect(response.status).toBe(503);
  });
});
