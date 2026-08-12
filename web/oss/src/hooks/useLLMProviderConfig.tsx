import {useCallback, useMemo, useState} from "react"

import {buildConnectionModelGroups, providerConnectionsAtom} from "@agenta/entities/secret"
import {Anthropic, Gemini, Mistral, OpenAi} from "@agenta/ui"
import type {ProviderGroup} from "@agenta/ui/select-llm-provider"
import {Plus} from "@phosphor-icons/react"
import {Button, Divider} from "antd"
import {useAtomValue} from "jotai"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"

const icons = [OpenAi, Gemini, Anthropic, Mistral]

/**
 * Prepares LLM provider config data for injection into DrillInUIContext.
 *
 * Returns:
 * - connectionGroupsFor: stored connections as ProviderGroup[], given the caller's static catalog
 * - extraOptionGroups: the same groups with no catalog (so only connections that saved a model
 *   list of their own) — the fallback for callers that have no schema catalog to hand. Callers
 *   that cannot persist a slug filter it through `withoutSlugBoundGroups`.
 * - footerContent: "Add custom provider" button rendered in select popups
 * - overlay: ConfigureProviderDrawer mounted outside popup lifecycle
 */
export function useLLMProviderConfig() {
    const connections = useAtomValue(providerConnectionsAtom)
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [initialProviderKind, setInitialProviderKind] = useState<string | null>(null)

    // The picker offers one group per stored connection, with the connection slug in each
    // option's metadata so a pick can persist which credential it runs on. A standard
    // connection with no saved model list needs the caller's static catalog (the schema's
    // `choices`) to know what to offer, hence the callback rather than a plain array.
    const connectionGroupsFor = useCallback(
        (catalog?: Record<string, string[]>): ProviderGroup[] =>
            buildConnectionModelGroups({connections, catalog}) as ProviderGroup[],
        [connections],
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
        () => (
            <>
                <Divider className="!mx-0 !my-0.5" />
                <Button
                    className="mb-0.5 flex w-full items-center justify-between px-2"
                    onClick={() => setIsConfigProviderOpen(true)}
                    type="text"
                    variant="outlined"
                >
                    <span className="flex items-center gap-1">
                        <Plus size={14} /> Add custom provider
                    </span>

                    <div className="flex items-center gap-0.5">
                        {icons.map((IconComp, idx) => (
                            <IconComp key={`provider-icon-${idx}`} className="w-5 h-5" />
                        ))}
                    </div>
                </Button>
            </>
        ),
        [],
    )

    const configureProviderDrawer = useMemo(
        () => (
            <ConfigureProviderDrawer
                open={isConfigProviderOpen}
                initialProviderKind={initialProviderKind ?? undefined}
                onClose={closeConfigureProvider}
            />
        ),
        [isConfigProviderOpen, initialProviderKind, closeConfigureProvider],
    )

    const llmProviderConfig = useMemo(
        () => ({
            connectionGroupsFor,
            extraOptionGroups,
            footerContent,
            openConfigureProvider,
        }),
        [connectionGroupsFor, extraOptionGroups, footerContent, openConfigureProvider],
    )

    return useMemo(
        () => ({
            llmProviderConfig,
            overlay: configureProviderDrawer,
        }),
        [llmProviderConfig, configureProviderDrawer],
    )
}
