import axios from "axios"

import type Testmail from "./types"

function createStructuredTag(params: Testmail.EmailTagParams = {}): string {
    const {
        scope = "test",
        branch = process.env.BRANCH_NAME ?? "local",
        workerId,
        timestamp = Date.now(),
    } = params

    return [scope, branch, workerId !== undefined ? `w${workerId}` : "", timestamp]
        .filter(Boolean)
        .join("-")
}

function createFallbackEmail(params: Testmail.EmailTagParams = {}): Testmail.TestEmail {
    const tag = createStructuredTag(params)
    return `${tag}.test.agenta@test.agenta.ai`
}

export function isTestmailInboxEmail(email: string, namespace?: string): boolean {
    if (!email.endsWith("@inbox.testmail.app")) {
        return false
    }

    if (!namespace) {
        return true
    }

    return email.startsWith(`${namespace}.`)
}

export function extractTestmailTag(email: string, namespace?: string): string {
    const [fullTag] = email.split("@")
    const parts = fullTag.split(".")

    if (namespace && parts[0] === namespace) {
        return parts.slice(1).join(".")
    }

    if (namespace && parts[parts.length - 1] === namespace) {
        return parts.slice(1, -1).join(".")
    }

    return parts.slice(1).join(".")
}

export function generateNamespacedTestEmail(
    namespace: string,
    params: Testmail.EmailTagParams = {},
): Testmail.TestEmail {
    const identifier = createStructuredTag(params)
    return `${namespace}.${identifier}.test.agenta@inbox.testmail.app`
}

export function generateRuntimeTestEmail(
    params: Testmail.EmailTagParams = {},
): Testmail.TestEmail {
    const namespace = process.env.TESTMAIL_NAMESPACE?.trim()

    if (namespace) {
        return generateNamespacedTestEmail(namespace, params)
    }

    return createFallbackEmail(params)
}

export class TestmailClient {
    private readonly client

    constructor(private readonly config: Testmail.Config) {
        this.config.baseUrl ??= "https://api.testmail.app/api/json"

        this.client = axios.create({
            baseURL: this.config.baseUrl,
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                Accept: "application/json",
            },
        })
    }

    private extractTag(email: string): string {
        return extractTestmailTag(email, this.config.namespace)
    }

    async waitForEmail(
        tag: Testmail.EmailTag,
        {timeout = 30000, timestamp_from = Date.now()}: Testmail.WaitOptions = {},
    ): Promise<Testmail.Message> {
        try {
            const clientTimeoutMs = timeout + 5000
            const response = await this.client.get<Testmail.ApiResponse>("", {
                params: {
                    namespace: this.config.namespace,
                    apikey: this.config.apiKey,
                    tag,
                    livequery: "true",
                    timestamp_from: timestamp_from,
                    timeout_seconds: Math.floor(timeout / 1000),
                },
                timeout: clientTimeoutMs,
            })

            const [email] = response.data.emails
            if (!email) throw new Error(`No email found for tag: ${tag}`)

            return email
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error("API Error:", error.response?.data || error.message, {
                    namespace: this.config.namespace,
                    tag,
                    timestamp_from,
                    timeout,
                })
            }
            throw error
        }
    }

    private async findOTP(message: Testmail.Message): Promise<string> {
        const htmlPattern = /<div[^>]*class="mcnTextContent"[^>]*>\s*(\d{6})\s*<\/div>/
        const textPattern = /(\d{6})/

        const htmlMatch = message.html.match(htmlPattern)
        if (htmlMatch?.[1]) return htmlMatch[1]

        const textMatch = message.text.match(textPattern)
        if (textMatch?.[1]) return textMatch[1]

        throw new Error("OTP not found in email")
    }

    async waitForOTP(email: string, options: Testmail.WaitOptions = {}): Promise<string> {
        const message = await this.waitForEmail(this.extractTag(email), options)
        return this.findOTP(message)
    }

    generateTestEmail(params: Testmail.EmailTagParams = {}): Testmail.TestEmail {
        return generateNamespacedTestEmail(this.config.namespace, params)
    }
}

let defaultClient: TestmailClient | null = null

export function getTestmailClient(): TestmailClient {
    if (!defaultClient) {
        const apiKey = process.env.TESTMAIL_API_KEY
        const namespace = process.env.TESTMAIL_NAMESPACE

        if (!apiKey || !namespace) {
            throw new Error(
                "TESTMAIL_API_KEY and TESTMAIL_NAMESPACE environment variables are required",
            )
        }

        defaultClient = new TestmailClient({apiKey, namespace})
    }
    return defaultClient
}

export type {Testmail}
