/** The agent a subagent calls: its current name and its "Open agent" link. Each part takes the
 *  bridge as a required prop and mounts only when the host supplies one, so none of them calls a
 *  hook conditionally. */
import type {ReactNode} from "react"

import type {WorkflowReferenceBridge} from "@agenta/editor/drill-in"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {toolReferenceSlug} from "./itemDescriptors"

/**
 * The agent's CURRENT name, off its artifact, as the section row shows it. `savedSlugs` are the
 * agent's subagent slugs, the set the section's rows read, so this reads the same cached catalog
 * entry for the workflow id. `fallback` until it resolves.
 */
export function SubagentCurrentName({
    bridge,
    slug,
    savedSlugs,
    fallback,
    children,
}: {
    bridge: WorkflowReferenceBridge
    slug: string
    savedSlugs: string[]
    fallback: string
    children: (name: string) => ReactNode
}) {
    const workflowId = bridge.useWorkflowReferenceCatalog(savedSlugs).bySlug[slug]?.workflowId
    const name = useAtomValue(workflowMolecule.selectors.artifactName(workflowId ?? ""))
    return <>{children(name || fallback)}</>
}

/** The agent's saved subagent slugs, in list order: the set the section's rows read. */
export const savedSubagentSlugs = (tools: unknown[]): string[] =>
    tools.map(toolReferenceSlug).filter((slug): slug is string => Boolean(slug))

/** "Open agent": the subagent's own agent screen, in a new tab as in production. */
export function SubagentOpenAgentButton({
    bridge,
    slug,
}: {
    bridge: WorkflowReferenceBridge
    slug: string
}) {
    const t = useT(configItemsCatalog)
    const {detail} = bridge.useSubagentDetail(slug)
    const href = detail?.workflowId ? (bridge.agentHref?.(detail.workflowId) ?? null) : null
    if (!href) return null
    return (
        // A quiet link; -mr-2 puts its text on the card's right edge, the fill hangs outside.
        <Button variant="ghost" size="compact" className="-mr-2" asChild>
            {/* no-underline: a bare anchor picks up the app's link styling inside a button. */}
            <a href={href} target="_blank" rel="noreferrer" className="no-underline">
                <ArrowSquareOut data-icon="inline-start" />
                {t("entityUi.configItems.openAgent")}
            </a>
        </Button>
    )
}
