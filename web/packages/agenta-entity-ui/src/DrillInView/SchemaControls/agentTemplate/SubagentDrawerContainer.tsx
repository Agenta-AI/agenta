/**
 * The two connected halves of the Subagents section.
 *
 * {@link AddSubagentDrawer} and {@link SubagentList} stay presentational so the layout can be
 * storied without the project's queries. These wrappers resolve what those surfaces show and turn
 * a click into a saved reference. Both live here because both are the callers of
 * `useSubagentCatalog`, and nothing else is shared between them.
 *
 * Four rules shape the container:
 *
 *  • ONE request per batch, never one per row. The model, the connected apps, the type and the
 *    variant binding all come from `useSubagentCatalog`, which reads the same cached
 *    latest-revision fetch the badges already performed.
 *  • Nothing is fetched while the drawer is CLOSED. The container is always mounted, so an
 *    ungated subscription meant a closed drawer opened one catalog request per connected app in
 *    the whole project.
 *  • Agents only. A saved reference can point at a chat, completion, custom or evaluator
 *    workflow. Those are not offered here, and ones already saved stay visible and marked.
 *  • Adds are sequential. `handleAddWorkflowReference` re-reads the freshest config after an
 *    await, so firing several in parallel lets the last write win and drops the rest.
 */
import {useCallback, useMemo} from "react"

import {toolIntegrationDetailQueryFamily} from "@agenta/entities/gatewayTool"
import {agentIconAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {agentIconChrome} from "@agenta/ui/agent-icon"
import type {
    WorkflowReferenceBridge,
    WorkflowReferencePayload,
    WorkflowReferenceUI,
} from "@agenta/ui/drill-in"
import {Robot} from "@phosphor-icons/react"
import {atom, useAtomValue, type Atom} from "jotai"

import {AddSubagentDrawer, type SubagentOption} from "./AddSubagentDrawer"
import {toolReferenceSlug} from "./itemDescriptors"
import {SubagentList, type SubagentListProps} from "./ToolManagementList"

/**
 * Read one atom-family entry per key in a single subscription.
 *
 * A hook per row is not possible inside a list, and would subscribe each row separately anyway.
 * The keys arrive as a joined string so the memo has one stable dependency; passing an array
 * would rebuild the atom every render.
 */
function useFamilyMap<T>(keysKey: string, family: (key: string) => Atom<T>): Map<string, T> {
    const derived = useMemo(() => {
        const keys = keysKey ? keysKey.split("\n") : []
        return atom((get) => keys.map((key) => [key, get(family(key))] as const))
    }, [keysKey, family])
    const pairs = useAtomValue(derived)
    return useMemo(() => new Map(pairs), [pairs])
}

const iconFamily = (id: string) => agentIconAtomFamily(id)
const logoFamily = (key: string) => toolIntegrationDetailQueryFamily(key)

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
    // Gated on `open` throughout: the container is mounted for the panel's whole life, and the
    // drawer destroys its body on close, so a closed drawer must hold no subscriptions at all.
    const projectSlugs = useMemo(
        () => (open ? bridge.workflows.map((w) => w.slug).filter(Boolean) : []),
        [open, bridge.workflows],
    )
    const {bySlug, loading: catalogLoading} = bridge.useSubagentCatalog(projectSlugs)

    // The agent being edited. Offering it to itself builds a reference loop the runner cannot run.
    // Matched on the WORKFLOW id, because `WorkflowReferenceUI.id` is the workflow while the
    // revision's own slug is a different identifier.
    const selfWorkflowId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId ?? "")) as
        | string
        | undefined

    // Only agents belong here. While the catalog loads every type is undefined, so an empty list
    // in that window would read as "this project has no agents"; the drawer shows loading instead.
    const agents = useMemo(
        () =>
            open
                ? bridge.workflows.filter((w) => {
                      if (!w.slug || (selfWorkflowId && w.id === selfWorkflowId)) return false
                      return bySlug[w.slug]?.type === "agent"
                  })
                : [],
        [open, bridge.workflows, bySlug, selfWorkflowId],
    )

    // Icons for the agents only. Keying on the whole project list also inserted a permanent
    // family entry for every prompt and evaluator, none of which this list draws.
    const idsKey = useMemo(
        () =>
            agents
                .map((w) => w.id)
                .filter(Boolean)
                .join("\n"),
        [agents],
    )
    const iconById = useFamilyMap(idsKey, iconFamily)

    // Logos for every app any listed agent connects, resolved once for the batch.
    const logoKeysKey = useMemo(() => {
        const keys = new Set<string>()
        for (const wf of agents) {
            for (const key of bySlug[wf.slug]?.integrations ?? []) keys.add(key)
        }
        return [...keys].sort().join("\n")
    }, [agents, bySlug])
    const logoByKey = useFamilyMap(logoKeysKey, logoFamily)

    const options = useMemo<SubagentOption[]>(() => {
        const saved = new Set(savedSlugs)
        return agents.map((wf: WorkflowReferenceUI) => {
            const entry = bySlug[wf.slug]
            return {
                id: wf.slug,
                name: wf.name || wf.slug,
                description: wf.description,
                icon: iconById.get(wf.id) ?? null,
                model: entry?.model,
                provider: entry?.provider,
                integrations: (entry?.integrations ?? []).map((key) => {
                    const detail = logoByKey.get(key)?.data?.integration
                    return {key, name: detail?.name ?? key, logo: detail?.logo ?? null}
                }),
                added: saved.has(wf.slug),
            }
        })
    }, [agents, bySlug, iconById, logoByKey, savedSlugs])

    // Sequential on purpose: each add re-reads the freshest config after resolving an input
    // schema, so a parallel batch would have every write start from the same stale array.
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
 * Resolves only the slugs this agent has actually saved. Reading the project-wide workflow list
 * here would have resolved nothing at all, because that list stays empty until the picker is
 * opened once.
 */
export function ConnectedSubagentList({
    bridge,
    ...listProps
}: SubagentListProps & {bridge: WorkflowReferenceBridge}) {
    const savedSlugs = useMemo(
        () =>
            listProps.entries
                .map(({item}) => toolReferenceSlug(item))
                .filter((s): s is string => Boolean(s)),
        [listProps.entries],
    )
    const {bySlug} = bridge.useSubagentCatalog(savedSlugs)

    // Each saved subagent's own icon, drawn from the agent it points at. Resolved here because
    // only this side can reach the per-workflow icon record; the list itself stays presentational.
    const iconIdsKey = useMemo(
        () =>
            savedSlugs
                .map((slug) => bySlug[slug]?.workflowId)
                .filter((id): id is string => Boolean(id))
                .join("\n"),
        [savedSlugs, bySlug],
    )
    const iconById = useFamilyMap(iconIdsKey, iconFamily)
    const chromeBySlug = useMemo(() => {
        const map = new Map<
            string,
            {glyph: React.ReactNode; className: string; style?: React.CSSProperties}
        >()
        for (const slug of savedSlugs) {
            const workflowId = bySlug[slug]?.workflowId
            const chrome = agentIconChrome(workflowId ? (iconById.get(workflowId) ?? null) : null, {
                size: 15,
                fallbackGlyph: <Robot size={15} weight="fill" />,
                fallbackClassName:
                    "bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]",
            })
            map.set(slug, {glyph: chrome.glyph, className: chrome.className, style: chrome.style})
        }
        return map
    }, [savedSlugs, bySlug, iconById])

    // Only marks what the catalog has actually resolved. An unresolved slug stays unmarked, so a
    // slow revision fetch never labels a perfectly good agent "not an agent".
    const nonAgentSlugs = useMemo(() => {
        const slugs = new Set<string>()
        for (const slug of savedSlugs) {
            const type = bySlug[slug]?.type
            if (type && type !== "agent") slugs.add(slug)
        }
        return slugs
    }, [savedSlugs, bySlug])

    return <SubagentList {...listProps} nonAgentSlugs={nonAgentSlugs} chromeBySlug={chromeBySlug} />
}
