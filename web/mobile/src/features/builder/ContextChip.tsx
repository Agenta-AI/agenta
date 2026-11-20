import {useT} from "@agenta/i18n"
import builderContextCatalog from "@agenta/i18n/catalogs/builder.context"
import {Plus, Robot, X} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {chipClass, chipText, usePageLabel} from "./chipText"
import {usePagePart} from "./pagePart"

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
