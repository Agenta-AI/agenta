import {useState} from "react"

import {linkPreviewQueryFamily} from "@agenta/entities/link"
import {SkeletonBlock} from "@agenta/ui/ui"
import {LinkSimple} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname.replace(/^www\./, "")
    } catch {
        return url
    }
}

const DomainLine = ({domain}: {domain: string}) => (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <LinkSimple size={12} className="shrink-0" />
        <span className="truncate">{domain}</span>
    </span>
)

/** The hover card body for a web link: the page's image, title, description and domain, read
 * by the server. A page with nothing to show still names where the link goes. */
export const LinkPreviewCard = ({href}: {href: string}) => {
    const query = useAtomValue(linkPreviewQueryFamily(href))
    const [imageFailed, setImageFailed] = useState(false)
    const preview = query.data
    const domain = preview?.domain || hostOf(href)

    if (query.isPending)
        return (
            <div className="flex flex-col gap-2 p-3" aria-busy>
                <SkeletonBlock className="h-4 w-3/4" />
                <SkeletonBlock className="h-3 w-full" />
                <SkeletonBlock className="h-3 w-2/3" />
            </div>
        )

    const title = preview?.title
    const description = preview?.description
    const image = !imageFailed ? preview?.image : null

    if (!title && !description && !image)
        return (
            <div className="flex min-w-0 flex-col gap-1 p-3">
                <span className="truncate text-sm font-medium text-popover-foreground">
                    {domain}
                </span>
                <span className="line-clamp-2 break-all text-muted-foreground">{href}</span>
                <span className="text-muted-foreground">Opens in a new tab</span>
            </div>
        )

    return (
        <div className="flex min-w-0 flex-col">
            {image ? (
                <div className="aspect-[1.91/1] w-full overflow-hidden bg-muted">
                    {/* A third-party image; next/image would proxy it. No referrer leaves the app. */}
                    <img
                        src={image}
                        alt=""
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onError={() => setImageFailed(true)}
                        className="h-full w-full object-cover"
                    />
                </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-1 p-3">
                {title ? (
                    <span className="line-clamp-2 text-sm font-medium leading-5 text-popover-foreground">
                        {title}
                    </span>
                ) : null}
                {description ? (
                    <span className="line-clamp-3 leading-4 text-muted-foreground">
                        {description}
                    </span>
                ) : null}
                <DomainLine domain={domain} />
            </div>
        </div>
    )
}

export default LinkPreviewCard
