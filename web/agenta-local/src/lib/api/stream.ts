import {LocalApiError, parseError} from "./client"
import {streamFrameSchema, type StreamFrame} from "./schemas"

export async function* parseEventStream(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<StreamFrame> {
    if (!response.ok) throw await parseError(response)
    if (!response.body) {
        throw new LocalApiError({
            code: "stream_disconnected",
            message: "The response had no stream",
        })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let finished = false

    try {
        while (true) {
            const {done, value} = await reader.read()
            buffer += decoder.decode(value, {stream: !done})
            const chunks = buffer.split("\n\n")
            buffer = chunks.pop() ?? ""

            for (const chunk of chunks) {
                const data = chunk
                    .split("\n")
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trimStart())
                    .join("\n")
                if (!data) continue
                let frame: StreamFrame
                try {
                    frame = streamFrameSchema.parse(JSON.parse(data))
                } catch {
                    throw new LocalApiError({
                        code: "invalid_stream_frame",
                        message: "The runner returned an invalid event",
                    })
                }
                if (frame.type === "finish") finished = true
                yield frame
            }
            if (done) break
        }
    } catch (error) {
        if (signal?.aborted) {
            throw new LocalApiError({code: "turn_cancelled", message: "Turn cancelled"})
        }
        throw error
    } finally {
        reader.releaseLock()
    }

    if (!finished) {
        throw new LocalApiError({
            code: "stream_disconnected",
            message: "The runner disconnected before finishing",
            retryable: true,
        })
    }
}
