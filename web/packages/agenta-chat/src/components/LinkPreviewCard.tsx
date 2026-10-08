import {useEffect, useState, type ReactElement} from "react"

import {linkPreviewQueryFamily, type LinkPreview} from "@agenta/entities/link"
import {HoverCard, HoverCardContent, HoverCardTrigger} from "@agenta/ui/ui"
import {LinkSimple} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

/** True once `src` has loaded, so a card never opens on a missing or broken image. */
function useImageLoaded(src: string | null | undefined): boolean {
    const [loaded, setLoaded] = useState<string | null>(null)
    useEffect(() => {
        if (!src) return
        const image = new Image()
        image.referrerPolicy = "no-referrer"
        image.onload = () => setLoaded(src)
        image.src = src
        return () => {
            image.onload = null
        }
    }, [src])
    return Boolean(src) && loaded === src
}

const LinkPreviewCard = ({preview}: {preview: LinkPreview & {image: string}}) => (
    <div className="flex min-w-0 flex-col">
        <div className="aspect-[1.91/1] w-full overflow-hidden bg-muted">
            {/* A third-party image; next/image would proxy it. */}
            <img
                src={preview.image}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
            />
        </div>
        <div className="flex min-w-0 flex-col gap-1 p-3">
            {preview.title ? (
                <span className="line-clamp-2 text-sm font-medium leading-5 text-popover-foreground">
                    {preview.title}
                </span>
            ) : null}
            {preview.description ? (
                <span className="line-clamp-3 leading-4 text-muted-foreground">
                    {preview.description}
                </span>
            ) : null}
            {preview.domain ? (
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                    <LinkSimple size={12} className="shrink-0" />
                    <span className="truncate">{preview.domain}</span>
                </span>
            ) : null}
        </div>
    </div>
)

/** A web link that shows its page's preview on hover, only when the page has a preview image. */
export const WebLinkPreview = ({href, children}: {href: string; children: ReactElement}) => {
    // Hover intent fetches; the card opens only once a preview image has loaded.
    const [intent, setIntent] = useState(false)
    const query = useAtomValue(linkPreviewQueryFamily(intent ? href : ""))
    const preview = query.data
    const ready = useImageLoaded(preview?.image)
    const open = intent && ready
    // While the card is held shut Radix reports no close, so leaving must end the intent here.
    const endHeldIntent = () => !open && setIntent(false)
    return (
        <HoverCard openDelay={300} closeDelay={150} open={open} onOpenChange={setIntent}>
            <HoverCardTrigger asChild onPointerLeave={endHeldIntent} onBlur={endHeldIntent}>
                {children}
            </HoverCardTrigger>
            {open && preview?.image ? (
                <HoverCardContent
                    side="top"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0 text-xs"
                >
                    <LinkPreviewCard preview={{...preview, image: preview.image}} />
                </HoverCardContent>
            ) : null}
        </HoverCard>
    )
}

export default WebLinkPreview
