import {useCallback, useMemo} from "react"

import {
    legacyAppRevisionEntityWithBridgeAtomFamily,
    legacyAppRevisionMolecule,
    revisionOpenApiSchemaAtomFamily,
    derivePromptsFromOpenApiSpec,
    deriveCustomPropertiesFromOpenApiSpec,
} from "@agenta/entities/legacyAppRevision"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {useAtomValue, useSetAtom} from "jotai"

import {getYamlOrJson} from "@/oss/lib/helpers/utils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/types"

export const NewVariantParametersView = ({
    selectedVariant,
    showOriginal,
}: {
    selectedVariant: EnhancedVariant
    showOriginal?: boolean
}) => {
    const revisionId = (selectedVariant as any)?._revisionId || selectedVariant?.id

    const spec = useAtomValue(revisionOpenApiSchemaAtomFamily(revisionId ?? ""))
    const entity = useAtomValue(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId ?? ""))
    const routePath = entity?.routePath || ""

    // Entity-native ag_config from current draft state (enhanced → raw conversion)
    const draftConfig = useAtomValue(legacyAppRevisionMolecule.atoms.draftParameters(revisionId))
    const setPrompts = useSetAtom(legacyAppRevisionMolecule.reducers.setEnhancedPrompts)
    const setCustomProps = useSetAtom(
        legacyAppRevisionMolecule.reducers.setEnhancedCustomProperties,
    )

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

        // Fall back to saved parameters when draft config is empty
        // (e.g., drawer context where molecule data isn't populated)
        if (!draftConfig || Object.keys(draftConfig).length === 0) {
            const params = (selectedVariant as any)?.parameters ?? {}
            const base = params.ag_config ?? params
            return getYamlOrJson("JSON", base)
        }
        return getYamlOrJson("JSON", draftConfig)
    }, [draftConfig, showOriginal, spec, selectedVariant])

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

                const nextPrompts = derivePromptsFromOpenApiSpec(
                    variantForDerive.parameters as Record<string, unknown> | undefined,
                    spec as any,
                    routePath,
                ) as any

                const nextCustomProps = deriveCustomPropertiesFromOpenApiSpec(
                    variantForDerive.parameters as Record<string, unknown> | undefined,
                    spec as any,
                    routePath,
                ) as Record<string, any>

                setPrompts(revisionId, nextPrompts)
                setCustomProps(revisionId, nextCustomProps)
            } catch (error) {
                // Ignore parse errors; editor will keep showing the current text
            }
        },
        [showOriginal, spec, routePath, setPrompts, setCustomProps, selectedVariant],
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
