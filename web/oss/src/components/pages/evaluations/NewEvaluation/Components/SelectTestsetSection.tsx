import {memo, useMemo} from "react"

import clsx from "clsx"

import TestsetsTable from "@/oss/components/TestsetsTable/TestsetsTable"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import type {SelectTestsetSectionProps} from "../types"

// Regex to extract {{variable}} patterns from prompt text
const VARIABLE_REGEX = /\{\{([^{}]+)\}\}/g

/**
 * Extract variables from a prompt message content string
 */
const extractVariables = (content: string): string[] => {
    const vars: string[] = []
    let match
    while ((match = VARIABLE_REGEX.exec(content)) !== null) {
        vars.push(match[1].trim())
    }
    return vars
}

/**
 * Extract input_keys from variant's parameters (ag_config)
 * This is used for completion/custom apps where inputs are defined in the config
 */
const extractInputKeysFromParameters = (variant: EnhancedVariant): string[] => {
    try {
        const params = (variant as any)?.parameters
        const agConfig = params?.ag_config ?? params ?? {}
        const keys = new Set<string>()

        Object.values(agConfig || {}).forEach((cfg: any) => {
            const arr = cfg?.input_keys
            if (Array.isArray(arr)) {
                arr.forEach((k) => {
                    if (typeof k === "string" && k) keys.add(k)
                })
            }
        })

        return Array.from(keys)
    } catch {
        return []
    }
}

/**
 * Extract input variables from an EnhancedVariant's prompts ({{variable}} patterns)
 * This is used for chat apps where variables are embedded in message templates
 */
const extractVariablesFromPrompts = (variant: EnhancedVariant): string[] => {
    const vars = new Set<string>()

    ;(variant.prompts || []).forEach((prompt: any) => {
        const messages = prompt?.messages?.value || []
        messages.forEach((message: any) => {
            const content = message?.content?.value
            if (typeof content === "string") {
                extractVariables(content).forEach((v) => vars.add(v))
            } else if (Array.isArray(content)) {
                content.forEach((part: any) => {
                    const text = part?.text?.value ?? part?.text ?? ""
                    if (typeof text === "string") {
                        extractVariables(text).forEach((v) => vars.add(v))
                    }
                })
            }
        })
    })

    return Array.from(vars)
}

/**
 * Extract input variables from an EnhancedVariant
 * Combines both input_keys from parameters and {{variables}} from prompts
 */
const extractVariablesFromVariant = (variant: EnhancedVariant): string[] => {
    const vars = new Set<string>()

    // First, try to get input_keys from parameters (for completion/custom apps)
    extractInputKeysFromParameters(variant).forEach((v) => vars.add(v))

    // Then, extract {{variables}} from prompts (for chat apps)
    extractVariablesFromPrompts(variant).forEach((v) => vars.add(v))

    return Array.from(vars)
}

const SelectTestsetSection = ({
    selectedTestsetId,
    selectedTestsetRevisionId,
    setSelectedTestsetId,
    setSelectedTestsetRevisionId,
    selectedTestsetVersion,
    setSelectedTestsetVersion,
    selectedTestsetName,
    setSelectedTestsetName,
    handlePanelChange,
    selectedVariantRevisionIds,
    selectedVariants,
    allowAutoAdvance = true,
    className,
}: SelectTestsetSectionProps) => {
    // Stable flag for whether any revision is selected
    const hasSelectedRevision = useMemo(
        () => (selectedVariantRevisionIds?.length ?? 0) > 0,
        [selectedVariantRevisionIds],
    )

    // Extract expected input variables directly from the selected variant's prompts
    // This ensures we check against the variant selected in the modal, not the global app context
    const expectedVariables = useMemo(() => {
        if (!hasSelectedRevision || !selectedVariants?.length) return []

        // Get the first selected variant (for single selection) or combine all variables
        const allVariables = new Set<string>()
        selectedVariants.forEach((variant) => {
            extractVariablesFromVariant(variant).forEach((v) => allVariables.add(v))
        })

        return Array.from(allVariables)
            .map((variable) => variable.trim())
            .filter(Boolean)
    }, [hasSelectedRevision, selectedVariants])

    const hasExpectedVariables = expectedVariables.length > 0

    return (
        <div className={clsx(className, "w-full h-[calc(100%-16px)] flex flex-col")}>
            {hasExpectedVariables && (
                <div className="mb-2 text-xs text-gray-600">
                    Expected input variables for selected variant(s):{" "}
                    <span className="font-mono">{expectedVariables.join(", ")}</span>
                </div>
            )}
            <div className="flex flex-col grow min-h-0" data-tour="testset-select">
                <TestsetsTable
                    mode="select"
                    className="flex-1 min-h-0"
                    selectedRevisionId={selectedTestsetRevisionId}
                    onSelectRevision={({revisionId, testsetId, testsetName, version}) => {
                        if (selectedTestsetRevisionId === revisionId) {
                            setSelectedTestsetId("")
                            if (setSelectedTestsetRevisionId) {
                                setSelectedTestsetRevisionId("")
                            }
                            if (setSelectedTestsetVersion) {
                                setSelectedTestsetVersion(null)
                            }
                            if (setSelectedTestsetName) {
                                setSelectedTestsetName("")
                            }
                        } else {
                            setSelectedTestsetId(testsetId)
                            if (setSelectedTestsetRevisionId) {
                                setSelectedTestsetRevisionId(revisionId)
                            }
                            if (setSelectedTestsetVersion) {
                                setSelectedTestsetVersion(version ?? null)
                            }
                            if (setSelectedTestsetName && testsetName) {
                                setSelectedTestsetName(testsetName)
                            }
                            if (allowAutoAdvance) {
                                handlePanelChange("evaluatorPanel")
                            }
                        }
                    }}
                />
            </div>
        </div>
    )
}

export default memo(SelectTestsetSection)
