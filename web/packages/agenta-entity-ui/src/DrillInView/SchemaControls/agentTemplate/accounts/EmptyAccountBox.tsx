/** "No account yet" or "Not signed in yet" in a dashed box, with the action at the right (canvas F10 f3, F03 f7). */
import type {ReactNode} from "react"

export function EmptyAccountBox({text, children}: {text: string; children?: ReactNode}) {
    return (
        <div
            data-testid="empty-account-box"
            className="flex min-h-[46px] items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2"
        >
            <span className="min-w-0 text-label leading-5 text-muted-foreground">{text}</span>
            {children}
        </div>
    )
}
