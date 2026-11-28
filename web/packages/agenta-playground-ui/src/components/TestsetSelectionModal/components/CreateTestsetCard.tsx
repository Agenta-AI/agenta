import {Table, Tray} from "@phosphor-icons/react"
import {Button, Typography, Upload} from "antd"

export interface CreateTestsetCardProps {
    /** Called when a file is uploaded (CSV/JSON) */
    onFileUpload?: (file: File) => void
    /** Called when the 'Build in UI' button is clicked */
    onBuildInUI?: () => void
}

export function CreateTestsetCard({onFileUpload, onBuildInUI}: CreateTestsetCardProps) {
    return (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-muted px-3 py-3 flex flex-col gap-3">
            <Typography.Text className="font-medium">Create a new testset</Typography.Text>
            <Upload.Dragger
                accept=".csv,.json"
                beforeUpload={(file) => {
                    onFileUpload?.(file)
                    return false // Prevent automatic upload
                }}
                showUploadList={false}
                disabled={!onFileUpload}
                className="!bg-background !border-border !rounded-lg"
            >
                <div className="flex flex-col items-center justify-center gap-2 py-1">
                    <Tray size={20} className="text-muted-foreground" />
                    <Typography.Text>Drop CSV/JSON here or click to browse</Typography.Text>
                </div>
            </Upload.Dragger>

            <div className="flex items-center gap-2 text-meta text-muted-foreground">
                <span className="h-px flex-1 bg-border-muted" />
                <span>or</span>
                <span className="h-px flex-1 bg-border-muted" />
            </div>

            <Button
                type="primary"
                block
                disabled={!onBuildInUI}
                icon={<Table size={16} />}
                onClick={onBuildInUI}
            >
                Build in UI
            </Button>
        </div>
    )
}
