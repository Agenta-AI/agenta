import {useCallback, useState} from "react"

import {CreateTestsetCard, type CreateCardRenderProps} from "@agenta/playground-ui/components"
import {ArrowLeft, UploadSimple} from "@phosphor-icons/react"
import {Button, Input, Typography} from "antd"

import {useTestsetFileUpload} from "@/oss/hooks/useTestsetFileUpload"

export interface CreateTestsetCardWrapperProps extends CreateCardRenderProps {}

export function CreateTestsetCardWrapper({
    onTestsetCreated,
    onBuildInUI,
    isCreateMode,
    onExitCreateMode,
    newTestsetName,
    onTestsetNameChange,
    newTestsetCommitMessage,
    onCommitMessageChange,
}: CreateTestsetCardWrapperProps) {
    const [hasSelectedFile, setHasSelectedFile] = useState(false)

    // File upload hook for drag & drop functionality
    const {
        handleFileSelect,
        uploadFile,
        uploadLoading: isUploadingFile,
        testsetName,
        selectedFile,
    } = useTestsetFileUpload({
        onSuccess: async (response) => {
            const testsetData = response.data?.testset
            if (!testsetData) return

            const revisionId = testsetData.revision_id
            const testsetId = testsetData.testset_id || testsetData.id

            if (revisionId && testsetId) {
                setHasSelectedFile(false)
                onTestsetCreated?.(revisionId, testsetId)
            } else {
                console.warn(
                    "[CreateTestsetCardWrapper] Missing IDs in upload response:",
                    response.data,
                )
            }
        },
        onError: () => {
            setHasSelectedFile(false)
        },
    })

    const handleFileUpload = useCallback(
        (file: File) => {
            handleFileSelect(file)
            setHasSelectedFile(true)
        },
        [handleFileSelect],
    )

    const handleUploadClick = useCallback(async () => {
        await uploadFile()
    }, [uploadFile])

    // =====================================================================
    // CREATE MODE: Show the 3-step creation form instead of the dropzone
    // (Mirrors the old LoadTestsetModal sidebar replacement behavior)
    // =====================================================================
    if (isCreateMode) {
        return (
            <div className="mt-3 flex flex-col gap-4">
                {/* Go back button */}
                <Button
                    type="text"
                    icon={<ArrowLeft size={16} />}
                    onClick={onExitCreateMode}
                    className="self-start !px-0"
                >
                    Back to test sets
                </Button>

                {/* Step 1: Testset name */}
                <div className="flex flex-col gap-1">
                    <Typography.Text className="text-xs font-medium">Test set name</Typography.Text>
                    <Input
                        placeholder="Enter test set name"
                        value={newTestsetName}
                        onChange={(e) => onTestsetNameChange(e.target.value)}
                        autoFocus
                    />
                </div>

                {/* Step 2: Instructions */}
                <div className="flex flex-col gap-1">
                    <Typography.Text type="secondary" className="text-xs">
                        Add rows and columns in the table to build your test set. Press{" "}
                        <strong>Create &amp; Load</strong> when done.
                    </Typography.Text>
                </div>

                {/* Step 3: Commit message */}
                <div className="flex flex-col gap-1">
                    <Typography.Text className="text-xs font-medium">
                        Commit message{" "}
                        <Typography.Text type="secondary">(optional)</Typography.Text>
                    </Typography.Text>
                    <Input.TextArea
                        placeholder="Initial commit"
                        value={newTestsetCommitMessage}
                        onChange={(e) => onCommitMessageChange(e.target.value)}
                        rows={2}
                        autoSize={{minRows: 2, maxRows: 4}}
                    />
                </div>
            </div>
        )
    }

    // =====================================================================
    // FILE SELECTED: Show upload confirmation
    // =====================================================================
    if (hasSelectedFile && selectedFile) {
        return (
            <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-[0_10px_25px_rgba(15,23,42,0.05)] flex flex-col gap-3">
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

    // =====================================================================
    // DEFAULT: Show the basic dropzone + Build in UI card
    // =====================================================================
    return <CreateTestsetCard onFileUpload={handleFileUpload} onBuildInUI={onBuildInUI} />
}
