import {Button} from "@agenta/ui/ui"
import {Globe} from "@phosphor-icons/react"

const hostOf = (url: string) => {
    try {
        return new URL(url).host
    } catch {
        return ""
    }
}

/** The agent's ask for the person, docked above the composer like an approval. */
export const BrowserAskCard = ({
    reason,
    url,
    onOpen,
}: {
    reason: string
    url?: string
    onOpen: () => void
}) => {
    const host = url ? hostOf(url) : ""
    return (
        <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3.5"
        >
            <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-colorText">
                    <Globe size={14} weight="fill" className="shrink-0" />
                    <span className="shrink-0">The agent needs you</span>
                    {host ? (
                        <span className="min-w-0 truncate font-normal text-colorTextTertiary">
                            · {host}
                        </span>
                    ) : null}
                </span>
                <span className="text-[13px] leading-relaxed text-colorTextSecondary [text-wrap:pretty]">
                    {reason}
                </span>
            </div>
            <Button size="sm" className="ml-auto shrink-0" onClick={onOpen}>
                Open browser
            </Button>
        </div>
    )
}
