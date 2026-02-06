import {useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {getYamlOrJson} from "@/oss/lib/helpers/utils"
import {VariantUpdateFunction} from "@/oss/lib/hooks/useStatelessVariants/types"
import {
    deriveCustomPropertiesFromSpec,
    derivePromptsFromSpec,
} from "@/oss/lib/shared/variant/transformer/transformer"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {customPropertiesAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {transformedPromptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

const SharedEditor = dynamic(() => import("@/oss/components/Playground/Components/SharedEditor"), {
    ssr: false,
})

export const NewVariantParametersView = ({
    selectedVariant,
    showOriginal,
}: {
    selectedVariant: EnhancedVariant
    parameters?: Record<string, unknown>
    mutateVariant?:
        | ((updates: Partial<EnhancedVariant> | VariantUpdateFunction) => Promise<void>)
        | undefined
    showOriginal?: boolean
}) => {
    const appUriInfo = useAtomValue(appUriInfoAtom)
    const spec = useAtomValue(appSchemaAtom)

    const revisionId = (selectedVariant as any)?._revisionId || selectedVariant?.id

    // Base parameters are derived from prompts (same structure used for prompt commits)
    const derived = useAtomValue(transformedPromptsAtomFamily(revisionId)) as any
    const promptsAtom = useMemo(() => moleculeBackedPromptsAtomFamily(revisionId), [revisionId])
    const setPrompts = useSetAtom(promptsAtom)

    const customPropsAtom = useMemo(
        () =>
            customPropertiesAtomFamily({
                revisionId,
                routePath: appUriInfo?.routePath,
            }),
        [revisionId, appUriInfo?.routePath],
    )
    const setCustomProps = useSetAtom(customPropsAtom)

    const configJsonString = useMemo(() => {
        // When viewing original, always show the saved revision parameters
        if (showOriginal) {
            const base = (selectedVariant as any)?.parameters ?? {}
            return getYamlOrJson("JSON", base)
        }

        if (!spec) {
            const fallback = (selectedVariant as any)?.parameters ?? {}
            return getYamlOrJson("JSON", fallback)
        }

        const derivedConfig = derived?.ag_config
        // Fall back to saved parameters when transformation produces empty config
        // (e.g., drawer context where playground atoms aren't populated)
        if (!derivedConfig || Object.keys(derivedConfig).length === 0) {
            const params = (selectedVariant as any)?.parameters ?? {}
            const base = params.ag_config ?? params
            return getYamlOrJson("JSON", base)
        }
        return getYamlOrJson("JSON", derivedConfig)
    }, [derived?.ag_config, showOriginal, spec, selectedVariant])

    const onChange = useCallback(
        (value: string) => {
            if (showOriginal) return
            if (!value) return

            try {
                const parsed = JSON.parse(value || "{}")
                if (!spec) return

                const variantForDerive = {
                    ...(selectedVariant as any),
                    parameters: {
                        ...(selectedVariant as any)?.parameters,
                        ag_config: parsed,
                    },
                }

                const nextPrompts = derivePromptsFromSpec(
                    variantForDerive as any,
                    spec as any,
                    appUriInfo?.routePath,
                ) as any

                const nextCustomProps = deriveCustomPropertiesFromSpec(
                    variantForDerive as any,
                    spec as any,
                    appUriInfo?.routePath,
                ) as Record<string, any>

                setPrompts(nextPrompts)
                setCustomProps(nextCustomProps)
            } catch (error) {
                // Ignore parse errors; editor will keep showing the current text
            }
        },
        [showOriginal, spec, appUriInfo?.routePath, setPrompts, setCustomProps, selectedVariant],
    )

    if (!revisionId) return null

    return (
        <div className="w-full h-full self-stretch grow">
            <SharedEditor
                key={`${selectedVariant?.id}-${showOriginal}`}
                editorProps={{
                    codeOnly: true,
                    validationSchema: {
                        type: "object",
                        properties: {},
                    },
                }}
                editorType="border"
                initialValue={configJsonString}
                handleChange={onChange}
                disabled={!!showOriginal}
                state={showOriginal ? "readOnly" : "filled"}
                className="!w-[97%] *:font-mono"
            />
        </div>
    )
}
