import {useT} from "@agenta/i18n"
import builderContextCatalog from "@agenta/i18n/catalogs/builder.context"

import type {PagePart} from "./pageContext"

/** Classes of the context chip, unsent and sent (S07): 24 px, radius 6, 12 / 20 text. */
export const chipClass =
    "inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-[6px] bg-zinc-1 px-2 text-[12px] leading-5 text-zinc-8 ring-1 ring-inset ring-colorBorderSecondary"

/** What follows the agent name on the chip, or null when the page part names nothing more. */
export const usePageLabel = () => {
    const t = useT(builderContextCatalog)
    return (page: PagePart | undefined | null): string | null => {
        if (!page) return null
        if (page.kind === "session") return page.session.name ?? null
        return page.item?.name ?? t("builder.context.configuration")
    }
}

/** The chip text: "Support triage · Charged twice for March", or the agent name alone. */
export const chipText = (agentName: string, detail: string | null) =>
    detail ? `${agentName} · ${detail}` : agentName
