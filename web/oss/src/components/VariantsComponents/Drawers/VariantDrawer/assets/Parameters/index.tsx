import {useCallback, useMemo} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
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

    const draftConfig = useAtomValue(legacyAppRevisionMolecule.atoms.draftParameters(revisionId))
    const update = useSetAtom(legacyAppRevisionMolecule.reducers.update)

    const configJsonString = useMemo(() => {
        // When viewing original, always show the saved revision parameters
        if (showOriginal) {
            const base = (selectedVariant as any)?.parameters ?? {}
            return getYamlOrJson("JSON", base)
        }

        // Fall back to saved parameters when draft config is empty
        // (e.g., drawer context where molecule data isn't populated)
        if (!draftConfig || Object.keys(draftConfig).length === 0) {
            const params = (selectedVariant as any)?.parameters ?? {}
            const base = params.ag_config ?? params
            return getYamlOrJson("JSON", base)
        }

        // DEBUG: check for enhanced wrappers in config view data
        const configStr = JSON.stringify(draftConfig)
        const hasEnhanced = configStr.includes("__id") || configStr.includes("__metadata")
        console.debug("[ParametersView]", revisionId?.slice(0, 8), {
            source: "draftConfig",
            hasEnhancedWrappers: hasEnhanced,
            keys: Object.keys(draftConfig),
            sample: configStr.slice(0, 300),
        })

        return getYamlOrJson("JSON", draftConfig)
    }, [draftConfig, showOriginal, selectedVariant, revisionId])

    const onChange = useCallback(
        (value: string) => {
            if (showOriginal) return
            if (!value) return

            try {
                const parsed = JSON.parse(value || "{}")
                update(revisionId, {parameters: {ag_config: parsed}})
            } catch (error) {
                // Ignore parse errors; editor will keep showing the current text
            }
        },
        [showOriginal, revisionId, update],
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
