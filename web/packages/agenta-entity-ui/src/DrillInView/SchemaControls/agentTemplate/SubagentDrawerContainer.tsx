/** The two connected halves of the Subagents section: the picker and the saved list. */
import {useCallback, useMemo} from "react"

import {agentIconAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {agentIconChrome} from "@agenta/ui/agent-icon"
import type {
    WorkflowReferenceBridge,
    WorkflowReferencePayload,
    WorkflowReferenceUI,
} from "@agenta/ui/drill-in"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useFamilyMap} from "../hooks/useFamilyMap"
import {useIntegrationLogos} from "../hooks/useIntegrationLogos"

import {AddSubagentDrawer, type SubagentOption} from "./AddSubagentDrawer"
import {toolReferenceSlug} from "./itemDescriptors"
import {SubagentList, type SubagentListProps} from "./ToolManagementList"

const iconFamily = (id: string) => agentIconAtomFamily(id)

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
    // Gated on `open` throughout: the container outlives the drawer and must idle when closed.
    const projectSlugs = useMemo(
        () => (open ? bridge.workflows.map((w) => w.slug).filter(Boolean) : []),
        [open, bridge.workflows],
    )
    const {
        bySlug,
        failedSlugs,
        loading: catalogLoading,
        retry,
    } = bridge.useWorkflowReferenceCatalog(projectSlugs)

    // The agent being edited, matched on its WORKFLOW id. Offering it to itself loops the runner.
    const selfWorkflowId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId ?? "")) as
        | string
        | undefined

    // Agents only. Every type is undefined while the catalog loads, so the drawer shows loading.
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

    // Icons for the listed agents only: the whole project list leaves permanent family entries.
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
    const logoKeys = useMemo(
        () => agents.flatMap((wf) => bySlug[wf.slug]?.integrations ?? []),
        [agents, bySlug],
    )
    const logoByKey = useIntegrationLogos(logoKeys)

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
                integrations: (entry?.integrations ?? []).map(
                    (key) => logoByKey.get(key) ?? {key, name: key, logo: null},
                ),
                added: saved.has(wf.slug),
            }
        })
    }, [agents, bySlug, iconById, logoByKey, savedSlugs])

    // Sequential on purpose: each add re-reads the freshest config after an await.
    const handleAdd = useCallback(
        async (selected: SubagentOption[]) => {
            // No pinned version: the server reads a bare variant slug as the latest revision.
            for (const option of selected) {
                await onAdd({slug: option.id})
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
            failedCount={failedSlugs.length}
            onRetry={retry}
            onAdd={handleAdd}
            onRemove={handleRemove}
        />
    )
}

/** The Subagents section body. Resolves only the saved slugs: the project-wide workflow list
 *  stays empty until the picker is opened once. */
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
    const {bySlug} = bridge.useWorkflowReferenceCatalog(savedSlugs)

    // Each saved subagent's icon, from the agent it points at. The list stays presentational.
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

    // Marks only what the catalog resolved, so a slow fetch never mislabels a good agent.
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
