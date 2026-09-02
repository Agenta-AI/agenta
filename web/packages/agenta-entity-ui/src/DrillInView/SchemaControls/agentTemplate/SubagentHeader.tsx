/** The subagent drawer header's two resolved parts. Both take the bridge as a required prop and
 *  mount only when the host supplies one, so neither calls a hook conditionally. */
import {agentIconAtomFamily} from "@agenta/entities/workflow"
import {agentIconChrome} from "@agenta/ui/agent-icon"
import type {WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

export function SubagentHeaderIcon({
    bridge,
    slug,
}: {
    bridge: WorkflowReferenceBridge
    slug: string
}) {
    const {detail} = bridge.useSubagentDetail(slug)
    const record = useAtomValue(agentIconAtomFamily(detail?.workflowId ?? ""))
    const chrome = agentIconChrome(record, {
        size: 16,
        fallbackGlyph: <Robot size={16} weight="fill" />,
        fallbackClassName: "bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]",
    })
    return (
        <span
            className={cn("flex size-8 items-center justify-center rounded-md", chrome.className)}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}

export function SubagentOpenAgentButton({
    bridge,
    slug,
}: {
    bridge: WorkflowReferenceBridge
    slug: string
}) {
    const {detail} = bridge.useSubagentDetail(slug)
    const href = detail?.workflowId ? (bridge.agentHref?.(detail.workflowId) ?? null) : null
    if (!href) return null
    return (
        <Button variant="outline" size="sm" asChild>
            {/* no-underline: a bare anchor picks up the app's link styling inside a button. */}
            <a href={href} target="_blank" rel="noreferrer" className="no-underline">
                Open agent
            </a>
        </Button>
    )
}
