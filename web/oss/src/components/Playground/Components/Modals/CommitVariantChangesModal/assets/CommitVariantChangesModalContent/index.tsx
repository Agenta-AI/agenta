import {useCallback, useEffect, useMemo, useRef} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {ArrowRight} from "@phosphor-icons/react"
import {Checkbox, Input, Radio, RadioChangeEvent, Select, Tag, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import DiffView from "@/oss/components/Editor/DiffView"
import EnvironmentTagLabel, {deploymentStatusColors} from "@/oss/components/EnvironmentTagLabel"
import CommitNote from "@/oss/components/Playground/assets/CommitNote"
import Version from "@/oss/components/Playground/assets/Version"
import {
    moleculeBackedVariantAtomFamily,
    newestRevisionForVariantIdAtomFamily,
    parametersOverrideAtomFamily,
} from "@/oss/components/Playground/state/atoms"
import {isVariantNameInputValid} from "@/oss/lib/helpers/utils"
import {stripAgentaMetadataDeep} from "@/oss/lib/shared/variant/valueHelpers"
import {transformedPromptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {revisionLabelInfoAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

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
    // Use molecule-backed variant for single source of truth (merged data = serverData + draft)
    const variant = useAtomValue(moleculeBackedVariantAtomFamily(variantId)) as any
    // Get serverData (initial state) - this is the baseline before any edits
    const serverData = useAtomValue(
        useMemo(() => legacyAppRevisionMolecule.atoms.serverData(variantId), [variantId]),
    ) as any
    const latestRevisionForVariant = useAtomValue(
        newestRevisionForVariantIdAtomFamily(variant?.variantId || ""),
    ) as any
    // Get current (modified) ag_config - includes local edits via molecule
    const currentAgConfig = useAtomValue(transformedPromptsAtomFamily(variantId))?.ag_config
    const jsonOverride = useAtomValue(parametersOverrideAtomFamily(variantId))

    // Use revision label API to properly handle local drafts
    const revisionLabelInfo = useAtomValue(
        useMemo(() => revisionLabelInfoAtomFamily(variantId), [variantId]),
    )

    const onChange = useCallback(
        (e: RadioChangeEvent) => {
            setSelectedCommitType({...selectedCommitType, type: e.target.value})
        },
        [selectedCommitType, setSelectedCommitType],
    )

    // Snapshot target revision on first render so it doesn't shift while the modal is open
    const settledTargetRevisionRef = useRef<number | null>(null)

    // Snapshot diff content using refs (no re-renders, computed on first mount)
    const initialOriginalRef = useRef<string | null>(null)
    const initialModifiedRef = useRef<string | null>(null)

    // Reset refs when the target variant changes
    useEffect(() => {
        settledTargetRevisionRef.current = null
        initialOriginalRef.current = null
        initialModifiedRef.current = null
    }, [variantId])

    // Guard against undefined variant during commit invalidation (after all hooks)
    if (!variant) {
        return (
            <div className="flex gap-4">
                <section className="flex flex-col gap-4">
                    <Text>Loading variant data...</Text>
                </section>
            </div>
        )
    }

    // Extract values from the variant object (safe now - after hooks and guard)
    const variantName = variant.variantName

    // Settle the target revision on first render so it stays stable while the modal is open
    if (settledTargetRevisionRef.current === null) {
        settledTargetRevisionRef.current = Number(latestRevisionForVariant?.revision ?? 0) + 1
    }
    const targetRevision = settledTargetRevisionRef.current
    // For diff: compare serverData.parameters (original) vs currentAgConfig (current with edits)
    // variant comes from moleculeBackedVariantAtomFamily which merges serverData + draft
    const modifiedParams =
        commitType === "parameters" && jsonOverride ? jsonOverride : currentAgConfig
    // Use serverData.parameters as the original (initial state before edits)
    // Unwrap ag_config if present (serverData.parameters may have { ag_config: {...} })
    const rawOriginalParams = serverData?.parameters
    const originalParams = rawOriginalParams?.ag_config ?? rawOriginalParams

    // Strip legacy flat fields that are superseded by the structured prompt format.
    // Both server data and transformed output may contain these; they should not
    // appear in the diff since the structured prompt (messages + llm_config) is
    // the canonical representation.
    const legacyKeys = new Set([
        "system_prompt",
        "user_prompt",
        "prompt_template",
        "temperature",
        "model",
        "max_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "input_keys",
        "template_format",
    ])

    const stripLegacyFields = (params: Record<string, any> | undefined): any => {
        if (!params || typeof params !== "object") return params
        if (Array.isArray(params)) return params.map(stripLegacyFields)

        const result = {...params}

        // Check if THIS object has structured prompt fields (messages or llm_config)
        const hasStructuredPrompt = result.messages || result.llm_config

        if (hasStructuredPrompt) {
            for (const key of legacyKeys) {
                delete result[key]
            }
        }

        // Recurse into nested objects
        for (const [key, value] of Object.entries(result)) {
            if (value && typeof value === "object") {
                result[key] = stripLegacyFields(value)
            }
        }

        return result
    }

    const strippedOriginal = stripAgentaMetadataDeep(originalParams)
    const strippedModified = stripAgentaMetadataDeep(modifiedParams)

    const sanitizedOriginalParams = stripLegacyFields(strippedOriginal as any)
    const sanitizedModifiedParams = stripLegacyFields(strippedModified as any)

    // Compute snapshot lazily on first render after mount
    if (variant && initialOriginalRef.current === null && initialModifiedRef.current === null) {
        try {
            initialOriginalRef.current = JSON.stringify(sanitizedOriginalParams ?? {})
            if (modifiedParams !== undefined) {
                initialModifiedRef.current = JSON.stringify(sanitizedModifiedParams ?? {})
            }
        } catch {
            // Keep refs null; we will fall back to live values below
        }
    }

    const environmentOptions = (
        Object.keys(deploymentStatusColors) as (keyof typeof deploymentStatusColors)[]
    ).map((env) => ({
        value: env,
        label: <EnvironmentTagLabel environment={env} />,
    }))

    // Ensure DiffView gets strings even when params are undefined
    const originalForDiff =
        initialOriginalRef.current ?? JSON.stringify(sanitizedOriginalParams ?? {})
    const modifiedForDiff =
        initialModifiedRef.current ?? JSON.stringify(sanitizedModifiedParams ?? {})

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
                                    {/* Use revision label API for proper local draft display */}
                                    <Tag
                                        color="default"
                                        bordered={false}
                                        className="bg-[rgba(5,23,41,0.06)]"
                                    >
                                        {revisionLabelInfo.label}
                                    </Tag>
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
                                    status={
                                        selectedCommitType?.type === "variant" &&
                                        selectedCommitType?.name &&
                                        !isVariantNameInputValid(selectedCommitType.name)
                                            ? "error"
                                            : undefined
                                    }
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
                                {selectedCommitType?.type === "variant" &&
                                    selectedCommitType?.name &&
                                    !isVariantNameInputValid(selectedCommitType.name) && (
                                        <Text className="text-xs text-[#EF4444]">
                                            Variant name must contain only letters, numbers,
                                            underscore, or dash
                                        </Text>
                                    )}
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
