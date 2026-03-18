import {useMemo, useState} from "react"

import {Anthropic, Gemini, Mistral, OpenAi, Together} from "@agenta/ui"
import type {ProviderGroup} from "@agenta/ui/select-llm-provider"
import {Plus} from "@phosphor-icons/react"
import {Button, Divider} from "antd"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {capitalize} from "@/oss/lib/helpers/utils"

const icons = [OpenAi, Gemini, Anthropic, Mistral, Together]

/**
 * Prepares LLM provider config data for injection into DrillInUIContext.
 *
 * Returns:
 * - extraOptionGroups: vault/custom secret models as ProviderGroup[]
 * - footerContent: "Add provider" button rendered in select popups
 * - overlay: ConfigureProviderDrawer mounted outside popup lifecycle
 */
export function useLLMProviderConfig() {
    const {customRowSecrets} = useVaultSecret()
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)

    const extraOptionGroups = useMemo<ProviderGroup[]>(() => {
        return customRowSecrets
            .map((secret) => ({
                label: capitalize(secret.name as string),
                options: (secret.modelKeys ?? []).map((modelKey: string) => ({
                    label: modelKey,
                    value: modelKey,
                    key: modelKey,
                })),
            }))
            .filter((group) => group.options.length > 0)
    }, [customRowSecrets])

    const footerContent = (
        <>
            <Divider className="!mx-0 !my-0.5" />
            <Button
                className="flex items-center justify-between mb-0.5 px-2"
                onClick={() => setIsConfigProviderOpen(true)}
                type="text"
                variant="outlined"
            >
                <span className="flex items-center gap-1">
                    <Plus size={14} /> Add provider
                </span>

                <div className="flex items-center gap-0.5">
                    {icons.map((IconComp, idx) => (
                        <IconComp key={`provider-icon-${idx}`} className="w-5 h-5" />
                    ))}
                </div>
            </Button>
        </>
    )

    const configureProviderDrawer = (
        <ConfigureProviderDrawer
            open={isConfigProviderOpen}
            onClose={() => setIsConfigProviderOpen(false)}
        />
    )

    const llmProviderConfig = useMemo(
        () => ({
            extraOptionGroups,
            footerContent,
        }),
        [extraOptionGroups, footerContent],
    )

    return useMemo(
        () => ({
            llmProviderConfig,
            overlay: configureProviderDrawer,
        }),
        [llmProviderConfig, configureProviderDrawer],
    )
}
