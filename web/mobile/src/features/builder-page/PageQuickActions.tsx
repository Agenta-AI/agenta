import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {Button} from "@agenta/ui/ui"

import {AgentPicker} from "./AgentPicker"
import type {PageKey} from "./ideas"
import type {AgentRef} from "./paneAgent"

// The kit's small outline button, muted until hovered.
const buttonClass = "shrink-0 text-muted-foreground hover:text-foreground"

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
                <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    className={buttonClass}
                    onClick={() => onFill(t(action.request))}
                >
                    {t(action.label)}
                </Button>
            ))}
            <AgentPicker
                onPick={(agent) => {
                    onPickAgent(agent)
                    onFill(t("builder.page.readyOptimize", {agent: agent.name}))
                }}
                trigger={
                    <Button variant="outline" size="sm" className={buttonClass}>
                        {t("builder.page.quickOptimize")}
                    </Button>
                }
            />
            <Button variant="outline" size="sm" className={buttonClass} onClick={onMoreIdeas}>
                {t("builder.page.moreIdeas")}
            </Button>
        </div>
    )
}
