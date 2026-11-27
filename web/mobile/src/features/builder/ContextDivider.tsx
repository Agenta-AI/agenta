import {useT} from "@agenta/i18n"
import builderContextCatalog from "@agenta/i18n/catalogs/builder.context"
import {SimpleTooltip} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"

/**
 * A divider across the chat, as a messenger draws a new day: the context the following messages
 * were sent with. One at the start, then one only where the agent or its page part changes. It
 * sticks to the top while its messages scroll, until the next one takes its place.
 */
export const ContextDivider = ({text}: {text: string}) => {
    const t = useT(builderContextCatalog)
    return (
        <div
            data-testid="builder-context-divider"
            className="sticky top-0 z-10 flex w-full min-w-0 items-center gap-3 bg-background py-2"
        >
            <span aria-hidden className="h-px min-w-4 flex-1 bg-border-muted" />
            <SimpleTooltip title={`${t("builder.context.title")}: ${text}`}>
                <span className="flex min-w-0 max-w-[80%] items-center gap-1.5 text-meta text-muted-foreground">
                    <Robot aria-hidden size={12} className="shrink-0" />
                    <span className="truncate">{text}</span>
                </span>
            </SimpleTooltip>
            <span aria-hidden className="h-px min-w-4 flex-1 bg-border-muted" />
        </div>
    )
}
