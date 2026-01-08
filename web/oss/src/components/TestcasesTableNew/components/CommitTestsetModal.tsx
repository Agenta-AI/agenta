import {memo, useEffect, useRef, useState} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Input, Modal, Tooltip, Typography} from "antd"

import DiffView from "@/oss/components/Editor/DiffView"
import {COMMIT_MESSAGE_MAX_LENGTH} from "@/oss/config/constants"

const {Text} = Typography

export interface TestsetChangesSummary {
    /** Number of modified testcases */
    modifiedCount: number
    /** Number of added testcases */
    addedCount: number
    /** Number of deleted testcases */
    deletedCount: number
    /** Original data for diff (JSON string) */
    originalData?: string
    /** Modified data for diff (JSON string) */
    modifiedData?: string
}

interface CommitTestsetModalProps {
    open: boolean
    onCancel: () => void
    onCommit: (message: string) => Promise<void>
    isCommitting: boolean
    currentVersion?: number
    latestVersion?: number
    changesSummary?: TestsetChangesSummary
}

const CommitTestsetModal = ({
    open,
    onCancel,
    onCommit,
    isCommitting,
    currentVersion,
    latestVersion,
    changesSummary,
}: CommitTestsetModalProps) => {
    const [note, setNote] = useState("")

    // Cache the changes summary when modal opens to prevent layout shift during close animation
    const cachedSummaryRef = useRef<TestsetChangesSummary | undefined>(undefined)
    const cachedVersionRef = useRef<number | undefined>(undefined)
    const cachedLatestVersionRef = useRef<number | undefined>(undefined)

    useEffect(() => {
        if (open && changesSummary) {
            // Capture summary when modal opens
            cachedSummaryRef.current = changesSummary
            cachedVersionRef.current = currentVersion
            cachedLatestVersionRef.current = latestVersion
        }
    }, [open, changesSummary, currentVersion, latestVersion])

    // Use cached values to prevent content from disappearing during close animation
    const displaySummary = open ? changesSummary : cachedSummaryRef.current
    const displayVersion = open ? currentVersion : cachedVersionRef.current
    const displayLatestVersion = open ? latestVersion : cachedLatestVersionRef.current

    const handleCommit = async () => {
        await onCommit(note)
        setNote("")
    }

    const handleCancel = () => {
        setNote("")
        onCancel()
    }

    // New revision is always latest + 1, regardless of which revision is being viewed
    const targetVersion = Number(displayLatestVersion ?? displayVersion ?? 0) + 1

    // Build changes description using cached values
    const changesDescription = []
    if (displaySummary?.modifiedCount) {
        changesDescription.push(`${displaySummary.modifiedCount} modified`)
    }
    if (displaySummary?.addedCount) {
        changesDescription.push(`${displaySummary.addedCount} added`)
    }
    if (displaySummary?.deletedCount) {
        changesDescription.push(`${displaySummary.deletedCount} deleted`)
    }

    const hasDiffData = displaySummary?.originalData && displaySummary?.modifiedData

    return (
        <Modal
            title="Commit Changes"
            open={open}
            onOk={handleCommit}
            onCancel={handleCancel}
            okText="Commit"
            okButtonProps={{loading: isCommitting, disabled: isCommitting}}
            cancelButtonProps={{disabled: isCommitting}}
            destroyOnHidden
            width={hasDiffData ? 900 : 520}
            styles={{
                body: {
                    maxHeight: "calc(80vh - 110px)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                },
            }}
        >
            <div
                className={`flex ${hasDiffData ? "flex-row" : "flex-col"} gap-4 py-2 overflow-hidden h-full`}
            >
                <div
                    className={`flex flex-col gap-4 ${hasDiffData ? "w-[320px] shrink-0" : "w-full"} overflow-y-auto`}
                >
                    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                        <Text className="text-[#475569]">
                            This will create a new revision of your testset.
                        </Text>
                        <div className="mt-2 flex items-center gap-2 text-sm">
                            <Text className="font-medium">Version</Text>
                            <span className="rounded bg-[#E2E8F0] px-1.5 py-0.5 text-xs font-medium">
                                v{displayVersion ?? "?"}
                            </span>
                            <ArrowRight size={14} className="text-[#64748B]" />
                            <span className="rounded bg-[#DBEAFE] px-1.5 py-0.5 text-xs font-medium text-[#1D4ED8]">
                                v{targetVersion}
                            </span>
                        </div>
                        {changesDescription.length > 0 && (
                            <div className="mt-2 text-xs text-[#64748B]">
                                Changes: {changesDescription.join(", ")}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1">
                        <Text className="font-medium">
                            Commit message{" "}
                            <Tooltip title="A brief description of what changed helps teammates understand the revision history.">
                                <span className="text-[#64748B]">ⓘ</span>
                            </Tooltip>
                        </Text>
                        <Input.TextArea
                            placeholder="Describe what changed in this revision..."
                            className="w-full"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            autoSize={{minRows: 3, maxRows: 6}}
                            showCount
                            maxLength={COMMIT_MESSAGE_MAX_LENGTH}
                            autoFocus
                        />
                    </div>
                </div>

                {hasDiffData && (
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#FAFBFC]">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 shrink-0">
                            <Text className="text-xs font-semibold text-[#475569] uppercase tracking-wide">
                                Changes preview
                            </Text>
                            <Text className="text-xs text-[#94A3B8]">
                                {displaySummary.modifiedCount || 0} change
                                {(displaySummary.modifiedCount || 0) !== 1 ? "s" : ""}
                            </Text>
                        </div>
                        <div className="flex-1 overflow-auto">
                            <DiffView
                                key={`${displaySummary.originalData?.length}-${displaySummary.modifiedData?.length}`}
                                original={displaySummary.originalData}
                                modified={displaySummary.modifiedData}
                                language="json"
                                className="h-full"
                                showErrors
                                enableFolding
                            />
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    )
}

export default memo(CommitTestsetModal)
