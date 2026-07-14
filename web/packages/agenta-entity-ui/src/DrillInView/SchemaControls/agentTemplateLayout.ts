/**
 * Agent config-panel layout preference.
 *
 * The agent config panel ({@link AgentTemplateControl}) can render its sections as an accordion,
 * tabs, or cards. The chosen layout is a global, persisted UI preference rather than per-variant
 * state, so the selector can live in the variant header menu (away from the panel itself) while the
 * panel reads the same value. Persisted to localStorage so it survives reloads.
 */
import {atomWithStorage} from "jotai/utils"

export type AgentTemplateLayout = "accordion" | "tabs" | "cards"

/** The selectable layouts, in display order. Shared by the panel and the header-menu selector. */
export const AGENT_TEMPLATE_LAYOUTS: {label: string; value: AgentTemplateLayout}[] = [
    {label: "Accordion", value: "accordion"},
    {label: "Tabs", value: "tabs"},
    {label: "Cards", value: "cards"},
]

export const agentTemplateLayoutAtom = atomWithStorage<AgentTemplateLayout>(
    "agenta:agent-config-layout",
    "accordion",
)
