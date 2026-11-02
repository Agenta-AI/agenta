import type {ReleaseItem} from "@agenta/navigation"
import {CaretDown, type Icon} from "@phosphor-icons/react"

const AREA_DOTS = ["bg-colorSuccess", "bg-colorInfo", "bg-colorWarning", "bg-colorPrimary"]

// Hashed, so an area keeps its dot colour across releases.
const areaDot = (area: string) =>
    AREA_DOTS[
        [...area].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) %
            AREA_DOTS.length
    ]

/** A release's improvements or fixes, collapsed by default; renders nothing when empty. */
export const ReleaseItemsSection = ({
    title,
    icon: SectionIcon,
    items,
}: {
    title: string
    icon: Icon
    items: ReleaseItem[]
}) => {
    if (items.length === 0) return null
    return (
        <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg bg-colorFillTertiary px-3 py-2.5 text-[14px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
                <span className="inline-flex size-6 items-center justify-center rounded-[5px] bg-background text-foreground">
                    <SectionIcon size={13} aria-hidden />
                </span>
                {title}
                <span className="-ml-1 font-normal text-muted-foreground">{items.length}</span>
                <CaretDown
                    size={14}
                    aria-hidden
                    className="ml-auto text-muted-foreground group-open:rotate-180"
                />
            </summary>
            <ul className="m-0 grid list-none grid-cols-[max-content_1fr] items-start gap-x-4 gap-y-3 px-3 pb-2 pt-3">
                {items.map((item, index) => (
                    <li key={`${item.area}-${index}`} className="contents">
                        <span className="inline-flex items-center gap-1.5 justify-self-start rounded-full bg-colorFillTertiary px-2.5 py-0.5 text-[12px] font-medium leading-5 text-foreground">
                            <span
                                aria-hidden
                                className={`size-1.5 rounded-full ${areaDot(item.area)}`}
                            />
                            {item.area}
                        </span>
                        <span className="pt-0.5 text-[13.5px] leading-[1.5] text-muted-foreground">
                            {item.text}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    )
}
