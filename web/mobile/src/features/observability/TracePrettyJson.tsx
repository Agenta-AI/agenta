interface TracePrettyJsonProps {
    data?: unknown
    [key: string]: unknown
}

const format = (data: unknown): string => {
    if (typeof data === "string") return data
    try {
        return JSON.stringify(data ?? null, null, 2)
    } catch {
        return String(data)
    }
}

/** Trace drawer "Pretty JSON" slot on `/m`: indented JSON, wrapped to the screen. */
export const TracePrettyJson = ({data}: TracePrettyJsonProps) => (
    <pre className="m-0 overflow-x-auto p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {format(data)}
    </pre>
)
