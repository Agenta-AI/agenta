/**
 * EntityCommitContent Component
 *
 * Modal content with commit message input and optional context display.
 * Supports version info, changes summary, and diff view via adapter.
 */

import {useState, useEffect, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {
    formatCount,
    generateSlugWithExistingSuffix,
    generateSlugWithSuffix,
    getSlugSuffix,
    isValidSlug,
    regenerateSlugSuffix,
} from "@agenta/shared/utils"
import {CommitMessageInput} from "@agenta/ui/components/presentational"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {DiffView} from "@agenta/ui/editor"
import {cn, textColors} from "@agenta/ui/styles"
import {ArrowClockwise, WarningCircle} from "@phosphor-icons/react"
import {Input, Alert, Typography, Radio, Button, Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {SectionRail} from "../../../drawers/shared/SectionRail"
import {
    commitModalEntityAtom,
    commitModalEntityNameAtom,
    commitModalOriginalEntityNameAtom,
    commitModalEntitySlugAtom,
    commitModalMessageAtom,
    commitModalErrorAtom,
    commitModalCanCommitAtom,
    commitModalContextAtom,
    commitModalActionLabelAtom,
    commitModalSlugEditingAtom,
    commitModalSlugFieldErrorAtom,
    setCommitMessageAtom,
    setCommitEntityNameAtom,
    setCommitEntitySlugAtom,
    setCommitSlugEditingAtom,
    setCommitSlugFieldErrorAtom,
} from "../state"

import AgentChangesSummary from "./changes/AgentChangesSummary"

// Lazy load DiffView to avoid bundling Lexical editor in _app chunk
// const DiffView = dynamic(() => import("@agenta/ui/editor").then((mod) => ({default: mod.DiffView})))

const {Text} = Typography

export interface CommitModeOption {
    id: string
    label: string
}

export interface EntityCommitContentProps {
    commitModes?: CommitModeOption[]
    selectedMode?: string
    onModeChange?: (mode: string) => void
    extraContent?: React.ReactNode
    /** Label for the target in the version display when a non-default mode is selected (e.g. new variant name) */
    modeLabel?: string
    /** When true, shows the entity name as an editable input field (for Create flows) */
    entityNameEditable?: boolean
    /** Label for the editable entity name field. Defaults to "Name". */
    entityNameLabel?: string
    /** Footer rendered inside the right pane (agent two-pane layout). */
    footerSlot?: React.ReactNode
}

/**
 * EntityCommitContent
 *
 * Shows:
 * - Version transition (if provided by adapter)
 * - Changes summary (if provided by adapter)
 * - Diff view (if provided by adapter)
 * - Commit message textarea
 * - Error alert if any
 * - Warning if entity cannot be committed
 *
 * Layout:
 * - Without diff: Single column layout
 * - With diff: Two-column layout (form left, diff right)
 */
export function EntityCommitContent({
    commitModes,
    selectedMode,
    onModeChange,
    extraContent,
    modeLabel,
    entityNameEditable = false,
    entityNameLabel = "Name",
    footerSlot,
}: EntityCommitContentProps) {
    const entityName = useAtomValue(commitModalEntityNameAtom)
    const originalEntityName = useAtomValue(commitModalOriginalEntityNameAtom)
    const entitySlug = useAtomValue(commitModalEntitySlugAtom)
    const message = useAtomValue(commitModalMessageAtom)
    const error = useAtomValue(commitModalErrorAtom)
    const canCommit = useAtomValue(commitModalCanCommitAtom)
    const context = useAtomValue(commitModalContextAtom)
    const actionLabel = useAtomValue(commitModalActionLabelAtom)
    const commitEntity = useAtomValue(commitModalEntityAtom)
    // App/artifact name (e.g. "sunday-agent") — clearer than the variant name in the agent title.
    const appName = useAtomValue(workflowMolecule.selectors.artifactName(commitEntity?.id ?? ""))
    const slugEditing = useAtomValue(commitModalSlugEditingAtom)
    const slugFieldError = useAtomValue(commitModalSlugFieldErrorAtom)
    const setMessage = useSetAtom(setCommitMessageAtom)
    const setEntityName = useSetAtom(setCommitEntityNameAtom)
    const setEntitySlug = useSetAtom(setCommitEntitySlugAtom)
    const setSlugEditing = useSetAtom(setCommitSlugEditingAtom)
    const setSlugFieldError = useSetAtom(setCommitSlugFieldErrorAtom)
    const slugInitializedRef = useRef(false)
    const generatedSlugSuffixRef = useRef<string | null>(null)
    const slugManuallyEditedRef = useRef(false)

    useEffect(() => {
        if (!entityNameEditable) {
            slugInitializedRef.current = false
            generatedSlugSuffixRef.current = null
            slugManuallyEditedRef.current = false
            setSlugEditing(false)
            return
        }

        if (!entityName.trim()) {
            generatedSlugSuffixRef.current = null
            slugInitializedRef.current = false
            slugManuallyEditedRef.current = false
            setSlugEditing(false)
            if (entitySlug !== null) {
                setEntitySlug(null)
            }
            return
        }

        if (slugManuallyEditedRef.current) {
            generatedSlugSuffixRef.current = entitySlug ? getSlugSuffix(entitySlug) : null
            slugInitializedRef.current = true
            return
        }

        const generatedSlug = generateSlugWithExistingSuffix(
            entityName,
            generatedSlugSuffixRef.current,
        )
        generatedSlugSuffixRef.current = getSlugSuffix(generatedSlug)

        if (entitySlug !== generatedSlug) {
            setEntitySlug(generatedSlug)
        }

        slugInitializedRef.current = true
    }, [entityNameEditable, entityName, entitySlug, setEntitySlug, setSlugEditing])

    useEffect(() => {
        if (!entityName && !entitySlug) {
            slugInitializedRef.current = false
            generatedSlugSuffixRef.current = null
            slugManuallyEditedRef.current = false
            setSlugEditing(false)
        }
    }, [entityName, entitySlug, setSlugEditing])

    const handleSlugInputChange = (value: string) => {
        slugManuallyEditedRef.current = true
        setEntitySlug(value)
        setSlugFieldError(null)
    }

    const handleRegenerate = () => {
        const generatedSlug = regenerateSlugSuffix(
            entitySlug || entityName,
            generatedSlugSuffixRef.current,
        )
        generatedSlugSuffixRef.current = getSlugSuffix(generatedSlug)
        setEntitySlug(generatedSlug)
        setSlugFieldError(null)
    }

    const handleEditClick = () => {
        if (!entitySlug && entityName.trim()) {
            const generatedSlug = generateSlugWithSuffix(entityName)
            generatedSlugSuffixRef.current = getSlugSuffix(generatedSlug)
            setEntitySlug(generatedSlug)
        }
        setSlugEditing(true)
    }

    const slugValidationError =
        entitySlug && !isValidSlug(entitySlug)
            ? "Slug may only contain a-z, 0-9, hyphens, underscores, and periods."
            : null

    // Defer DiffView mounting until after the first paint so the modal
    // shell and form appear immediately without being blocked by Lexical
    // editor creation + DOM reconciliation.
    const [_, setDiffReady] = useState(false)
    useEffect(() => {
        if (!context?.diffData?.original || !context?.diffData?.modified) {
            setDiffReady(false)
            return
        }
        const id = requestAnimationFrame(() => setDiffReady(true))
        return () => cancelAnimationFrame(id)
    }, [context?.diffData?.original, context?.diffData?.modified])

    // Pre-fill the commit message with the auto-generated summary (agent workflows),
    // without ever clobbering what the user typed.
    const suggestedMessage = context?.suggestedMessage
    const suggestionAppliedRef = useRef<string | null>(null)
    useEffect(() => {
        if (!suggestedMessage || message.trim().length > 0) return
        if (suggestionAppliedRef.current === suggestedMessage) return
        suggestionAppliedRef.current = suggestedMessage
        setMessage(suggestedMessage)
    }, [suggestedMessage, message, setMessage])

    // Build changes description from context
    const changesDescription: string[] = []
    if (context?.changesSummary) {
        const {
            modifiedCount,
            addedCount,
            deletedCount,
            addedColumns,
            renamedColumns,
            deletedColumns,
            description,
        } = context.changesSummary
        // Testcase changes
        if (modifiedCount)
            changesDescription.push(`${formatCount(modifiedCount, "testcase")} modified`)
        if (addedCount) changesDescription.push(`${formatCount(addedCount, "testcase")} added`)
        if (deletedCount)
            changesDescription.push(`${formatCount(deletedCount, "testcase")} deleted`)
        // Column changes
        if (addedColumns) changesDescription.push(`${formatCount(addedColumns, "column")} added`)
        if (renamedColumns)
            changesDescription.push(`${formatCount(renamedColumns, "column")} renamed`)
        if (deletedColumns)
            changesDescription.push(`${formatCount(deletedColumns, "column")} deleted`)
        if (description) changesDescription.push(description)
    }

    // Check if diff data is available
    const hasDiffData = context?.diffData?.original && context?.diffData?.modified

    // Agent/LLM commits get the calm "Statement" left column + section summary.
    const isAgentCommit = !!context?.sections?.length
    const hasVariantMode = !!commitModes?.some((m) => m.id === "variant")

    // Calculate total changes for diff header (testcases + columns)
    const totalChanges =
        (context?.changesSummary?.modifiedCount ?? 0) +
        (context?.changesSummary?.addedCount ?? 0) +
        (context?.changesSummary?.deletedCount ?? 0) +
        (context?.changesSummary?.addedColumns ?? 0) +
        (context?.changesSummary?.renamedColumns ?? 0) +
        (context?.changesSummary?.deletedColumns ?? 0)

    const isAgentTwoPane = isAgentCommit && !!hasDiffData

    // Agent commits render the variant name/slug input inside the rail's "variant"
    // content so the "necessary info" sits with the selected action, not far below it.
    const nameEditorInRail =
        entityNameEditable &&
        isAgentCommit &&
        actionLabel === "Commit" &&
        hasVariantMode &&
        (selectedMode ?? "version") === "variant"

    const nameSlugEditor = (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <label htmlFor="entity-name" className="font-medium text-gray-700">
                    {entityNameLabel}
                </label>
                <Input
                    id="entity-name"
                    value={entityName}
                    onChange={(e) => setEntityName(e.target.value)}
                    placeholder="Enter a name..."
                    autoFocus
                    className={isAgentCommit ? "!bg-[var(--ag-colorFillQuaternary)]" : undefined}
                />
            </div>

            {entitySlug !== null && (
                <div className="flex flex-col gap-1">
                    {slugEditing ? (
                        <>
                            <label htmlFor="entity-slug" className="font-medium mb-1">
                                Slug
                            </label>
                            <Input
                                id="entity-slug"
                                value={entitySlug}
                                onChange={(e) => handleSlugInputChange(e.target.value)}
                                status={slugFieldError || slugValidationError ? "error" : undefined}
                                autoFocus
                                className={
                                    isAgentCommit
                                        ? "!bg-[var(--ag-colorFillQuaternary)] [&_.ant-input]:!bg-transparent"
                                        : undefined
                                }
                                suffix={
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<ArrowClockwise size={14} />}
                                        onClick={handleRegenerate}
                                        title="Regenerate random suffix"
                                    />
                                }
                            />
                            {(slugFieldError || slugValidationError) && (
                                <div className="mt-0.5 flex items-start gap-1 text-[var(--ag-c-FF4D4F)]">
                                    <WarningCircle size={16} className="mt-0.5 shrink-0" />
                                    <span>{slugFieldError ?? slugValidationError}</span>
                                </div>
                            )}
                            {!slugFieldError && !slugValidationError && (
                                <Text className={cn(textColors.tertiary)}>
                                    Edit freely - use the regenerate button to add a random suffix
                                    back.
                                </Text>
                            )}
                        </>
                    ) : (
                        <div className="flex min-w-0 items-center gap-2">
                            <Text className="shrink-0 font-medium">Slug:</Text>
                            <Tag
                                className="min-w-0 max-w-[min(220px,calc(100%-88px))] truncate bg-gray-100 font-mono text-gray-500"
                                title={entitySlug}
                            >
                                {entitySlug}
                            </Tag>
                            <Button
                                type="link"
                                size="small"
                                className="shrink-0"
                                onClick={handleEditClick}
                            >
                                Edit
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )

    return (
        <div
            className={cn(
                "flex overflow-hidden",
                hasDiffData ? "flex-row" : "flex-col gap-4",
                hasDiffData && !isAgentCommit && "h-full gap-4",
            )}
            style={isAgentTwoPane ? {height: "min(450px, 72vh)"} : undefined}
        >
            {/* Form section — agent two-pane: sits on the RIGHT and holds the action footer. */}
            <div
                className={cn(
                    "flex flex-col gap-4",
                    hasDiffData
                        ? isAgentCommit
                            ? "order-2 w-[400px] shrink-0 overflow-hidden border-l border-[var(--ag-colorBorderSecondary)] px-6 py-5 min-h-0"
                            : "w-[320px] shrink-0 overflow-y-auto"
                        : "w-full",
                )}
            >
                {isAgentCommit ? (
                    <Text className="shrink-0 text-base font-semibold">
                        {actionLabel} {appName || originalEntityName}
                    </Text>
                ) : null}

                {/* Body scrolls so a tall variant form can't squeeze the message textarea;
                    the title above and footer below stay pinned. */}
                <div
                    className={cn(
                        "flex flex-col gap-4",
                        isAgentCommit && "min-h-0 flex-1 overflow-y-auto",
                    )}
                >
                    {/* Agent commits: pick where the save lands (rail) + that action's summary (content). */}
                    {context?.versionInfo && actionLabel === "Commit" && isAgentCommit && (
                        <SectionRail
                            items={[
                                {value: "version", label: "New version"},
                                ...(hasVariantMode
                                    ? [{value: "variant", label: "New variant"}]
                                    : []),
                            ]}
                            value={selectedMode ?? "version"}
                            onChange={(v) => onModeChange?.(v)}
                            railWidth="w-[108px]"
                        >
                            {(selectedMode ?? "version") === "variant" ? (
                                <div className="flex flex-col gap-3">
                                    <Text
                                        className={cn(
                                            "text-xs leading-relaxed",
                                            textColors.secondary,
                                        )}
                                    >
                                        Creates a separate variant.{" "}
                                        <span className="font-medium text-[var(--ag-colorText)]">
                                            {appName || originalEntityName}
                                        </span>{" "}
                                        stays on v{context.versionInfo.currentVersion}.
                                    </Text>
                                    {nameEditorInRail ? (
                                        <div className="border-t border-[var(--ag-colorBorderSecondary)] pt-3">
                                            {nameSlugEditor}
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <Text
                                    className={cn("text-xs leading-relaxed", textColors.secondary)}
                                >
                                    Saves as{" "}
                                    <span className="font-medium text-[var(--ag-colorText)]">
                                        version {context.versionInfo.targetVersion}
                                    </span>
                                    . Everyone using {appName || originalEntityName} gets your
                                    changes.
                                </Text>
                            )}
                        </SectionRail>
                    )}

                    {/* Version info panel — hidden when actionLabel is not "Commit" (e.g., "Create")
                    since there's no existing entity to show version transitions for */}
                    {context?.versionInfo && actionLabel === "Commit" && !isAgentCommit && (
                        <div className="rounded-lg border border-zinc-2 bg-zinc-1 p-3">
                            <Text className={textColors.secondary}>
                                {selectedMode === "variant"
                                    ? "This will create a new variant from "
                                    : "This will create a new revision of "}
                                <span className="font-medium">{originalEntityName}</span>.
                            </Text>
                            <div className="mt-2 flex items-center gap-2 min-w-0">
                                <span className="flex items-center gap-1 min-w-0">
                                    <span
                                        className={cn("truncate", textColors.secondary)}
                                        title={originalEntityName}
                                    >
                                        {originalEntityName}
                                    </span>
                                    <VersionBadge
                                        version={context.versionInfo.currentVersion}
                                        variant="chip"
                                        className="shrink-0"
                                    />
                                </span>
                                <span className={cn("shrink-0", textColors.tertiary)}>→</span>
                                {selectedMode === "variant" ? (
                                    <span className="flex items-center gap-1 min-w-0">
                                        <span
                                            className="truncate text-blue-7"
                                            title={modeLabel || entityName || "new variant"}
                                        >
                                            {modeLabel || entityName || "new variant"}
                                        </span>
                                        <span className="shrink-0 rounded bg-blue-1 px-1.5 py-0.5 text-xs font-medium text-blue-7">
                                            v1
                                        </span>
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1 min-w-0">
                                        <span
                                            className={cn("truncate", textColors.secondary)}
                                            title={originalEntityName}
                                        >
                                            {originalEntityName}
                                        </span>
                                        <span className="shrink-0 rounded bg-blue-1 px-1.5 py-0.5 text-xs font-medium text-blue-7">
                                            v{context.versionInfo.targetVersion}
                                        </span>
                                    </span>
                                )}
                            </div>
                            {changesDescription.length > 0 && (
                                <div className={cn("mt-2 text-xs", textColors.tertiary)}>
                                    Changes: {changesDescription.join(", ")}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Cannot commit warning */}
                    {!canCommit && (
                        <Alert
                            type="warning"
                            title="This entity cannot be committed"
                            description="Check that there are changes to commit and the entity is in a valid state."
                            showIcon
                        />
                    )}

                    {/* Commit mode selector (optional) — agent commits use the statement toggle. */}
                    {!isAgentCommit && commitModes && commitModes.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <label htmlFor="commit-mode" className="font-medium text-gray-700">
                                Save mode
                            </label>
                            <Radio.Group
                                id="commit-mode"
                                value={selectedMode}
                                onChange={(e) => onModeChange?.(e.target.value)}
                            >
                                {commitModes.map((mode) => (
                                    <Radio key={mode.id} value={mode.id}>
                                        {mode.label}
                                    </Radio>
                                ))}
                            </Radio.Group>
                        </div>
                    )}

                    {/* Entity name — editable input for Create flows. Agent variant commits
                    render this inside the rail (nameEditorInRail) instead. */}
                    {entityNameEditable && !nameEditorInRail && nameSlugEditor}

                    {/* Additional mode-specific UI injected by consumers — agent commits get a
                    hairline zone divider so Save target / Deploy / Message read as groups. */}
                    {extraContent ? (
                        <div className={cn(isAgentCommit && "border-t border-zinc-2 pt-4")}>
                            {extraContent}
                        </div>
                    ) : null}

                    {/* Commit/Create message — agent: fills spare room but holds a usable
                        floor so it scrolls (not squeezes) when the form above is tall. */}
                    <div
                        className={cn(
                            isAgentCommit &&
                                "flex min-h-[132px] flex-1 flex-col border-t border-zinc-2 pt-4",
                        )}
                    >
                        <CommitMessageInput
                            value={message}
                            onChange={setMessage}
                            label={`${actionLabel} message`}
                            showOptional={false}
                            placeholder="Describe your changes..."
                            minRows={isAgentCommit ? 2 : 3}
                            maxRows={6}
                            disabled={!canCommit}
                            fill={isAgentCommit}
                            className={
                                isAgentCommit
                                    ? "[&_.ant-input-textarea-affix-wrapper]:!bg-[var(--ag-colorFillQuaternary)] [&_textarea]:!bg-transparent"
                                    : undefined
                            }
                        />
                    </div>

                    {/* Error display */}
                    {error && (
                        <Alert
                            type="error"
                            title={`${actionLabel} failed`}
                            description={error.message}
                            className="[&_.ant-alert]:!py-5"
                            showIcon
                        />
                    )}
                </div>

                {/* Action footer lives with the form (agent two-pane). */}
                {footerSlot ? (
                    <div className="-mx-6 -mb-5 mt-auto border-t border-[var(--ag-colorBorderSecondary)] px-6 py-3">
                        {footerSlot}
                    </div>
                ) : null}
            </div>

            {/* Agent workflows: plain-language section summary (JSON stays one click away). */}
            {hasDiffData && context?.sections?.length ? (
                <div className="order-1 flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--ag-colorFillQuaternary)]">
                    <AgentChangesSummary
                        sections={context.sections}
                        original={context.diffData?.original ?? ""}
                        modified={context.diffData?.modified ?? ""}
                        language={context.diffData?.language === "yaml" ? "yaml" : "json"}
                    />
                </div>
            ) : hasDiffData ? (
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-2 bg-zinc-1">
                    <div className="flex items-center justify-between border-b border-zinc-2 bg-zinc-1 px-3 py-2 shrink-0">
                        <Text
                            className={cn(
                                "text-xs font-semibold uppercase tracking-wide",
                                textColors.secondary,
                            )}
                        >
                            Changes preview
                        </Text>
                        <Text className={cn("text-xs", textColors.quaternary)}>
                            {formatCount(totalChanges, "change")}
                        </Text>
                    </div>
                    <div className="flex-1 overflow-auto">
                        <DiffView
                            key={`${context.diffData?.original.length}-${context.diffData?.modified.length}`}
                            original={context.diffData?.original ?? ""}
                            modified={context.diffData?.modified ?? ""}
                            language={context.diffData?.language === "yaml" ? "yaml" : "json"}
                            className="h-full"
                            showErrors
                            enableFolding
                            computeOnMountOnly
                        />
                        {/* {diffReady ? (
                            <Suspense
                                fallback={
                                    <div className="p-4">
                                        <Skeleton active paragraph={{rows: 8}} />
                                    </div>
                                }
                            >
                            </Suspense>
                        ) : (
                            <div className="p-4">
                                <Skeleton active paragraph={{rows: 8}} />
                            </div>
                        )} */}
                    </div>
                </div>
            ) : null}
        </div>
    )
}
