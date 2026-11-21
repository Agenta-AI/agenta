import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {PHONE_TOUCH_TARGET_CLASS} from "@agenta/ui/ui"
import {Lightning, SlidersHorizontal, SquaresFour} from "@phosphor-icons/react"
import {ChartColumn} from "lucide-react"

import {AgentPicker} from "./AgentPicker"
import type {Glyph, PageKey} from "./ideas"
import type {AgentRef} from "./paneAgent"

// Drawn 30 px high; a phone gets a 44 px tap area around it.
const buttonClass = `inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-colorBgContainer px-3 text-[13px] leading-5 text-zinc-8 ring-1 ring-inset ring-colorBorderSecondary hover:bg-muted [&>svg]:text-colorTextSecondary ${PHONE_TOUCH_TARGET_CLASS}`

/** The quick actions that put a ready request in the composer (B01). */
const READY: {
    label: PageKey
    request: PageKey
    icon: Glyph
}[] = [
    {label: "builder.page.quickBuild", request: "builder.page.readyBuild", icon: BuilderIcon},
    // The canvas bar chart with axes (B01), as the panel's "Test".
    {label: "builder.page.quickTest", request: "builder.page.readyTest", icon: ChartColumn},
    {label: "builder.page.quickAutomate", request: "builder.page.readyAutomate", icon: Lightning},
]

/**
 * The quick actions of a new builder chat: "Build an agent", "Improve an agent", "Test an agent",
 * "Automate an agent" and "Browse ideas". None sends: a ready request goes into the composer,
 * "Improve an agent" asks which agent and adds its chip, "Browse ideas" opens the ideas.
 */
export const PageQuickActions = ({
    onFill,
    onPickAgent,
    onBrowseIdeas,
}: {
    onFill: (text: string) => void
    onPickAgent: (agent: AgentRef) => void
    onBrowseIdeas: () => void
}) => {
    const t = useT(builderPageCatalog)
    const ready = (index: number) => {
        const action = READY[index]
        const ActionIcon = action.icon
        return (
            <button
                key={action.label}
                type="button"
                className={buttonClass}
                onClick={() => onFill(t(action.request))}
            >
                <ActionIcon aria-hidden size={14} />
                {t(action.label)}
            </button>
        )
    }
    return (
        <div
            // On a phone the rows sit 44 px apart, so the tap areas do not overlap.
            className="flex flex-wrap justify-center gap-1.5 max-md:gap-y-3.5"
            data-testid="builder-page-quick-actions"
        >
            {ready(0)}
            <AgentPicker
                onPick={onPickAgent}
                trigger={
                    <button type="button" className={buttonClass}>
                        <SlidersHorizontal aria-hidden size={14} />
                        {t("builder.page.quickImprove")}
                    </button>
                }
            />
            {ready(1)}
            {ready(2)}
            <button type="button" className={buttonClass} onClick={onBrowseIdeas}>
                <SquaresFour aria-hidden size={14} />
                {t("builder.page.browseIdeas")}
            </button>
        </div>
    )
}
