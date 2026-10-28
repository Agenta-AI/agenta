import type {ReleaseItem} from "@agenta/navigation"
import {CaretDown} from "@phosphor-icons/react"

/** A release's improvements or fixes, collapsed by default; renders nothing when empty. */
export const ReleaseItemsSection = ({title, items}: {title: string; items: ReleaseItem[]}) =>
    items.length === 0 ? null : (
        <details className="group border-0 border-t border-solid border-colorBorderSecondary">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[14px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {title}
                <span className="font-normal text-muted-foreground">{items.length}</span>
                <CaretDown
                    size={14}
                    aria-hidden
                    className="ml-auto text-muted-foreground group-open:rotate-180"
                />
            </summary>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 pb-4">
                {items.map((item, index) => (
                    <li
                        key={`${item.area}-${index}`}
                        className="grid grid-cols-[88px_1fr] gap-4 text-[13.5px] leading-[1.5] text-foreground"
                    >
                        <span className="text-muted-foreground">{item.area}</span>
                        <span className="min-w-0">{item.text}</span>
                    </li>
                ))}
            </ul>
        </details>
    )
