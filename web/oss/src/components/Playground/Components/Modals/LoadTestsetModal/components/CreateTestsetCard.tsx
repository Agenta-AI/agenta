import {useCallback, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {InboxOutlined} from "@ant-design/icons"
import {ArrowLeft, Table, UploadSimple} from "@phosphor-icons/react"
import {Button, Input, Typography, Upload} from "antd"
import {useAtom, useSetAtom} from "jotai"

import {useTestsetFileUpload} from "@/oss/hooks/useTestsetFileUpload"
import {enableRevisionsListQueryAtom} from "@/oss/state/entities/testset"
import {selectedRevisionIdAtom, selectedTestsetIdAtom} from "@/oss/state/testsetSelection"

import {
    isCreatingNewTestsetAtom,
    newTestsetCommitMessageAtom,
    newTestsetNameAtom,
    selectedTestcaseRowKeysAtom,
} from "../atoms/modalState"

export interface CreateTestsetCardProps {
    onTestsetCreated?: () => void
}

export const CreateTestsetCard: React.FC<CreateTestsetCardProps> = ({onTestsetCreated}) => {
    const [isCreatingNew, setIsCreatingNew] = useAtom(isCreatingNewTestsetAtom)
    const [newTestsetName, setNewTestsetName] = useAtom(newTestsetNameAtom)
    const [newTestsetCommitMessage, setNewTestsetCommitMessage] = useAtom(
        newTestsetCommitMessageAtom,
    )
    const [selectedRevisionId, setSelectedRevisionId] = useAtom(selectedRevisionIdAtom)
    const [selectedTestset, setSelectedTestset] = useAtom(selectedTestsetIdAtom)
    const setSelectedRowKeys = useSetAtom(selectedTestcaseRowKeysAtom)
    const enableRevisionsListQuery = useSetAtom(enableRevisionsListQueryAtom)

    // Track if user has selected a file (but not uploaded yet)
    const [hasSelectedFile, setHasSelectedFile] = useState(false)

    // Track previous selection before entering create mode (so we can restore on cancel)
    const [previousSelection, setPreviousSelection] = useState<{
        testsetId: string
        revisionId: string
    } | null>(null)

    // File upload hook for drag & drop functionality
    const {
        handleFileSelect,
        uploadFile,
        uploadLoading: isUploadingFile,
        testsetName,
        selectedFile,
    } = useTestsetFileUpload({
        onSuccess: async (response) => {
            message.success("Testset uploaded successfully")

            console.log("[CreateTestsetCard] Full upload response:", response.data)

            // Parse response - API returns {count: 1, testset: {...}}
            const testsetData = response.data?.testset
            const revisionId = testsetData?.revision_id
            const testsetId = testsetData?.testset_id || testsetData?.id

            if (revisionId && testsetId) {
                console.log("[CreateTestsetCard] Upload success:", {revisionId, testsetId})

                // Refresh testsets list to show the newly created testset
                // Wait for the list to refresh before setting selection
                await onTestsetCreated?.()

                // Enable revisions query for the new testset
                enableRevisionsListQuery(testsetId)

                // Exit create mode first (prevents auto-cleanup on selection)
                setIsCreatingNew(false)

                // Select the newly created testset and revision
                setSelectedTestset(testsetId)
                setSelectedRevisionId(revisionId)

                // Reset file selection state
                setHasSelectedFile(false)
            } else {
                console.warn("[CreateTestsetCard] Missing IDs in upload response:", response.data)
            }
        },
        onError: () => {
            // Error is already handled by the hook
            setHasSelectedFile(false)
        },
    })

    // Handle file selection (don't auto-upload, let user confirm)
    const handleFileChange = useCallback(
        (info: any) => {
            const file = info.fileList[0]
            if (file) {
                handleFileSelect(file)
                setHasSelectedFile(true)
            }
        },
        [handleFileSelect],
    )

    // Handle upload button click
    const handleUploadClick = useCallback(async () => {
        await uploadFile()
    }, [uploadFile])

    const handleStartCreatingNew = useCallback(() => {
        setIsCreatingNew(true)
        setNewTestsetName("")
        setNewTestsetCommitMessage("")
        setSelectedRowKeys([])
        setSelectedRevisionId("")
        setSelectedTestset("")
    }, [
        setSelectedRowKeys,
        setSelectedRevisionId,
        setSelectedTestset,
        setIsCreatingNew,
        setNewTestsetName,
        setNewTestsetCommitMessage,
    ])

    const handleCreateFromUI = useCallback(() => {
        // Save current selection before entering create mode
        setPreviousSelection({
            testsetId: selectedTestset,
            revisionId: selectedRevisionId,
        })

        // Set revision to "new" for table editing
        // The testcases table hook will automatically initialize empty revision when it sees "new"
        setSelectedTestset("")
        setSelectedRevisionId("new")
    }, [setSelectedRevisionId, setSelectedTestset, selectedTestset, selectedRevisionId])

    const handleCancelCreateNew = useCallback(() => {
        setIsCreatingNew(false)
        setNewTestsetName("")
        setNewTestsetCommitMessage("")
        setSelectedRowKeys([])

        // Restore previous selection if available
        // The revision change will automatically trigger cleanup via revisionChangeEffectAtom
        if (previousSelection) {
            setSelectedTestset(previousSelection.testsetId)
            setSelectedRevisionId(previousSelection.revisionId)
            setPreviousSelection(null)
        } else {
            // No previous selection, just clear
            // Setting to empty string will trigger cleanup of "new" revision
            setSelectedRevisionId("")
            setSelectedTestset("")
        }
    }, [
        setSelectedRevisionId,
        setSelectedRowKeys,
        setSelectedTestset,
        setIsCreatingNew,
        setNewTestsetName,
        setNewTestsetCommitMessage,
        previousSelection,
    ])

    // If in create mode with a revision selected, show the enhanced creation UI
    if (isCreatingNew && selectedRevisionId) {
        return (
            <div className="flex flex-col gap-3 grow">
                {/* Step 1: Name input */}
                <div className="flex flex-col gap-3 rounded-lg border border-gray-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500">1.</span>
                        <Typography.Text className="font-medium text-sm text-gray-900">
                            Name new testset
                        </Typography.Text>
                    </div>
                    <Input
                        placeholder="e.g. onboarding_prompts"
                        value={newTestsetName}
                        onChange={(e) => setNewTestsetName(e.target.value)}
                        autoFocus
                    />
                </div>

                {/* Step 2: Instructions */}
                <div className="flex flex-col gap-3 rounded-lg border border-gray-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500">2.</span>
                        <Typography.Text className="font-medium text-sm text-gray-900">
                            Add testcases
                        </Typography.Text>
                    </div>
                    <Typography.Text className="text-xs text-gray-600 leading-relaxed">
                        Use the table to create testcases and custom fields.
                    </Typography.Text>
                </div>

                {/* Step 3: Commit message */}
                <div className="flex flex-col gap-3 rounded-lg border border-gray-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500">3.</span>
                        <Typography.Text className="font-medium text-sm text-gray-900">
                            Commit message
                        </Typography.Text>
                        <Typography.Text className="text-xs text-gray-500">
                            (optional)
                        </Typography.Text>
                    </div>
                    <Input.TextArea
                        placeholder="e.g. Initial testset creation"
                        value={newTestsetCommitMessage}
                        onChange={(e) => setNewTestsetCommitMessage(e.target.value)}
                        rows={3}
                    />
                </div>

                <div className="flex grow items-end justify-start">
                    <Button
                        type="text"
                        size="small"
                        icon={<ArrowLeft size={14} weight="regular" />}
                        onClick={handleCancelCreateNew}
                        className="!text-gray-400 hover:!text-gray-600"
                    >
                        Go back to list
                    </Button>
                </div>
            </div>
        )
    }

    // If file is selected, show upload confirmation
    if (hasSelectedFile && selectedFile) {
        return (
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-[0_10px_25px_rgba(15,23,42,0.05)] flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <Typography.Text className="font-medium text-sm">File selected</Typography.Text>
                    <Button
                        type="text"
                        size="small"
                        onClick={() => setHasSelectedFile(false)}
                        className="!text-gray-500"
                        disabled={isUploadingFile}
                    >
                        Cancel
                    </Button>
                </div>
                <div className="flex flex-col gap-1">
                    <Typography.Text className="text-sm">{selectedFile.name}</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs">
                        Testset name: {testsetName || "(auto-generated)"}
                    </Typography.Text>
                </div>
                <Button
                    type="primary"
                    block
                    icon={isUploadingFile ? undefined : <UploadSimple size={16} weight="regular" />}
                    onClick={handleUploadClick}
                    loading={isUploadingFile}
                >
                    {isUploadingFile ? "Uploading..." : "Upload & Load"}
                </Button>
            </div>
        )
    }

    // Otherwise, show the create options card (upload or build in UI)
    return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-4 flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <Typography.Text className="font-medium text-sm">
                    Create a new testset
                </Typography.Text>
                <Upload.Dragger
                    accept=".csv,.json"
                    beforeUpload={() => false}
                    showUploadList={false}
                    disabled={isUploadingFile}
                    className="!bg-white !border-gray-200 !rounded-xl"
                    onChange={handleFileChange}
                >
                    <div className="flex flex-col items-center justify-center gap-2 py-2">
                        <InboxOutlined className="text-gray-400 text-xl" />
                        <Typography.Text>Drop CSV/JSON here or click to browse</Typography.Text>
                    </div>
                </Upload.Dragger>
            </div>

            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
                <span className="h-px flex-1 bg-gray-200" />
                <span>or</span>
                <span className="h-px flex-1 bg-gray-200" />
            </div>

            <div className="flex flex-col gap-1">
                <Button
                    type="primary"
                    block
                    icon={<Table size={16} weight="regular" />}
                    onClick={() => {
                        if (!isCreatingNew) {
                            handleStartCreatingNew()
                        }
                        handleCreateFromUI()
                    }}
                >
                    Build in UI
                </Button>
            </div>
        </div>
    )
}
