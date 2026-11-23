import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"

import {AgentPicker} from "./AgentPicker"
import type {PageKey} from "./ideas"
import type {AgentRef} from "./paneAgent"

// Drawn 28 px high; a phone gets a 44 px tap area around it.
const buttonClass = `focus-ring inline-flex h-control-sm shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border border-solid border-border-muted bg-background px-3 text-label text-muted-foreground hover:bg-[image:linear-gradient(var(--accent),var(--accent))]`

/** The quick actions that put a ready request in the composer, with no agent to pick. */
const READY: {label: PageKey; request: PageKey}[] = [
    {label: "builder.page.quickSuggest", request: "builder.page.readySuggest"},
    {label: "builder.page.quickCheck", request: "builder.page.readyCheck"},
]

/**
 * The quick actions of a new builder chat: "Suggest improvements", "Check for problems",
 * "Optimize an agent" and "More ideas". None sends: a ready request goes into the composer,
 * "Optimize an agent" first asks which agent, then names it in the request and adds its chip,
 * "More ideas" opens the ideas.
 */
export const PageQuickActions = ({
    onFill,
    onPickAgent,
    onMoreIdeas,
}: {
    onFill: (text: string) => void
    onPickAgent: (agent: AgentRef) => void
    onMoreIdeas: () => void
}) => {
    const t = useT(builderPageCatalog)
    return (
        <div
            // A phone shows one row that scrolls sideways. The 7 px above and below keep the
            // 44 px tap areas inside the scroll box, so it does not cut them.
            className="flex flex-wrap justify-center gap-1.5 max-md:flex-nowrap max-md:justify-start max-md:overflow-x-auto max-md:[scrollbar-width:none]"
            data-testid="builder-page-quick-actions"
        >
            {READY.map((action) => (
                <button
                    key={action.label}
                    type="button"
                    className={buttonClass}
                    onClick={() => onFill(t(action.request))}
                >
                    {t(action.label)}
                </button>
            ))}
            <AgentPicker
                onPick={(agent) => {
                    onPickAgent(agent)
                    onFill(t("builder.page.readyOptimize", {agent: agent.name}))
                }}
                trigger={
                    <button type="button" className={buttonClass}>
                        {t("builder.page.quickOptimize")}
                    </button>
                }
            />
            <button type="button" className={buttonClass} onClick={onMoreIdeas}>
                {t("builder.page.moreIdeas")}
            </button>
        </div>
    )
}
