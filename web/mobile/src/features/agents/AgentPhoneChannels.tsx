import type {ReactNode} from "react"

export const AgentPhoneChannels = ({children}: {children?: ReactNode}) => {
    if (!children) return null

    return (
        <details className="max-h-[45dvh] shrink-0 overflow-y-auto rounded-lg border border-border lg:hidden">
            <summary className="cursor-pointer px-3 py-3 text-sm font-medium">Channels</summary>
            <div className="px-3 pb-3">{children}</div>
        </details>
    )
}
