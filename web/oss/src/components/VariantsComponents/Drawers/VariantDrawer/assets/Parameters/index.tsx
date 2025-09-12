import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import isEqual from "fast-deep-equal"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import {getYamlOrJson} from "@/oss/lib/helpers/utils"
import {VariantUpdateFunction} from "@/oss/lib/hooks/useStatelessVariants/types"
import {derivePromptsFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {
    transformedPromptsAtomFamily,
    promptsAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

const SharedEditor = dynamic(() => import("@/oss/components/Playground/Components/SharedEditor"), {
    ssr: false,
})

export const NewVariantParametersView = ({
    selectedVariant,
    mutateVariant,
    showOriginal,
}: {
    selectedVariant: EnhancedVariant
    parameters?: Record<string, unknown>
    mutateVariant?:
        | ((updates: Partial<EnhancedVariant> | VariantUpdateFunction) => Promise<void>)
        | undefined
    showOriginal?: boolean
}) => {
    // Base parameters are derived from prompts (same structure used for prompt commits)
    const derived = useAtomValue(transformedPromptsAtomFamily(selectedVariant?.id)) as any
    const [override, setOverride] = useAtom(parametersOverrideAtomFamily(selectedVariant?.id))
    const setPrompts = useSetAtom(promptsAtomFamily(selectedVariant?.id))
    const spec = useAtomValue(appSchemaAtom)
    const appUriInfo = useAtomValue(appUriInfoAtom)
    // Epoch used to force remount of the editor only when override is cleared (post-commit reset)
    const [epoch, setEpoch] = useState(0)
    const prevHadOverrideRef = useRef<boolean>(!!override)

    useEffect(() => {
        const had = prevHadOverrideRef.current
        const has = !!override
        // When JSON override is cleared (e.g., after commit), remount the editor to reset content
        if (had && !has) {
            setEpoch((e) => e + 1)
        }
        prevHadOverrideRef.current = has
    }, [override])

    const configJsonString = useMemo(() => {
        // When viewing original, always show the saved revision parameters
        if (showOriginal) {
            const base = (selectedVariant as any)?.parameters ?? {}
            return getYamlOrJson("JSON", base)
        }

        // Live (editable) view:
        // 1) Prefer explicit JSON override if present
        if (override) {
            return getYamlOrJson("JSON", override)
        }

        // 2) If OpenAPI schema isn't available, fall back to saved revision parameters
        if (!spec) {
            const fallback = (selectedVariant as any)?.parameters ?? {}
            return getYamlOrJson("JSON", fallback)
        }

        // 3) Otherwise, use the derived ag_config from prompts/state
        const derivedConfig = derived?.ag_config ?? {}
        return getYamlOrJson("JSON", derivedConfig)
    }, [selectedVariant?.id, override, derived?.ag_config, showOriginal, spec])

    const onChange = useCallback(
        (value: string) => {
            if (showOriginal) return
            if (!value || !selectedVariant?.id) return
            try {
                const parsed = JSON.parse(value || "{}")
                setOverride(parsed)

                // Two-way: update prompts local cache to reflect JSON edits
                if (spec) {
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
                    setPrompts(nextPrompts)
                }
            } catch (error) {
                // Ignore parse errors; editor will keep showing the current text
            }
        },
        [
            showOriginal,
            setOverride,
            selectedVariant?.id,
            spec,
            appUriInfo?.routePath,
            setPrompts,
            selectedVariant,
        ],
    )

    // Keep JSON override in sync when prompts are edited from the UI
    useEffect(() => {
        if (showOriginal) return
        // Do not sync from derived prompts if OpenAPI schema is unavailable
        if (!spec) return
        const ag = derived?.ag_config ?? {}
        if (override && !isEqual(override, ag)) {
            setOverride(ag)
        }
    }, [JSON.stringify(derived?.ag_config), showOriginal, spec])

    return (
        <div className="w-full h-full self-stretch grow" key={selectedVariant?.id}>
            <SharedEditor
                key={`${selectedVariant?.id}-${epoch}`}
                editorProps={{
                    codeOnly: true,
                    validationSchema: {
                        type: "object",
                        properties: {},
                    },
                }}
                editorType="border"
                initialValue={configJsonString}
                value={configJsonString}
                handleChange={onChange}
                disabled={!!showOriginal}
                state={showOriginal ? "readOnly" : "filled"}
                className="!w-[97%] *:font-mono"
            />
        </div>
    )
}
