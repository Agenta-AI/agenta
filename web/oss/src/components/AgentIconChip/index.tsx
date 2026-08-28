import {agentIconAtomFamily} from "@agenta/entities/workflow"
import {useAgentIconChrome} from "@agenta/entity-ui/agent"
import {AGENT_CHIP_BOX, AGENT_CHIP_FALLBACK} from "@agenta/playground-ui/agent-page-header"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {RobotIcon} from "@phosphor-icons/react"
import {Tooltip} from "antd"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"

// The picker carries the virtualizer, the colour maths and the lazy icon catalog. Only this
// trigger reaches it, and only once opened — the sidebar renders agent icons on every route and
// must not pay for any of it.
const AgentIconPicker = dynamic(
    () => import("@agenta/ui/agent-icon").then((mod) => mod.AgentIconPicker),
    {ssr: false},
)

const CHIP_BOX = `${AGENT_CHIP_BOX} border-0 p-0 outline-offset-2`

/**
 * The playground header's agent chip — the one place the icon is editable. An ephemeral agent has
 * no persisted workflow to key the choice by, so it renders a plain, unclickable chip instead.
 */
export const AgentIconTrigger = ({workflowId}: {workflowId: string | null}) => {
    const [record, setRecord] = useAtom(agentIconAtomFamily(workflowId ?? ""))
    const chrome = useAgentIconChrome(workflowId, {
        size: 15,
        fallbackGlyph: <RobotIcon size={15} weight="fill" />,
        fallbackClassName: AGENT_CHIP_FALLBACK,
    })

    if (!workflowId) {
        return (
            <Tooltip title="Agent">
                <span className={`${CHIP_BOX} ${chrome.className}`} style={chrome.style}>
                    {chrome.glyph}
                </span>
            </Tooltip>
        )
    }

    return (
        <Popover>
            {/* Native title, not antd's Tooltip: Tooltip and PopoverTrigger both clone the child to
                attach a ref, and stacking them makes the trigger drop its handler. */}
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title="Change agent icon"
                    aria-label="Change agent icon"
                    className={`${CHIP_BOX} cursor-pointer ${chrome.className}`}
                    style={chrome.style}
                >
                    {chrome.glyph}
                </button>
            </PopoverTrigger>
            <PopoverContent className="p-0" align="start">
                <AgentIconPicker value={record} onChange={setRecord} />
            </PopoverContent>
        </Popover>
    )
}
