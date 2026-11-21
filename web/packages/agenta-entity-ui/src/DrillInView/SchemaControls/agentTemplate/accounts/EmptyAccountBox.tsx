/** "No account yet" or "Not signed in yet" in a dashed box, with the action at the right (canvas F10 f3, F03 f7). */
import type {ReactNode} from "react"

export function EmptyAccountBox({text, children}: {text: string; children?: ReactNode}) {
    return (
        <div
            data-testid="empty-account-box"
            className="flex min-h-[46px] items-center justify-between gap-3 rounded-[8px] border border-dashed border-colorBorder px-3 py-2"
        >
            <span className="min-w-0 text-[13px] leading-5 text-colorTextSecondary">{text}</span>
            {children}
        </div>
    )
}
