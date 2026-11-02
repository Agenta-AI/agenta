/** One server-sent message: its event name ("message" when the server names none) and data. */
export interface ServerSentMessage {
    event: string
    data: string
}

/** Read an event stream with fetch, since an EventSource cannot send the visitor key header. */
export const readServerSentEvents = async (
    body: ReadableStream<Uint8Array>,
    onMessage: (message: ServerSentMessage) => void,
): Promise<void> => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let event = ""
    let data: string[] = []

    const takeLine = (line: string) => {
        if (line === "") {
            if (data.length) onMessage({event: event || "message", data: data.join("\n")})
            event = ""
            data = []
            return
        }
        if (line.startsWith(":")) return
        const colon = line.indexOf(":")
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? "" : line.slice(colon + 1)
        if (value.startsWith(" ")) value = value.slice(1)
        if (field === "event") event = value
        else if (field === "data") data.push(value)
    }

    for (;;) {
        const {done, value} = await reader.read()
        buffer += decoder.decode(value, {stream: !done})
        // A trailing "\r" may be half of a "\r\n" split across chunks: keep it for the next read.
        const lines = buffer.split(/\r\n|\n|\r(?!$)/)
        buffer = done ? "" : (lines.pop() ?? "")
        for (const line of lines) takeLine(line)
        // A message the stream ended before its blank line is incomplete, and is dropped.
        if (done) return
    }
}
