import {act} from "react"

import {axios} from "@agenta/shared/api"
import {vi} from "vitest"

/** One request the package code sent over axios. */
export interface RecordedRequest {
    method: string
    url: string
    params: Record<string, unknown> | undefined
    body: unknown
}

interface Reply {
    status?: number
    data?: unknown
}

/**
 * Stand in for the network under the shared axios instance. The package code runs for real, so a
 * test sees exactly what it would send. `reply` answers each request.
 */
export function stubAxiosHttp(
    reply: (request: RecordedRequest) => Reply | Promise<Reply>,
): RecordedRequest[] {
    const sent: RecordedRequest[] = []
    axios.defaults.adapter = vi.fn(async (config) => {
        const request: RecordedRequest = {
            method: String(config.method).toUpperCase(),
            url: String(config.url),
            params: config.params,
            body: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
        }
        sent.push(request)
        const {status = 200, data} = await reply(request)
        const response = {data, status, statusText: "", headers: {}, config}
        if (status >= 400) throw Object.assign(new Error(`HTTP ${status}`), {response})
        return response
    })
    return sent
}

/** One request the generated API client sent with `fetch`. */
export interface RecordedFetch {
    method: string
    url: string
    form: Record<string, FormDataEntryValue> | null
}

/** Stand in for `fetch`, which the generated API client calls. Answers JSON. */
export function stubFetchHttp(reply: (request: RecordedFetch) => Reply): RecordedFetch[] {
    const sent: RecordedFetch[] = []
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown, init?: RequestInit) => {
            const body = init?.body
            const request: RecordedFetch = {
                method: String(init?.method ?? "GET").toUpperCase(),
                url: String(input instanceof Request ? input.url : input),
                form: body instanceof FormData ? Object.fromEntries(body.entries()) : null,
            }
            sent.push(request)
            const {status = 200, data = {}} = reply(request)
            return new Response(JSON.stringify(data), {
                status,
                headers: {"Content-Type": "application/json"},
            })
        }),
    )
    return sent
}

/** jsdom's Blob has no `text()`. Browsers do, and the package file checks call it. */
export function polyfillBlobText(): void {
    if (typeof Blob.prototype.text === "function") return
    Blob.prototype.text = function text(this: Blob) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsText(this)
        })
    }
}

/**
 * Wait until `check` stops throwing, flushing React updates between tries. Call it outside `act`.
 * Use it to wait for the state a step ends in, never for a fixed time.
 */
export async function until(check: () => void): Promise<void> {
    await vi.waitFor(
        async () => {
            await act(async () => undefined)
            check()
        },
        {timeout: 3000, interval: 5},
    )
}
