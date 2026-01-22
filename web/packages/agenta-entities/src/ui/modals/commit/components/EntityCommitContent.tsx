/**
 * EntityCommitContent Component
 *
 * Modal content with commit message input and optional context display.
 * Supports version info, changes summary, and diff view via adapter.
 */

import {formatCount} from "@agenta/shared"
import {cn, DiffView, textColors, VersionBadge} from "@agenta/ui"
import {Input, Alert, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    commitModalEntityNameAtom,
    commitModalMessageAtom,
    commitModalErrorAtom,
    commitModalCanCommitAtom,
    commitModalContextAtom,
    setCommitMessageAtom,
} from "../state"

const {TextArea} = Input
const {Text} = Typography

/** Max length for commit messages */
const COMMIT_MESSAGE_MAX_LENGTH = 500

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
export function EntityCommitContent() {
    const entityName = useAtomValue(commitModalEntityNameAtom)
    const message = useAtomValue(commitModalMessageAtom)
    const error = useAtomValue(commitModalErrorAtom)
    const canCommit = useAtomValue(commitModalCanCommitAtom)
    const context = useAtomValue(commitModalContextAtom)
    const setMessage = useSetAtom(setCommitMessageAtom)

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

    // Calculate total changes for diff header (testcases + columns)
    const totalChanges =
        (context?.changesSummary?.modifiedCount ?? 0) +
        (context?.changesSummary?.addedCount ?? 0) +
        (context?.changesSummary?.deletedCount ?? 0) +
        (context?.changesSummary?.addedColumns ?? 0) +
        (context?.changesSummary?.renamedColumns ?? 0) +
        (context?.changesSummary?.deletedColumns ?? 0)

    return (
        <div
            className={cn(
                "flex gap-4 overflow-hidden h-full",
                hasDiffData ? "flex-row" : "flex-col",
            )}
        >
            {/* Form section */}
            <div
                className={cn(
                    "flex flex-col gap-4 overflow-y-auto",
                    hasDiffData ? "w-[320px] shrink-0" : "w-full",
                )}
            >
                {/* Version info panel (if provided) */}
                {context?.versionInfo && (
                    <div className="rounded-lg border border-zinc-2 bg-zinc-1 p-3">
                        <Text className={textColors.secondary}>
                            This will create a new revision of{" "}
                            <span className="font-medium">{entityName}</span>.
                        </Text>
                        <div className="mt-2 flex items-center gap-2 text-sm">
                            <Text className="font-medium">Version</Text>
                            <VersionBadge
                                version={context.versionInfo.currentVersion}
                                variant="chip"
                            />
                            <span className={textColors.tertiary}>→</span>
                            <span className="rounded bg-blue-1 px-1.5 py-0.5 text-xs font-medium text-blue-7">
                                v{context.versionInfo.targetVersion}
                            </span>
                        </div>
                        {changesDescription.length > 0 && (
                            <div className={cn("mt-2 text-xs", textColors.tertiary)}>
                                Changes: {changesDescription.join(", ")}
                            </div>
                        )}
                    </div>
                )}

                {/* Simple entity info (if no version info) */}
                {!context?.versionInfo && (
                    <p className="text-gray-600">
                        Committing changes to <span className="font-medium">{entityName}</span>
                    </p>
                )}

                {/* Cannot commit warning */}
                {!canCommit && (
                    <Alert
                        type="warning"
                        message="This entity cannot be committed"
                        description="Check that there are changes to commit and the entity is in a valid state."
                        showIcon
                    />
                )}

                {/* Commit message */}
                <div className="flex flex-col gap-2">
                    <label htmlFor="commit-message" className="font-medium text-gray-700">
                        Commit message
                    </label>
                    <TextArea
                        id="commit-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Describe your changes..."
                        autoSize={{minRows: 3, maxRows: 6}}
                        disabled={!canCommit}
                        showCount
                        maxLength={COMMIT_MESSAGE_MAX_LENGTH}
                    />
                </div>

                {/* Error display */}
                {error && (
                    <Alert
                        type="error"
                        message="Commit failed"
                        description={error.message}
                        showIcon
                    />
                )}
            </div>

            {/* Diff view section (if diff data available) */}
            {hasDiffData && (
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
                            key={`${context.diffData.original.length}-${context.diffData.modified.length}`}
                            original={context.diffData.original}
                            modified={context.diffData.modified}
                            language={context.diffData.language === "yaml" ? "yaml" : "json"}
                            className="h-full"
                            showErrors
                            enableFolding
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
