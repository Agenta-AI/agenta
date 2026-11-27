import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"

import {ProviderLogo} from "../sectionGroups"
import type {IntegrationRow} from "../toolUtils"

/** How many logos the stack shows; "+N" after it counts the rest. */
const MAX = 4

/**
 * The agent's connected apps as a stack of small Marks, in the header of the panel's
 * Integrations section: a closed section still shows which apps the agent has.
 */
export function IntegrationLogoStack({
    rows,
    label,
}: {
    rows: IntegrationRow[]
    /** The count in words, for a screen reader: the logos carry no text. */
    label: string
}) {
    return (
        <span className="flex items-center gap-1.5">
            <span className="sr-only">{label}</span>
            <span aria-hidden className="flex items-center -space-x-1">
                {rows.slice(0, MAX).map((row) => (
                    <StackLogo key={row.integration} slug={row.integration} />
                ))}
            </span>
            {rows.length > MAX ? <span aria-hidden>+{rows.length - MAX}</span> : null}
        </span>
    )
}

/** An opaque Mark with a ring in the card's tone, so the stack's edges stay clean. */
function StackLogo({slug}: {slug: string}) {
    const {integration} = useToolIntegrationDetail(slug)
    return (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-background ring-2 ring-muted">
            <ProviderLogo logo={integration?.logo ?? null} size={14} />
        </span>
    )
}
