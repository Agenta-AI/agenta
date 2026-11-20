import {useT} from "@agenta/i18n"
import builderContextCatalog from "@agenta/i18n/catalogs/builder.context"
import {Plus, Robot, X} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import type {PageContext, PagePart} from "./pageContext"
import {usePagePart} from "./pagePart"

const chipClass =
    "inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md bg-colorFillTertiary px-2 text-xs text-colorTextSecondary ring-1 ring-inset ring-colorBorderSecondary"

/** What follows the agent name on the chip, or null when the page part names nothing more. */
const usePageLabel = () => {
    const t = useT(builderContextCatalog)
    return (page: PagePart | undefined | null): string | null => {
        if (!page) return null
        if (page.kind === "session") return page.session.name ?? null
        return page.item?.name ?? t("builder.context.configuration")
    }
}

/** The chip text: "Support triage · Charged twice for March", or the agent name alone. */
const chipText = (agentName: string, detail: string | null) =>
    detail ? `${agentName} · ${detail}` : agentName

/**
 * The context chip of the builder composer: what the next message carries. It reads the page
 * itself (design D13): no prop brings the page or its session id into the builder, so a move on
 * the page renders only this chip.
 */
export const ContextChip = ({projectId, agentName}: {projectId: string; agentName: string}) => {
    const t = useT(builderContextCatalog)
    const label = usePageLabel()
    const part = usePagePart(projectId)
    if (part.removed)
        return (
            <button
                type="button"
                data-testid="builder-context-add"
                onClick={part.restore}
                className={cn(chipClass, "cursor-pointer border-0 hover:text-colorText")}
            >
                <Plus aria-hidden size={12} />
                {t("builder.context.add")}
            </button>
        )
    const text = chipText(agentName, label(part.page))
    return (
        <span
            data-testid="builder-context-chip"
            className={cn(chipClass, "self-start pr-1")}
            title={`${t("builder.context.title")}: ${text}`}
        >
            <Robot aria-hidden size={12} className="shrink-0" />
            <span className="truncate">{text}</span>
            {part.page ? (
                <button
                    type="button"
                    aria-label={t("builder.context.remove")}
                    title={t("builder.context.remove")}
                    onClick={part.remove}
                    className="flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary hover:bg-colorFillSecondary hover:text-colorText"
                >
                    <X aria-hidden size={12} />
                </button>
            ) : null}
        </span>
    )
}

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
