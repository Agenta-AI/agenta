import {type ReactNode} from "react"

import {agentIconAtomFamily} from "@agenta/entities/workflow"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"

import {AGENT_FOCUS_RING} from "./chrome"

// The picker carries the virtualizer, the colour maths and the lazy icon catalog. Only this
// trigger reaches it, and only once opened — every screen renders agent icons and must not pay.
const AgentIconPicker = dynamic(
    () => import("@agenta/ui/agent-icon").then((mod) => mod.AgentIconPicker),
    {ssr: false},
)

/**
 * Pick one agent's glyph and colour from a panel anchored to the chip.
 *
 * The panel is the desktop's own `AgentIconPicker`, rendered verbatim, so the two surfaces cannot
 * drift on what the control looks like or how it behaves. It is 300px wide and clears a 375px
 * phone with room either side, which is why this is a popover on every width rather than a sheet.
 *
 * Saves as you pick. There is no confirm — outside-click and Escape close it.
 */
export const AgentIconPopover = ({
    workflowId,
    children,
}: {
    workflowId: string
    /** The chip drawn by the caller; it becomes the popover's trigger and its anchor. */
    children: ReactNode
}) => {
    const [record, setRecord] = useAtom(agentIconAtomFamily(workflowId))

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="Change agent icon"
                    className={`flex shrink-0 cursor-pointer items-center rounded-lg border-0 bg-transparent p-0 ${AGENT_FOCUS_RING}`}
                >
                    {children}
                </button>
            </PopoverTrigger>
            {/* `w-auto p-0`: the panel sizes and pads itself. The max-height is inert at phone
                heights and only engages in landscape, where the panel would run off the screen. */}
            <PopoverContent
                align="start"
                collisionPadding={12}
                className="max-h-[var(--radix-popover-content-available-height)] w-auto overflow-y-auto p-0"
            >
                <AgentIconPicker value={record} onChange={setRecord} />
            </PopoverContent>
        </Popover>
    )
}
