/**
 * EntityCommitContent Component
 *
 * Modal content with commit message input and optional context display.
 * Supports version info, changes summary, and diff view via adapter.
 */

import {DiffView} from "@agenta/ui"
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
        const {modifiedCount, addedCount, deletedCount, description} = context.changesSummary
        if (modifiedCount) changesDescription.push(`${modifiedCount} modified`)
        if (addedCount) changesDescription.push(`${addedCount} added`)
        if (deletedCount) changesDescription.push(`${deletedCount} deleted`)
        if (description) changesDescription.push(description)
    }

    // Check if diff data is available
    const hasDiffData = context?.diffData?.original && context?.diffData?.modified

    // Calculate total changes for diff header
    const totalChanges =
        (context?.changesSummary?.modifiedCount ?? 0) +
        (context?.changesSummary?.addedCount ?? 0) +
        (context?.changesSummary?.deletedCount ?? 0)

    return (
        <div
            className={`flex ${hasDiffData ? "flex-row" : "flex-col"} gap-4 overflow-hidden h-full`}
        >
            {/* Form section */}
            <div
                className={`flex flex-col gap-4 ${hasDiffData ? "w-[320px] shrink-0" : "w-full"} overflow-y-auto`}
            >
                {/* Version info panel (if provided) */}
                {context?.versionInfo && (
                    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                        <Text className="text-[#475569]">
                            This will create a new revision of{" "}
                            <span className="font-medium">{entityName}</span>.
                        </Text>
                        <div className="mt-2 flex items-center gap-2 text-sm">
                            <Text className="font-medium">Version</Text>
                            <span className="rounded bg-[#E2E8F0] px-1.5 py-0.5 text-xs font-medium">
                                v{context.versionInfo.currentVersion}
                            </span>
                            <span className="text-[#64748B]">→</span>
                            <span className="rounded bg-[#DBEAFE] px-1.5 py-0.5 text-xs font-medium text-[#1D4ED8]">
                                v{context.versionInfo.targetVersion}
                            </span>
                        </div>
                        {changesDescription.length > 0 && (
                            <div className="mt-2 text-xs text-[#64748B]">
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
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#FAFBFC]">
                    <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 shrink-0">
                        <Text className="text-xs font-semibold text-[#475569] uppercase tracking-wide">
                            Changes preview
                        </Text>
                        <Text className="text-xs text-[#94A3B8]">
                            {totalChanges} change{totalChanges !== 1 ? "s" : ""}
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
