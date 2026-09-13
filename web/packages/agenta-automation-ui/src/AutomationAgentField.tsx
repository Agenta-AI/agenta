import {AgentPicker} from "@agenta/entity-ui/agent"

import {AutomationField} from "./AutomationField"

/**
 * Which agent the automation runs — the shared {@link AgentPicker}, in this screen's field frame.
 *
 * The picker is the app's one way to choose an agent, so this file owns only the label, the
 * helper line, and the fact that an automation explains its agents rather than just naming them.
 *
 * The pick is never saved here: both hosts hold the whole config as one unsaved draft (the draft
 * screen until Create, the detail screen until Save), and a field that wrote the binding on its
 * own would make the agent the one setting that changed before the user asked for it. Without
 * `onSelectAgent` it reads as a bound fact rather than offering a dead tap target.
 */
export const AutomationAgentField = ({
    agentId = null,
    agentName,
    onSelectAgent,
    error,
}: {
    /** The agent the draft currently binds. */
    agentId?: string | null
    agentName: string | null
    /** Absent ⇒ the field reads only. */
    onSelectAgent?: (agentId: string) => void
    /** Set after a blocked create: the field is what is missing, and says so in red. */
    error?: string
}) => (
    <AutomationField label="Agent" helper="The agent this automation runs." error={error}>
        <AgentPicker
            value={agentId}
            invalid={Boolean(error)}
            // The read-only case still renders the picker so the bound agent keeps its glyph and
            // its name; `disabled` only takes away the opening.
            onChange={(next) => onSelectAgent?.(next)}
            disabled={!onSelectAgent}
            // An automation is chosen once and runs unattended, so the description earns its
            // line here in a way it does not in a composer someone retargets all day.
            density="relaxed"
            fallbackName={agentName}
            searchPlaceholder="Search agents by name or what they do"
        />
    </AutomationField>
)
