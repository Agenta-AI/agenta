/**
 * ModelPickerControl — the agent playground's connection-first model menu.
 *
 * Level 1 is one row per stored connection (plus one per subscription PLAN, however many harnesses
 * drive it); level 2 is that connection's models grouped by the harness that runs them. It IS the
 * completion playground's model dropdown (`SelectLLMProviderBase`) — same component, same
 * geometry; the agent context adds the subscription rows and the harness sections, and the
 * completion context has neither. Picking a row sets the model AND its harness, which is why the
 * section has no harness control of its own.
 *
 * The control also owns the one state the menu cannot express: nothing connected at all, where a
 * dashed set-up pill opens the provider drawer instead of a menu.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Model picker in the playground").
 */
import {useCallback, useMemo, useRef, useState, type ReactNode} from "react"

import {subscriptionPairModelsAtom} from "@agenta/entities/secret"
import {agentModelCandidatesAtomFamily, loadAgentModelCandidates} from "@agenta/entities/workflow"
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {
    HarnessTooltip,
    ManageProvidersRow,
    SelectLLMProviderBase,
} from "@agenta/ui/select-llm-provider"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import ProviderDrawer from "../../../secretProvider/ProviderDrawer"
import {
    buildConnectionPickerRows,
    pickerSelectionAfterProviderSave,
    pickerSelectionIsRunnable,
    pickerSelectionFrom,
    selectedModelRowKey,
    type PickerSelection,
} from "../connectionPicker"
import type {ConnectionMode, HarnessCapabilitiesMap} from "../connectionUtils"
import {buildPickerGroupsWithSections} from "../pickerSections"

export interface ModelPickerControlProps {
    capabilities: HarnessCapabilitiesMap | null | undefined
    /** The harness ids a picker may offer (`selectableHarnesses` of the catalog). */
    harnessIds: string[]
    /** The stored harness, so the row the config points at is the one marked. */
    harness: string | null
    modelId: string | null
    provider: string | null
    /** The stored connection mode, so a subscription-only project still gets a menu. */
    mode: ConnectionMode
    /** The stored connection slug, so the right connection's row shows as selected. */
    slug: string | null
    /** Only an uncommitted local agent may replace its automatic template placeholder. */
    replaceable: boolean
    disabled?: boolean
    /**
     * Whether subscription rows belong here — false on cloud, where no provider login can be
     * mounted into the deployment.
     */
    showSubscriptions?: boolean
    /** Writes model + provider + connection + harness in ONE config update. */
    onSelect: (selection: PickerSelection) => void
    /** Rendered when the project has connections but the catalog offers no rows (older backend). */
    fallback: ReactNode
}

const ModelPickerControl = ({
    capabilities,
    harnessIds,
    harness,
    modelId,
    provider,
    mode,
    slug,
    replaceable,
    disabled,
    showSubscriptions = true,
    onSelect,
    fallback,
}: ModelPickerControlProps) => {
    const candidateAtom = agentModelCandidatesAtomFamily(showSubscriptions)
    const candidateState = useAtomValue(candidateAtom)
    const connections = candidateState.connections
    const projectId = useAtomValue(projectIdAtom)
    const userId = useAtomValue(userAtom)?.id
    const pairModelSelection = useAtomValue(subscriptionPairModelsAtom)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const drawerConnectionKeysRef = useRef<string[]>([])
    const candidates = useMemo(
        () =>
            candidateState.candidates.filter((candidate) => harnessIds.includes(candidate.harness)),
        [candidateState.candidates, harnessIds],
    )

    const rows = useMemo(
        () =>
            buildConnectionPickerRows({
                candidates,
                connections,
                capabilities,
            }),
        [candidates, connections, capabilities],
    )

    // The exact row the config points at. `value` alone selects by model id, which lights up every
    // connection offering that id; the stored connection and harness resolve it to one.
    const selectedKey = useMemo(
        () => selectedModelRowKey(rows, {modelId, slug, mode, harness}),
        [rows, modelId, slug, mode, harness],
    )
    const groups = useMemo(() => buildPickerGroupsWithSections(rows), [rows])
    const allSourcesResolved = candidateState.status === "ready"

    const currentSelection = useMemo<PickerSelection | null>(
        () => (modelId && harness ? {modelId, provider, mode, slug, harness} : null),
        [modelId, provider, mode, slug, harness],
    )
    const openProviderDrawer = useCallback(() => {
        drawerConnectionKeysRef.current = connections.map((connection) => connection.id)
        setDrawerOpen(true)
    }, [connections])
    const providerSaved = useCallback(
        async (savedConnectionId?: string) => {
            const previousConnectionKeys = drawerConnectionKeysRef.current
            const currentWasRunnable = pickerSelectionIsRunnable(rows, currentSelection)
            if (!projectId || !userId) return

            const fresh = await loadAgentModelCandidates({
                projectId,
                userId,
                pairModelSelection,
                showSubscriptions,
                refreshVault: true,
            })
            if (!replaceable || fresh.status !== "ready") return
            const freshRows = buildConnectionPickerRows({
                candidates: fresh.candidates.filter((candidate) =>
                    harnessIds.includes(candidate.harness),
                ),
                connections: fresh.connections,
                capabilities: fresh.capabilities,
            })
            const selection = pickerSelectionAfterProviderSave({
                rows: freshRows,
                replaceable,
                savedConnectionId: savedConnectionId ?? null,
                previousConnectionKeys,
                current: currentSelection,
                currentWasRunnable,
            })
            if (selection) onSelect(selection)
        },
        [
            currentSelection,
            harnessIds,
            onSelect,
            pairModelSelection,
            projectId,
            replaceable,
            rows,
            showSubscriptions,
            userId,
        ],
    )

    const drawer = (
        <ProviderDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            context="playground"
            connections={connections}
            showSubscriptions={showSubscriptions}
            onSaved={providerSaved}
        />
    )

    if (!allSourcesResolved) {
        return (
            <div className="w-full rounded-control-sm border border-border px-3 py-1.5 text-field-md text-colorTextTertiary">
                Loading models…
            </div>
        )
    }

    // Nothing connected: the menu would be empty, so the pill IS the call to action. A project
    // already running on a subscription keeps its menu — it has models without a stored key.
    if (allSourcesResolved && rows.every((row) => row.models.length === 0)) {
        return (
            <>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={openProviderDrawer}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-control-sm border border-dashed border-border bg-transparent px-3 py-1.5 text-left text-field-md text-colorTextSecondary hover:border-colorPrimary hover:text-colorText disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <Plus size={14} className="shrink-0" />
                    Set up model providers
                </button>
                {drawer}
            </>
        )
    }

    if (!groups.length) return <>{fallback}</>

    return (
        <>
            <SelectLLMProviderBase
                showGroup
                // Spans the trigger (minus PopoverContent's own `p-1`), with a floor: the two
                // columns need 460px, and the config pane is often narrower than that.
                providerDropdownWidth="max(calc(var(--radix-popover-trigger-width) - 0.5rem), 460px)"
                // Provider names are short; the saved width goes to the model column.
                connectionColumnWidth={200}
                searchPlaceholder="Search models"
                sectionTooltip={<HarnessTooltip />}
                options={groups}
                value={modelId ?? undefined}
                selectedKey={selectedKey}
                onChange={(value, option) => {
                    const picked = Array.isArray(option) ? option[0] : option
                    const metadata = (picked as {metadata?: Record<string, unknown>} | undefined)
                        ?.metadata
                    onSelect(pickerSelectionFrom(value as string, metadata))
                }}
                disabled={disabled}
                placeholder="Select a model…"
                className="w-full"
                footerContent={<ManageProvidersRow onClick={openProviderDrawer} />}
            />
            {drawer}
        </>
    )
}

export default ModelPickerControl
