import {useCallback, useMemo, useState} from "react"

import {
    buildConnectionModelGroups,
    providerConnectionsAtom,
    vaultSecretsQueryAtom,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {ProviderDrawer} from "@agenta/entity-ui/secretProvider"
import {ManageProvidersRow, type ProviderGroup} from "@agenta/ui/select-llm-provider"
import {Plus} from "@phosphor-icons/react"
import {atom, useAtomValue} from "jotai"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"

/** Names which surface drove the (global, project-independent) harness catalog lookup. */
const HARNESS_CATALOG_KEY = "agenta:playground:model-picker"

/** Narrowed to the refetch handle — the raw query atom churns identity on every fetch-state flip. */
const vaultRefetchAtom = atom((get) => get(vaultSecretsQueryAtom).refetch)

/** Only claim "nothing connected" once the vault has answered; before that it is just unknown. */
const vaultLoadedAtom = atom((get) => Array.isArray(get(vaultSecretsQueryAtom).data))

/**
 * Prepares LLM provider config data for injection into DrillInUIContext.
 *
 * Returns:
 * - connectionGroupsFor: stored connections as ProviderGroup[], given the caller's static catalog
 * - extraOptionGroups: the same groups with no catalog (so only connections that saved a model
 *   list of their own) — the fallback for callers that have no schema catalog to hand. Callers
 *   that cannot persist a slug filter it through `withoutSlugBoundGroups`.
 * - footerContent: the "Manage model providers" row under the picker, opening the shared drawer
 * - emptyStateContent: the set-up affordance for a project with nothing connected
 * - overlay: the drawers, mounted outside the popup lifecycle
 */
export function useLLMProviderConfig() {
    const connections = useAtomValue(providerConnectionsAtom)
    // The curated model names ("GPT-5.6 Luna"), from the same catalog the agent picker labels its
    // rows off. Null until it resolves, which just leaves the rows on their model ids.
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const vaultLoaded = useAtomValue(vaultLoadedAtom)
    const refetchVault = useAtomValue(vaultRefetchAtom)
    const [isProviderDrawerOpen, setIsProviderDrawerOpen] = useState(false)
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [initialProviderKind, setInitialProviderKind] = useState<string | null>(null)

    // The picker offers one group per stored connection, with the connection slug in each
    // option's metadata so a pick can persist which credential it runs on. A standard
    // connection with no saved model list needs the caller's static catalog (the schema's
    // `choices`) to know what to offer, hence the callback rather than a plain array.
    const connectionGroupsFor = useCallback(
        (catalog?: Record<string, string[]>): ProviderGroup[] =>
            buildConnectionModelGroups({connections, catalog, capabilities}) as ProviderGroup[],
        [connections, capabilities],
    )

    const extraOptionGroups = useMemo<ProviderGroup[]>(
        () => connectionGroupsFor(),
        [connectionGroupsFor],
    )

    // Opens the drawer for a NEW provider with `kind` pre-selected. Exposed via DrillInUIContext
    // (llmProviderConfig) so the package-level Provider credentials rail's "Add Azure/Bedrock/
    // Vertex AI/OpenAI-compatible" rows can reach this OSS-only drawer.
    const openConfigureProvider = useCallback((kind: string) => {
        setInitialProviderKind(kind)
        setIsConfigProviderOpen(true)
    }, [])

    const closeConfigureProvider = useCallback(() => {
        setIsConfigProviderOpen(false)
        setInitialProviderKind(null)
    }, [])

    // Memoized: a fresh element here would churn llmProviderConfig identity every render,
    // fanning out through DrillInUIContext to every config-panel consumer.
    const footerContent = useMemo(
        () => <ManageProvidersRow onClick={() => setIsProviderDrawerOpen(true)} />,
        [],
    )

    // Same dashed pill the agent playground's picker falls back to, so "nothing connected" reads
    // the same wherever a model is chosen. Withheld until the vault answers — an empty picker for
    // a moment beats telling a configured project it has no providers.
    const emptyStateContent = useMemo(
        () =>
            vaultLoaded ? (
                <button
                    type="button"
                    onClick={() => setIsProviderDrawerOpen(true)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-control-sm border border-dashed border-border bg-transparent px-3 py-1.5 text-left text-field-md text-colorTextSecondary hover:border-colorPrimary hover:text-colorText"
                >
                    <Plus size={14} className="shrink-0" />
                    Set up model providers
                </button>
            ) : null,
        [vaultLoaded],
    )

    const drawers = useMemo(
        () => (
            <>
                <ProviderDrawer
                    open={isProviderDrawerOpen}
                    onClose={() => setIsProviderDrawerOpen(false)}
                    // The completion engine's own context: connected list + catalog, no
                    // subscriptions. `playground` means the AGENT playground, whose subscription
                    // rows need a harness this surface never runs.
                    context="completion"
                    connections={connections}
                    onSaved={() => refetchVault()}
                />
                <ConfigureProviderDrawer
                    open={isConfigProviderOpen}
                    initialProviderKind={initialProviderKind ?? undefined}
                    onClose={closeConfigureProvider}
                />
            </>
        ),
        [
            isProviderDrawerOpen,
            connections,
            refetchVault,
            isConfigProviderOpen,
            initialProviderKind,
            closeConfigureProvider,
        ],
    )

    const llmProviderConfig = useMemo(
        () => ({
            connectionGroupsFor,
            extraOptionGroups,
            footerContent,
            emptyStateContent,
            openConfigureProvider,
        }),
        [
            connectionGroupsFor,
            extraOptionGroups,
            footerContent,
            emptyStateContent,
            openConfigureProvider,
        ],
    )

    return useMemo(
        () => ({
            llmProviderConfig,
            overlay: drawers,
        }),
        [llmProviderConfig, drawers],
    )
}
