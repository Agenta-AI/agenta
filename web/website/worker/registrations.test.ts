import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import worker from "./index";
import {
  CAPS_PREFIX,
  DAILY_EMAIL_CAP,
  DAILY_INSTANCE_CAP,
  POSTHOG_BATCH_URL,
  POSTHOG_PROJECT_TOKEN,
  REGISTRATION_PATH,
  handleRegistration,
  parseRegistration,
  type CapBucket,
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

const USER_ID = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const SURVEY = {
  role: "Engineer (AI, SWE, ML)",
  team_size: "11-50",
  heard_from: "GitHub",
};
const FULL = {
  ...VALID,
  instance_kind: "production",
  product_updates: true,
  survey: SURVEY,
  user_id: USER_ID,
};

// No test reaches the network: PostHog runs on every registration, so `fetch`
// answers 200 unless a test stubs it.
beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** An in-memory stand-in for the R2 bucket that holds the daily caps, with R2's
 * conditional writes. `beforePut` lets a test hold a write. */
function capBucket(beforePut: () => Promise<void> = async () => {}) {
  const objects = new Map<string, string>();
  const etags = new Map<string, string>();
  let version = 0;
  const bucket: CapBucket = {
    async get(key) {
      const value = objects.get(key);
      return value === undefined
        ? null
        : { etag: etags.get(key)!, text: async () => value };
    },
    async put(key, value, options) {
      await beforePut();
      const current = etags.get(key);
      const onlyIf = options?.onlyIf;
      if (onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== current) {
        return null;
      }
      if (onlyIf?.etagDoesNotMatch === "*" && current !== undefined)
        return null;
      objects.set(key, value);
      etags.set(key, String(++version));
      return {};
    },
  };
  return { bucket, objects };
}

function withLimits(env: RegistrationEnv = {}): RegistrationEnv {
  return {
    REGISTRATION_IP_LIMIT: limiter().binding,
    REGISTRATION_EMAIL_LIMIT: limiter().binding,
    MEDIA: capBucket().bucket,
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
  it("accepts a registration with only the instance fields", () => {
    expect(parseRegistration(VALID)).toEqual({
      ...VALID,
      instance_kind: null,
      product_updates: false,
      survey: {},
      user_id: null,
    });
  });

  it("accepts the updates choice, the survey answers and the user id", () => {
    expect(parseRegistration(FULL)).toEqual(FULL);
  });

  it("keeps the test kind of a test stack", () => {
    expect(
      parseRegistration({ ...VALID, instance_kind: "test" })?.instance_kind,
    ).toBe("test");
  });

  it.each([["staging"], [42]])(
    "drops an instance kind that is not known (%s) and still registers",
    (kind) => {
      expect(
        parseRegistration({ ...VALID, instance_kind: kind })?.instance_kind,
      ).toBeNull();
    },
  );

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
    [
      "an updates choice that is not a boolean",
      { ...VALID, product_updates: "yes" },
    ],
    ["a survey that is not an object", { ...VALID, survey: "Engineer" }],
    [
      "a survey answer that is too long",
      { ...VALID, survey: { role: "x".repeat(65) } },
    ],
    [
      "a survey answer on two lines",
      { ...VALID, survey: { role: "Other\nmy text" } },
    ],
    ["a user id that is not a UUID", { ...VALID, user_id: "42" }],
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
      instance_id: VALID.instance_id,
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
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("https://app.loops.so/api/v1/transactional");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer loops_unit");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({
      transactionalId: "tmpl_unit",
      email: "ada@example.com",
      addToAudience: true,
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
      post(FULL),
      withLimits({
        LICENSE_SIGNING_KEY: privatePem,
        ...LOOPS_ENV,
      }),
    );

    expect(response.status).toBe(202);
    expect(calls.map((call) => call.url)).toEqual([
      "https://app.loops.so/api/v1/transactional",
      "https://app.loops.so/api/v1/contacts/update",
      POSTHOG_BATCH_URL,
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
      agentaProductUpdates: true,
      agentaRole: "Engineer (AI, SWE, ML)",
      agentaTeamSize: "11-50",
      agentaHeardFrom: "GitHub",
    });
  });

  it("leaves the product updates choice alone when the box was clear", async () => {
    const calls = stubLoops();

    const response = await handleRegistration(
      post({ ...FULL, product_updates: false }),
      withLimits({
        LICENSE_SIGNING_KEY: privatePem,
        ...LOOPS_ENV,
      }),
    );

    expect(response.status).toBe(202);
    const body = JSON.parse(calls[1].init.body as string);
    // The request cannot prove it owns the email, so it never opts a contact out.
    expect(body).not.toHaveProperty("agentaProductUpdates");
    expect(body).not.toHaveProperty("mailingLists");
    expect(body.agentaRole).toBe("Engineer (AI, SWE, ML)");
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

  it("answers 202 before a slow contact or analytics update ends", async () => {
    const { sender, sent } = fakeSender();
    const never = new Promise<void>(() => {});
    const recorder: ContactRecorder = { record: () => never };
    const analytics = { record: () => never };
    const pending: Promise<unknown>[] = [];

    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
      recorder,
      analytics,
      (promise) => pending.push(promise),
    );

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });

  it("starts the analytics update while the contact update still runs", async () => {
    const { sender } = fakeSender();
    const recorder: ContactRecorder = {
      record: () => new Promise<void>(() => {}),
    };
    let analyticsStarted = false;
    const analytics = {
      async record() {
        analyticsStarted = true;
      },
    };

    await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
      recorder,
      analytics,
      () => {},
    );

    expect(analyticsStarted).toBe(true);
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

describe("PostHog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubPostHog(status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status });
    });
    return calls;
  }

  it("links the instance and the registering admin to the email", async () => {
    const calls = stubPostHog();
    const { sender } = fakeSender();

    const response = await handleRegistration(
      post(FULL),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    expect(response.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(POSTHOG_BATCH_URL);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.api_key).toBe(POSTHOG_PROJECT_TOKEN);
    const timestamp = expect.any(String);
    expect(body.batch).toEqual([
      {
        event: "instance_registered",
        distinct_id: VALID.instance_id,
        timestamp,
        properties: {
          email: "ada@example.com",
          agenta_version: "v0.128.11",
          instance_kind: "production",
          plan: "self_hosted_registered",
          role: "Engineer (AI, SWE, ML)",
          team_size: "11-50",
          heard_from: "GitHub",
          $groups: { instance: VALID.instance_id },
        },
      },
      {
        event: "$groupidentify",
        distinct_id: VALID.instance_id,
        timestamp,
        properties: {
          $group_type: "instance",
          $group_key: VALID.instance_id,
          $group_set: {
            registered_email: "ada@example.com",
            instance_kind: "production",
          },
        },
      },
      {
        event: "$set",
        distinct_id: `${VALID.instance_id}:${USER_ID}`,
        timestamp,
        properties: { $set: { email: "ada@example.com" } },
      },
    ]);
  });

  it("sends no person update without a user id", async () => {
    const calls = stubPostHog();
    const { sender } = fakeSender();

    await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.batch.map((event: { event: string }) => event.event)).toEqual([
      "instance_registered",
      "$groupidentify",
    ]);
  });

  it("sets no instance kind on the group when the instance sent none", async () => {
    const calls = stubPostHog();
    const { sender } = fakeSender();

    await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    const [registered, group] = JSON.parse(calls[0].init.body as string).batch;
    expect(registered.properties.instance_kind).toBeNull();
    expect(group.properties.$group_set).toEqual({
      registered_email: "ada@example.com",
    });
  });

  it("still answers 202 when PostHog fails", async () => {
    stubPostHog(500);
    const { sender, sent } = fakeSender();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleRegistration(
      post(FULL),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("sends nothing to PostHog when the key email fails", async () => {
    const calls = stubPostHog();
    const sender: MailSender = {
      async send() {
        throw new Error("down");
      },
    };

    const response = await handleRegistration(
      post(FULL),
      withLimits({ LICENSE_SIGNING_KEY: privatePem }),
      sender,
    );

    expect(response.status).toBe(502);
    expect(calls).toEqual([]);
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
      ...withLimits(),
      MEDIA: {
        head: async () => null,
        get: async () => null,
        put: async () => undefined,
      },
    };

    const response = await worker.fetch(post(VALID), env);

    // No secrets in this env, so the handler answers for itself.
    expect(response.status).toBe(503);
  });
});

describe("daily caps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function registrationFor(email: string, instanceId: string) {
    return post({ ...VALID, email, instance_id: instanceId });
  }

  it("sends at most 3 key emails to one address in 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { sender, sent } = fakeSender();
    const { bucket } = capBucket();
    const env = withLimits({ LICENSE_SIGNING_KEY: privatePem, MEDIA: bucket });
    const send = (instanceId: string) =>
      handleRegistration(
        registrationFor("Person@Example.com", instanceId),
        env,
        sender,
        undefined,
        { record: async () => {} },
      );

    for (let index = 0; index < DAILY_EMAIL_CAP; index++) {
      expect((await send(crypto.randomUUID())).status).toBe(202);
    }
    expect((await send(crypto.randomUUID())).status).toBe(429);
    expect(sent).toHaveLength(DAILY_EMAIL_CAP);

    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    expect((await send(crypto.randomUUID())).status).toBe(202);
  });

  it("sends at most 20 key emails for one instance in 24 hours", async () => {
    const { sender, sent } = fakeSender();
    const { bucket } = capBucket();
    const env = withLimits({ LICENSE_SIGNING_KEY: privatePem, MEDIA: bucket });
    const instanceId = crypto.randomUUID();
    const send = (index: number) =>
      handleRegistration(
        registrationFor(`person${index}@example.com`, instanceId),
        env,
        sender,
        undefined,
        { record: async () => {} },
      );

    for (let index = 0; index < DAILY_INSTANCE_CAP; index++) {
      expect((await send(index)).status).toBe(202);
    }
    expect((await send(DAILY_INSTANCE_CAP)).status).toBe(429);
    expect(sent).toHaveLength(DAILY_INSTANCE_CAP);
  });

  it("counts two sends whose count updates overlap", async () => {
    // All four count writes (email and instance, for both sends) wait until every
    // one has read the stored lists.
    let pendingWrites = 0;
    let allWaiting = () => {};
    const gate = new Promise<void>((resolve) => (allWaiting = resolve));
    const { bucket, objects } = capBucket(async () => {
      if (++pendingWrites === 4) allWaiting();
      await gate;
    });
    const env = withLimits({ LICENSE_SIGNING_KEY: privatePem, MEDIA: bucket });
    const { sender } = fakeSender();
    const send = (email: string) =>
      handleRegistration(post({ ...VALID, email }), env, sender, undefined, {
        record: async () => {},
      });

    await Promise.all([send("one@example.com"), send("two@example.com")]);

    const instanceKey = [...objects.keys()].find((key) =>
      key.includes("/instance/"),
    )!;
    expect(JSON.parse(objects.get(instanceKey)!)).toHaveLength(2);
  });

  it("does not count a send that failed", async () => {
    const { bucket } = capBucket();
    const env = withLimits({ LICENSE_SIGNING_KEY: privatePem, MEDIA: bucket });
    const failing: MailSender = {
      async send() {
        throw new Error("down");
      },
    };
    for (let index = 0; index < DAILY_EMAIL_CAP + 1; index++) {
      expect((await handleRegistration(post(VALID), env, failing)).status).toBe(
        502,
      );
    }

    const { sender, sent } = fakeSender();
    const response = await handleRegistration(
      post(VALID),
      env,
      sender,
      undefined,
      {
        record: async () => {},
      },
    );

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(1);
  });

  it("keeps only hashes of the email and the instance id in the bucket", async () => {
    const { sender } = fakeSender();
    const { bucket, objects } = capBucket();

    await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem, MEDIA: bucket }),
      sender,
      undefined,
      { record: async () => {} },
    );

    const keys = [...objects.keys()];
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key.startsWith(CAPS_PREFIX)).toBe(true);
      expect(key).not.toContain(VALID.email);
      expect(key).not.toContain(VALID.instance_id);
    }
  });

  it("refuses to run without the bucket", async () => {
    const { sender, sent } = fakeSender();

    const response = await handleRegistration(
      post(VALID),
      withLimits({ LICENSE_SIGNING_KEY: privatePem, MEDIA: undefined }),
      sender,
    );

    expect(response.status).toBe(503);
    expect(sent).toHaveLength(0);
  });
});
