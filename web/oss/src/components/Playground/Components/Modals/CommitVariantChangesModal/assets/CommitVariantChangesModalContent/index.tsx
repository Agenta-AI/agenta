import {useCallback, useEffect, useRef} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Checkbox, Input, Radio, RadioChangeEvent, Select, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import DiffView from "@/oss/components/Editor/DiffView"
import CommitNote from "@/oss/components/Playground/assets/CommitNote"
import Version from "@/oss/components/Playground/assets/Version"
import EnvironmentTagLabel, {deploymentStatusColors} from "@/oss/components/EnvironmentTagLabel"
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
    shouldDeploy,
    onToggleDeploy,
    selectedEnvironment,
    onSelectEnvironment,
    isDeploymentPending,
}: CommitVariantChangesModalContentProps) => {
    // Get variant metadata and derived prompts (prefers local cache, falls back to spec)
    const variant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
    // const prompts = useAtomValue(promptsAtomFamily(variantId)) || []

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

    // Extract values from the variant object (safe now)
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

    const onChange = useCallback(
        (e: RadioChangeEvent) => {
            setSelectedCommitType({...selectedCommitType, type: e.target.value})
        },
        [selectedCommitType, setSelectedCommitType],
    )

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

    const environmentOptions = (
        Object.keys(deploymentStatusColors) as Array<keyof typeof deploymentStatusColors>
    ).map((env) => ({
        value: env,
        label: <EnvironmentTagLabel environment={env} />,
    }))

    // Ensure DiffView gets strings even when params are undefined
    const originalForDiff = initialOriginalRef.current ?? JSON.stringify(oldParams ?? {})
    const modifiedForDiff = initialModifiedRef.current ?? JSON.stringify(params ?? oldParams ?? {})

    return (
        <div className="flex h-full min-h-0 flex-col gap-6 md:flex-row">
            <section className="flex w-full flex-col gap-4 md:max-w-sm md:flex-shrink-0">
                <div className="">
                    <Text className="mb-2 block text-sm font-medium text-[#0F172A]">
                        How would you like to save the changes?
                    </Text>
                    <div className="flex flex-col gap-4">
                        <div className="rounded-lg border border-transparent p-2 transition-colors hover:border-[#CBD5F5]">
                            <Radio
                                value="version"
                                checked={selectedCommitType?.type === "version"}
                                onChange={onChange}
                            >
                                <span className="inline-flex items-center gap-1">
                                    As a new version
                                    <Tooltip title="Creates a new version within this variant’s history.">
                                        <span className="text-[#64748B]">ⓘ</span>
                                    </Tooltip>
                                </span>
                            </Radio>
                            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6 text-sm text-[#475569]">
                                <Text className="font-medium text-[#0F172A]">{variantName}</Text>
                                <div className="flex items-center gap-2">
                                    <Version revision={revision} />
                                    <ArrowRight size={14} />
                                    <Version revision={targetRevision} />
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-transparent p-2 transition-colors hover:border-[#CBD5F5]">
                            <Radio
                                value="variant"
                                checked={selectedCommitType?.type === "variant"}
                                onChange={onChange}
                            >
                                <span className="inline-flex items-center gap-1">
                                    As a new variant
                                    <Tooltip title="Creates a separate variant (branch) with its own independent history.">
                                        <span className="text-[#64748B]">ⓘ</span>
                                    </Tooltip>
                                </span>
                            </Radio>
                            <div className="mt-2 flex flex-col gap-2 pl-6">
                                <Input
                                    placeholder="A unique variant name"
                                    className="w-full max-w-xs"
                                    value={selectedCommitType?.name}
                                    disabled={selectedCommitType?.type !== "variant"}
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
                    </div>
                </div>

                <div className="">
                    <div className="flex flex-col gap-2">
                        <Checkbox
                            checked={shouldDeploy}
                            onChange={(event) => onToggleDeploy(event.target.checked)}
                            disabled={isDeploymentPending}
                        >
                            <span className="inline-flex items-center gap-1">
                                Deploy after commit
                                <Tooltip title="Immediately start a deployment of this version to the selected environment.">
                                    <span className="text-[#64748B]">ⓘ</span>
                                </Tooltip>
                            </span>
                        </Checkbox>
                        <Select
                            placeholder="Select environment"
                            options={environmentOptions}
                            value={selectedEnvironment ?? undefined}
                            onChange={(value) => onSelectEnvironment((value as string) ?? null)}
                            disabled={!shouldDeploy || isDeploymentPending}
                            className="w-full"
                            optionLabelProp="label"
                            popupMatchSelectWidth={false}
                        />
                    </div>
                </div>

                <CommitNote
                    note={note}
                    setNote={setNote}
                    className=""
                    textareaClassName=""
                    text={
                        <span className="inline-flex items-center gap-1">
                            Notes
                            <Tooltip title="Short, clear context helps teammates understand what changed.">
                                <span className="text-[#64748B]">ⓘ</span>
                            </Tooltip>
                        </span>
                    }
                />
            </section>

            <section className="flex min-h-[260px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E0E7EF] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
                <div className="border-b border-[#E2E8F0] px-4 py-3">
                    <Text className="text-sm font-medium text-[#0F172A]">Changes preview</Text>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
                    <DiffView
                        original={originalForDiff}
                        modified={modifiedForDiff}
                        language="json"
                        className="h-full min-h-0 rounded-lg border border-[#E2E8F0]"
                        computeOnMountOnly
                        showErrors={true}
                        enableFolding
                    />
                </div>
            </section>
        </div>
    )
}

export default CommitVariantChangesModalContent
