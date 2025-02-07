declare namespace Testmail {
  interface Config {
    apiKey: string;
    namespace: string;
    baseUrl?: string;
  }

  interface Message {
    html: string;
    text: string;
    headers: Record<string, string>;
    subject: string;
    timestamp: number;
    receivedAt: string;
  }

  interface WaitOptions {
    timeout?: number;
    timestamp_from?: number;
  }

  interface ApiResponse {
    emails: Message[];
    count: number;
    timestamp: number;
  }

  interface EmailTagParams {
    scope?: string;
    branch?: string;
    workerId?: number;
    timestamp?: number;
  }

  type EmailTag = string;
  type TestEmail = `${string}@${string}`;
}

export = Testmail;
