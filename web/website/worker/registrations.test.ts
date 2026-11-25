import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import {
  REGISTRATION_PATH,
  handleRegistration,
  parseRegistration,
  type ContactRecorder,
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
      signing_key_id: "registration-1",
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

  it.each([
    ["the Loops API key", { LOOPS_TRANSACTIONAL_ID: "tmpl_unit" }],
    ["the Loops template id", { LOOPS_API_KEY: "loops_unit" }],
  ])("answers 503 when %s is not set", async (_, loops) => {
    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem, ...loops }),
    );

    expect(response.status).toBe(503);
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

  it("answers the JSON 503 when a rate limiter throws", async () => {
    const { sender, sent } = fakeSender();
    const failing = {
      limit: async () => {
        throw new Error("limiter down");
      },
    };

    const response = await handleRegistration(
      post(VALID),
      withLimits({
        LICENSE_SIGNING_KEY: privatePem,
        REGISTRATION_IP_LIMIT: failing,
      }),
      sender,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "unavailable",
        status: 503,
        message: "Registration is not available.",
      },
    });
    expect(sent).toHaveLength(0);
  });

  it("refuses to run without the rate limit bindings", async () => {
    const { sender, sent } = fakeSender();

    const response = await handleRegistration(
      post(VALID),
      { LICENSE_SIGNING_KEY: privatePem },
      sender,
    );

    expect(response.status).toBe(503);
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

describe("Loops email", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the template id from the worker environment", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    });

    const response = await handleRegistration(
      post(VALID),
      withLimits({
        LICENSE_SIGNING_KEY: privatePem,
        LOOPS_API_KEY: "loops_unit",
        LOOPS_TRANSACTIONAL_ID: "tmpl_unit",
      }),
    );

    expect(response.status).toBe(202);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://app.loops.so/api/v1/transactional");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer loops_unit");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({
      transactionalId: "tmpl_unit",
      email: "ada@example.com",
    });
    expect(body.dataVariables.licenseKey).toMatch(/^agenta_license_v1\./);
  });
});

describe("Loops contact", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubLoops(contactStatus = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const status = url.endsWith("/contacts/update") ? contactStatus : 200;
      return new Response("{}", { status });
    });
    return calls;
  }

  const LOOPS_ENV = {
    LOOPS_API_KEY: "loops_unit",
    LOOPS_TRANSACTIONAL_ID: "tmpl_unit",
  };

  it("marks the contact as a self-hosted registration after the key email", async () => {
    const calls = stubLoops();

    const response = await handleRegistration(
      post(VALID),
      withLimits({
        LICENSE_SIGNING_KEY: privatePem,
        ...LOOPS_ENV,
        LOOPS_PRODUCT_UPDATES_LIST_ID: "list_unit",
      }),
    );

    expect(response.status).toBe(202);
    expect(calls.map((call) => call.url)).toEqual([
      "https://app.loops.so/api/v1/transactional",
      "https://app.loops.so/api/v1/contacts/update",
    ]);
    const contact = calls[1];
    expect(contact.init.method).toBe("PUT");
    expect((contact.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer loops_unit",
    );
    const body = JSON.parse(contact.init.body as string);
    expect(body).toEqual({
      email: "ada@example.com",
      source: "self-hosted registration",
      userGroup: "self-hosted",
      agentaVersion: "v0.128.11",
      agentaInstanceId: "0f8b8a52-6a3e-4a1c-9d8e-2b7c4f1e9a10",
      agentaRegisteredAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
      ),
      agentaPlan: "self_hosted_registered",
      mailingLists: { list_unit: true },
    });
  });

  it("adds no mailing list when the list id is empty", async () => {
    const calls = stubLoops();

    await handleRegistration(
      post(VALID),
      withLimits({
        LICENSE_SIGNING_KEY: privatePem,
        ...LOOPS_ENV,
        LOOPS_PRODUCT_UPDATES_LIST_ID: "",
      }),
    );

    const body = JSON.parse(calls[1].init.body as string);
    expect(body).not.toHaveProperty("mailingLists");
    expect(body.userGroup).toBe("self-hosted");
  });

  it("still answers 202 when the contact update fails", async () => {
    stubLoops(500);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem, ...LOOPS_ENV }),
    );

    expect(response.status).toBe(202);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("still answers 202 when a contact recorder throws", async () => {
    const { sender, sent } = fakeSender();
    const recorder: ContactRecorder = {
      async record() {
        throw new Error("down");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
      recorder,
    );

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
  });

  it("does not update the contact when the key email fails", async () => {
    const recorded: string[] = [];
    const recorder: ContactRecorder = {
      async record(registration) {
        recorded.push(registration.email);
      },
    };
    const sender: MailSender = {
      async send() {
        throw new Error("down");
      },
    };

    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
      recorder,
    );

    expect(response.status).toBe(502);
    expect(recorded).toEqual([]);
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
