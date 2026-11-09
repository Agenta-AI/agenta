import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import {
  REGISTRATION_PATH,
  handleRegistration,
  parseRegistration,
  type MailSender,
  type RegistrationEmail,
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
    ["a web url that is not http", { ...VALID, web_url: "javascript:alert(1)" }],
  ])("refuses %s", (_, body) => {
    expect(parseRegistration(body)).toBeNull();
  });
});

describe("handleRegistration", () => {
  it("signs a registered key and sends it once with the activation link", async () => {
    const { sender, sent } = fakeSender();

    const response = await handleRegistration(
      post(VALID),
      { LICENSE_SIGNING_KEY: privatePem },
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
        { LICENSE_SIGNING_KEY: privatePem },
        sender,
      );
      expect(response.status).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });

  it("answers 503 when the signing key is not set", async () => {
    const { sender, sent } = fakeSender();

    const response = await handleRegistration(post(VALID), {}, sender);

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
      { LICENSE_SIGNING_KEY: privatePem },
      sender,
    );

    expect(response.status).toBe(502);
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
    };

    const response = await worker.fetch(post(VALID), env);

    // No secrets in this env, so the handler answers for itself.
    expect(response.status).toBe(503);
  });
});
