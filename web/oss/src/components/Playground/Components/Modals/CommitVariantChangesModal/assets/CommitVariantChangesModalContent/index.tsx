import {useCallback, useEffect, useRef} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Input, Radio, RadioChangeEvent, Typography} from "antd"
import {useAtomValue} from "jotai"

import DiffView from "@/oss/components/Editor/DiffView"
import CommitNote from "@/oss/components/Playground/assets/CommitNote"
import Version from "@/oss/components/Playground/assets/Version"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {newestRevisionForVariantIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import {transformedPromptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

import {CommitVariantChangesModalContentProps} from "../types"

const {Text} = Typography

const CommitVariantChangesModalContent = ({
    variantId,
    note,
    setNote,
    selectedCommitType,
    setSelectedCommitType,
    commitType,
}: CommitVariantChangesModalContentProps) => {
    // Get variant metadata and derived prompts (prefers local cache, falls back to spec)
    const variant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
    // const prompts = useAtomValue(promptsAtomFamily(variantId)) || []

    // Extract values from the variant object
    const variantName = variant.variantName
    const revision = variant.revision
    // Determine target revision based on the latest revision number for this variant, not the base
    const latestRevisionForVariant = useAtomValue(
        newestRevisionForVariantIdAtomFamily(variant?.variantId || ""),
    ) as any
    const targetRevision = Number(latestRevisionForVariant?.revision ?? 0) + 1

    // Compose a minimal EnhancedVariant-like object using current prompts
    // const composedVariant = {
    //     ...variant,
    //     prompts,
    // } as any
    // Read both sources: prompt-derived params and any JSON override from the editor
    const derivedAgConfig = useAtomValue(transformedPromptsAtomFamily(variantId))?.ag_config
    const jsonOverride = useAtomValue(parametersOverrideAtomFamily(variantId))
    const params = commitType === "parameters" && jsonOverride ? jsonOverride : derivedAgConfig
    // const params =
    // transformToRequestBody({variant: composedVariant})?.ag_config
    const oldParams = variant.parameters

    const onChange = useCallback((e: RadioChangeEvent) => {
        setSelectedCommitType({...selectedCommitType, type: e.target.value})
    }, [])

    // Snapshot diff content using refs (no re-renders, computed on first mount)
    const initialOriginalRef = useRef<string | null>(null)
    const initialModifiedRef = useRef<string | null>(null)

    // Reset refs when the target variant changes
    useEffect(() => {
        initialOriginalRef.current = null
        initialModifiedRef.current = null
    }, [variantId])

    // Compute snapshot lazily on first render after mount
    if (variant && initialOriginalRef.current === null && initialModifiedRef.current === null) {
        try {
            initialOriginalRef.current = JSON.stringify(variant.parameters)
            // Use the same transformed local prompts ag_config that drives dirty-state
            if (params !== undefined) {
                initialModifiedRef.current = JSON.stringify(params)
            }
        } catch {
            // Keep refs null; we will fall back to live values below
        }
    }

    // Guard against undefined variant during commit invalidation (after hooks)
    if (!variant) {
        return (
            <div className="flex gap-4">
                <section className="flex flex-col gap-4">
                    <Text>Loading variant data...</Text>
                </section>
            </div>
        )
    }

    return (
        <div className="flex gap-4">
            <section className="flex flex-col gap-4 h-fit self-start">
                <Text>How would you like to save the changes?</Text>

                <div className="flex flex-col gap-1">
                    <Radio
                        value="version"
                        checked={selectedCommitType?.type === "version"}
                        onChange={onChange}
                    >
                        As a new version
                    </Radio>
                    <div className="ml-6 flex items-center gap-2">
                        <Text className="font-medium">{variantName}</Text>
                        <div className="flex items-center gap-2">
                            <Version revision={revision} />
                            <ArrowRight size={14} />
                            <Version revision={targetRevision} />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <Radio
                        value="variant"
                        checked={selectedCommitType?.type === "variant"}
                        onChange={onChange}
                    >
                        As a new variant
                    </Radio>
                    <div className="ml-6 flex items-center gap-2">
                        <Input
                            placeholder="A unique variant name"
                            className="w-[200px]"
                            value={selectedCommitType?.name}
                            onChange={(e) =>
                                setSelectedCommitType((prev) => {
                                    const prevType = prev?.type
                                    const guaranteedType: "version" | "variant" =
                                        prevType === "version" || prevType === "variant"
                                            ? prevType
                                            : "variant"
                                    return {
                                        type: guaranteedType,
                                        name: e.target.value,
                                    }
                                })
                            }
                            suffix={<Version revision={1} />}
                        />
                    </div>
                </div>

                <CommitNote note={note} setNote={setNote} />
            </section>
            <div className="commit-diff w-[100%] max-w-prose self-stretch overflow-y-auto flex flex-col min-h-0 p-1">
                <DiffView
                    original={initialOriginalRef.current ?? JSON.stringify(oldParams)}
                    modified={initialModifiedRef.current ?? JSON.stringify(params)}
                    language="json"
                    className="border rounded-lg"
                    computeOnMountOnly
                    showErrors={true}
                    enableFolding
                />
            </div>
        </div>
    )
}

export default CommitVariantChangesModalContent
