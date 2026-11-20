import {useT} from "@agenta/i18n"
import builderContextCatalog from "@agenta/i18n/catalogs/builder.context"
import {Plus, Robot, X} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {chipClass, chipText, usePageLabel} from "./chipText"
import {usePagePart} from "./pagePart"

/**
 * The context chip of the builder composer: what the next message carries. It reads the page
 * itself (design D13): no prop brings the page or its session id into the builder, so a move on
 * the page renders only this chip. On a phone (M04) the chip is 30 px and its x keeps a 44 px hit
 * area.
 */
export const ContextChip = ({
    projectId,
    agentName,
    phone = false,
}: {
    projectId: string
    agentName: string
    phone?: boolean
}) => {
    const t = useT(builderContextCatalog)
    const label = usePageLabel()
    const part = usePagePart(projectId)
    if (part.removed)
        return (
            <button
                type="button"
                data-testid="builder-context-add"
                onClick={part.restore}
                className={cn(
                    chipClass,
                    "cursor-pointer border-0 hover:text-colorText",
                    phone &&
                        "relative h-[30px] text-[13px] after:absolute after:-inset-y-[7px] after:inset-x-0 after:content-['']",
                )}
            >
                <Plus aria-hidden size={12} />
                {t("builder.context.add")}
            </button>
        )
    const text = chipText(agentName, label(part.page))
    return (
        <span
            data-testid="builder-context-chip"
            className={cn(chipClass, "self-start pr-1", phone && "h-[30px] text-[13px]")}
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
                    className={cn(
                        "flex shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary hover:bg-colorFillSecondary hover:text-colorText",
                        phone
                            ? "relative size-[26px] after:absolute after:-inset-[9px] after:content-['']"
                            : "size-[18px]",
                    )}
                >
                    <X aria-hidden size={12} />
                </button>
            ) : null}
        </span>
    )
}
