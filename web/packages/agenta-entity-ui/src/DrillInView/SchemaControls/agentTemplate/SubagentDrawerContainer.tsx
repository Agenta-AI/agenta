/**
 * SubagentDrawerContainer
 *
 * The data half of the Subagents picker. {@link AddSubagentDrawer} stays presentational so the
 * layout can be storied without the project's queries; this resolves what it shows and turns a
 * click into a saved reference.
 *
 * Three rules shape it:
 *
 *  • ONE request per batch, never one per row. The model, the connected apps and the type all come
 *    from `useSubagentCatalog`, which reads the same cached latest-revision fetch the type badges
 *    already performed. Icons and logos are read through derived atoms over the whole set for the
 *    same reason.
 *  • Agents only. A saved reference can point at a chat, completion, custom or evaluator workflow,
 *    and those are NOT offered here. Ones already saved stay visible, marked, so nobody loses a
 *    reference they cannot see (see SubagentList).
 *  • Adds are sequential. `handleAddWorkflowReference` reads the freshest config after an await,
 *    so firing several in parallel lets the last write win and drops the rest.
 */
import {useCallback, useMemo} from "react"

import {toolIntegrationDetailQueryFamily} from "@agenta/entities/gatewayTool"
import {agentIconAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import type {
    WorkflowReferenceBridge,
    WorkflowReferencePayload,
    WorkflowReferenceUI,
} from "@agenta/ui/drill-in"
import {atom, useAtomValue} from "jotai"

import {AddSubagentDrawer, type SubagentOption} from "./AddSubagentDrawer"
import {SubagentList, type SubagentListProps} from "./ToolManagementList"

export interface SubagentDrawerContainerProps {
    open: boolean
    onClose: () => void
    bridge: WorkflowReferenceBridge
    /** The revision being edited, so the agent cannot be offered itself. */
    revisionId: string | null
    /** Slugs already saved as references on this agent, agent-typed or not. */
    savedSlugs: string[]
    onAdd: (payload: WorkflowReferencePayload) => Promise<void>
    onRemoveSlug: (slug: string) => void
}

export function SubagentDrawerContainer({
    open,
    onClose,
    bridge,
    revisionId,
    savedSlugs,
    onAdd,
    onRemoveSlug,
}: SubagentDrawerContainerProps) {
    const workflows = bridge.workflows
    const {bySlug, loading: catalogLoading} = bridge.useSubagentCatalog(workflows)

    // The agent being edited. Offering it to itself builds a reference loop the runner cannot run.
    // Matched on the WORKFLOW id, not a slug: `WorkflowReferenceUI.id` is the workflow, while the
    // revision's own slug is a different identifier and never matched.
    const selfWorkflowId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId ?? "")) as
        | string
        | undefined

    // Icons for the whole set in one subscription. A hook per row is not possible in a list, and
    // would subscribe each row separately anyway.
    const idsKey = useMemo(
        () =>
            workflows
                .map((w) => w.id)
                .filter(Boolean)
                .join("\n"),
        [workflows],
    )
    const iconsAtom = useMemo(() => {
        const ids = idsKey ? idsKey.split("\n") : []
        return atom((get) => ids.map((id) => [id, get(agentIconAtomFamily(id))] as const))
    }, [idsKey])
    const iconPairs = useAtomValue(iconsAtom)
    const iconById = useMemo(() => new Map(iconPairs), [iconPairs])

    // Only agents belong here. While the catalog loads every type is undefined, so an empty list
    // during that window would read as "this project has no agents"; the drawer shows its loading
    // state instead.
    const agents = useMemo(
        () =>
            workflows.filter((w) => {
                if (!w.slug || (selfWorkflowId && w.id === selfWorkflowId)) return false
                return bySlug[w.slug]?.type === "agent"
            }),
        [workflows, bySlug, selfWorkflowId],
    )

    // Logos for every app any listed agent connects, resolved once for the batch.
    const keysKey = useMemo(() => {
        const keys = new Set<string>()
        for (const wf of agents) {
            for (const key of bySlug[wf.slug]?.integrations ?? []) keys.add(key)
        }
        return [...keys].sort().join("\n")
    }, [agents, bySlug])
    const logosAtom = useMemo(() => {
        const keys = keysKey ? keysKey.split("\n") : []
        return atom((get) =>
            keys.map(
                (key) =>
                    [key, get(toolIntegrationDetailQueryFamily(key)).data?.integration] as const,
            ),
        )
    }, [keysKey])
    const logoPairs = useAtomValue(logosAtom)
    const logoByKey = useMemo(() => new Map(logoPairs), [logoPairs])

    const saved = useMemo(() => new Set(savedSlugs), [savedSlugs])

    const options = useMemo<SubagentOption[]>(
        () =>
            agents.map((wf: WorkflowReferenceUI) => {
                const entry = bySlug[wf.slug]
                const icon = iconById.get(wf.id) ?? null
                return {
                    id: wf.slug,
                    name: wf.name || wf.slug,
                    description: wf.description,
                    icon,
                    model: entry?.model,
                    provider: entry?.provider,
                    integrations: (entry?.integrations ?? []).map((key) => {
                        const detail = logoByKey.get(key)
                        return {key, name: detail?.name ?? key, logo: detail?.logo ?? null}
                    }),
                    added: saved.has(wf.slug),
                }
            }),
        [agents, bySlug, iconById, logoByKey, saved],
    )

    // Sequential on purpose: each add re-reads the freshest config after resolving an input schema,
    // so a parallel batch would have every write start from the same stale array.
    const handleAdd = useCallback(
        async (selected: SubagentOption[]) => {
            for (const option of selected) {
                const entry = bySlug[option.id]
                // No variant means nothing unambiguous to bind to, so skip rather than write a
                // reference the runner cannot resolve.
                if (!entry?.variantId) continue
                await onAdd({slug: option.id, refBy: "variant", variant: entry.variantId})
            }
        },
        [bySlug, onAdd],
    )

    const handleRemove = useCallback(
        (selected: SubagentOption[]) => {
            for (const option of selected) onRemoveSlug(option.id)
        },
        [onRemoveSlug],
    )

    return (
        <AddSubagentDrawer
            open={open}
            onClose={onClose}
            options={options}
            loading={catalogLoading || bridge.workflowsLoading}
            onAdd={handleAdd}
            onRemove={handleRemove}
        />
    )
}

/**
 * The Subagents section body, with each saved reference's type resolved.
 *
 * Split from the plain {@link SubagentList} so the list stays presentational and storiable. Only
 * this wrapper knows that a saved reference can point at something that is not an agent, and it
 * mounts only where the bridge exists, which is what keeps the hook call unconditional.
 */
export function ConnectedSubagentList({
    bridge,
    ...listProps
}: SubagentListProps & {bridge: WorkflowReferenceBridge}) {
    const {bySlug} = bridge.useSubagentCatalog(bridge.workflows)

    // Only marks what the catalog has actually resolved. An unresolved slug stays unmarked, so a
    // slow revision fetch never labels a perfectly good agent "not an agent".
    const nonAgentSlugs = useMemo(() => {
        const slugs = new Set<string>()
        for (const {item} of listProps.entries) {
            const slug = (item as Record<string, unknown> | null)?.slug
            if (typeof slug !== "string") continue
            const type = bySlug[slug]?.type
            if (type && type !== "agent") slugs.add(slug)
        }
        return slugs
    }, [listProps.entries, bySlug])

    return <SubagentList {...listProps} nonAgentSlugs={nonAgentSlugs} />
}
