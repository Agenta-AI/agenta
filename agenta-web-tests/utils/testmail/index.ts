import axios from "axios";
import type Testmail from "./types";

export class TestmailClient {
  private readonly client;

  constructor(private readonly config: Testmail.Config) {
    this.config.baseUrl ??= "https://api.testmail.app/api/json";

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "application/json",
      },
    });
  }

  private generateRandomSuffix(): string {
    return Math.random().toString(36).substring(2, 7);
  }

  private extractTag(email: string): string {
    const [fullTag] = email.split("@");
    const parts = fullTag.split(".");
    return parts.slice(1).join(".");
  }

  private createStructuredTag(params: Testmail.EmailTagParams = {}): string {
    const {
      scope = "test",
      branch = process.env.BRANCH_NAME ?? "local",
      workerId,
      timestamp = Date.now(),
    } = params;
    return [
      scope,
      branch,
      workerId !== undefined ? `w${workerId}` : "",
      timestamp,
    ]
      .filter(Boolean)
      .join("-");
  }

  async waitForEmail(
    tag: Testmail.EmailTag,
    { timeout = 30000, timestamp_from = Date.now() }: Testmail.WaitOptions = {}
  ): Promise<Testmail.Message> {
    try {
      const response = await this.client.get<Testmail.ApiResponse>("", {
        params: {
          namespace: this.config.namespace,
          apikey: this.config.apiKey,
          tag,
          livequery: "true",
          timestamp_from: timestamp_from,
          timeout_seconds: Math.floor(timeout / 1000),
        },
      });

      const [email] = response.data.emails;
      if (!email) throw new Error(`No email found for tag: ${tag}`);

      return email;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("API Error:", error.response?.data || error.message);
      }
      throw error;
    }
  }

  private async findOTP(message: Testmail.Message): Promise<string> {
    const htmlPattern =
      /<div[^>]*class="mcnTextContent"[^>]*>\s*(\d{6})\s*<\/div>/;
    const textPattern = /(\d{6})/;

    const htmlMatch = message.html.match(htmlPattern);
    if (htmlMatch?.[1]) return htmlMatch[1];

    const textMatch = message.text.match(textPattern);
    if (textMatch?.[1]) return textMatch[1];

    throw new Error("OTP not found in email");
  }

  async waitForOTP(
    email: string,
    options: Testmail.WaitOptions = {}
  ): Promise<string> {
    const message = await this.waitForEmail(this.extractTag(email), options);
    return this.findOTP(message);
  }

  generateTestEmail(params: Testmail.EmailTagParams = {}): Testmail.TestEmail {
    const tag = this.createStructuredTag(params);
    const randomSuffix = this.generateRandomSuffix();
    return `${this.config.namespace}.${randomSuffix}.${tag}@inbox.testmail.app`;
  }
}

let defaultClient: TestmailClient | null = null;

export function getTestmailClient(): TestmailClient {
  if (!defaultClient) {
    const apiKey = process.env.TESTMAIL_API_KEY;
    const namespace = process.env.TESTMAIL_NAMESPACE;

    if (!apiKey || !namespace) {
      throw new Error(
        "TESTMAIL_API_KEY and TESTMAIL_NAMESPACE environment variables are required"
      );
    }

    defaultClient = new TestmailClient({ apiKey, namespace });
  }
  return defaultClient;
}

export type { Testmail };
