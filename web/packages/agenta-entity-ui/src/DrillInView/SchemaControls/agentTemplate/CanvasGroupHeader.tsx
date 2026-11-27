import type {ReactNode} from "react"

/** The agent panel's group header (canvas F02 f4): `text-subtitle`, space above, no line (SURF-01). */
export function CanvasGroupHeader({label}: {label: ReactNode}) {
    return <div className="flex items-center pt-3 text-subtitle text-foreground">{label}</div>
}
