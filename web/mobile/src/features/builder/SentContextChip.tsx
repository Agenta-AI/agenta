import {useT} from "@agenta/i18n"
import builderContextCatalog from "@agenta/i18n/catalogs/builder.context"
import {Robot} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {chipClass, chipText, usePageLabel} from "./chipText"
import type {PageContext} from "./pageContext"

/**
 * The chip of a sent message: the page part it was sent with. A message sent with the chip
 * removed carries the agent only and shows none.
 */
export const SentContextChip = ({context}: {context: PageContext}) => {
    const t = useT(builderContextCatalog)
    const label = usePageLabel()
    if (!context.page) return null
    const text = chipText(context.agent.name, label(context.page))
    return (
        <span
            data-testid="builder-sent-context"
            className={cn(chipClass, "mb-1 self-end")}
            title={`${t("builder.context.title")}: ${text}`}
        >
            <Robot aria-hidden size={12} className="shrink-0" />
            <span className="truncate">{text}</span>
        </span>
    )
}
