import {Badge} from "@agenta/ui/ui"

const EMPTY = <span className="text-muted-foreground">—</span>

/** One value in full and read only: text as written, flags as chips, objects and chats as JSON. */
export const ScenarioFieldValue = ({value}: {value: unknown}) => {
    if (value === undefined || value === null || value === "") return EMPTY
    if (typeof value === "boolean") {
        return <Badge variant={value ? "success" : "default"}>{String(value)}</Badge>
    }
    if (typeof value === "string" || typeof value === "number") {
        return <p className="m-0 whitespace-pre-wrap break-words text-body">{String(value)}</p>
    }
    return (
        <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words text-code">
            {JSON.stringify(value, null, 2)}
        </pre>
    )
}
