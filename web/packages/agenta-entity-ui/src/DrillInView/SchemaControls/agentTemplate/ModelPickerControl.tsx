/**
 * ModelPickerControl — the agent playground's connection-first model menu.
 *
 * Level 1 is one row per stored connection (plus a row per subscription), level 2 is that
 * connection's models flat, one row per model and harness pair. Both levels are the platform's
 * existing grouped picker (`SelectLLMProviderBase`, the same cascade the prompt playground uses);
 * only what feeds it changed — groups are connections now, not provider families.
 *
 * The control also owns the two states the menu cannot express: nothing connected at all (a dashed
 * "Set up AI providers" pill that opens the provider drawer instead of a menu) and the one-line
 * explainer for the harness tags, dismissed for good on first read.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Model picker in the playground").
 */
import {useMemo, useState, type ReactNode} from "react"

import {providerConnectionsAtom, vaultSecretsQueryAtom} from "@agenta/entities/secret"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {Plus, X} from "@phosphor-icons/react"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomWithStorage} from "jotai/utils"

import ProviderDrawer from "../../../secretProvider/ProviderDrawer"
import {
    buildConnectionPickerRows,
    buildPickerGroups,
    pickerSelectionFrom,
    type PickerSelection,
} from "../connectionPicker"
import type {ConnectionMode, HarnessCapabilitiesMap} from "../connectionUtils"

/** Dismissed for good: the tags stay, the sentence explaining them is read once. */
const harnessTagExplainerDismissedAtom = atomWithStorage<boolean>(
    "agenta:model-picker:harness-tag-explainer-dismissed",
    false,
)

/** Narrowed to the refetch handle — the raw query atom churns identity on every fetch-state flip. */
const vaultRefetchAtom = atom((get) => get(vaultSecretsQueryAtom).refetch)

/** Only claim "nothing connected" once the vault has answered; before that it is just unknown. */
const vaultLoadedAtom = atom((get) => Array.isArray(get(vaultSecretsQueryAtom).data))

export interface ModelPickerControlProps {
    capabilities: HarnessCapabilitiesMap | null | undefined
    /** The harness ids a picker may offer (`selectableHarnesses` of the catalog). */
    harnessIds: string[]
    modelId: string | null
    /** The stored connection mode, so a subscription-only project still gets a menu. */
    mode: ConnectionMode
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
    modelId,
    mode,
    disabled,
    showSubscriptions = true,
    onSelect,
    fallback,
}: ModelPickerControlProps) => {
    const connections = useAtomValue(providerConnectionsAtom)
    const vaultLoaded = useAtomValue(vaultLoadedAtom)
    const refetchVault = useAtomValue(vaultRefetchAtom)
    const [explainerDismissed, dismissExplainer] = useAtom(harnessTagExplainerDismissedAtom)
    const [drawerOpen, setDrawerOpen] = useState(false)

    const groups = useMemo(
        () =>
            buildPickerGroups(
                buildConnectionPickerRows({
                    connections,
                    capabilities,
                    harnessIds,
                    showSubscriptions,
                }),
            ),
        [connections, capabilities, harnessIds, showSubscriptions],
    )

    const drawer = (
        <ProviderDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            context="playground"
            connections={connections}
            showSubscriptions={showSubscriptions}
            onSaved={() => refetchVault()}
        />
    )

    // Nothing connected: the menu would be empty, so the pill IS the call to action. A project
    // already running on a subscription keeps its menu — it has models without a stored key.
    if (vaultLoaded && !connections.length && mode !== "self_managed") {
        return (
            <>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setDrawerOpen(true)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-control-sm border border-dashed border-border bg-transparent px-3 py-1.5 text-left text-field-md text-colorTextSecondary hover:border-colorPrimary hover:text-colorText disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <Plus size={14} className="shrink-0" />
                    Set up AI providers
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
                providerDropdownWidth={580}
                options={groups}
                value={modelId ?? undefined}
                onChange={(value, option) => {
                    const picked = Array.isArray(option) ? option[0] : option
                    const metadata = (picked as {metadata?: Record<string, unknown>} | undefined)
                        ?.metadata
                    onSelect(pickerSelectionFrom(value as string, metadata))
                }}
                disabled={disabled}
                placeholder="Select a model…"
                className="w-full"
                panelHeader={
                    explainerDismissed ? undefined : (
                        <div className="flex items-center gap-2 text-field-sm text-colorTextSecondary">
                            <span className="flex-1">
                                The tag names the harness — the program that runs the model and its
                                tools.
                            </span>
                            <button
                                type="button"
                                aria-label="Dismiss the harness explainer"
                                onClick={() => dismissExplainer(true)}
                                className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-colorTextTertiary"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    )
                }
                footerContent={
                    <div className="border-0 border-t border-solid border-border p-1">
                        <button
                            type="button"
                            onClick={() => setDrawerOpen(true)}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-control-sm border-0 bg-transparent px-3 py-1.5 text-left text-field-md text-colorText hover:bg-muted"
                        >
                            <Plus size={14} className="shrink-0" />
                            Add provider
                        </button>
                    </div>
                }
            />
            {drawer}
        </>
    )
}

export default ModelPickerControl
