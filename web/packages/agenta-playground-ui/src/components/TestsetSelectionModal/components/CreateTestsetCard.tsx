import {InboxOutlined} from "@ant-design/icons"
import {Table} from "@phosphor-icons/react"
import {Button, Typography, Upload} from "antd"

export interface CreateTestsetCardProps {
    /** Called when a file is uploaded (CSV/JSON) */
    onFileUpload?: (file: File) => void
    /** Called when the 'Build in UI' button is clicked */
    onBuildInUI?: () => void
}

export function CreateTestsetCard({onFileUpload, onBuildInUI}: CreateTestsetCardProps) {
    return (
        <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-4 flex flex-col gap-3">
            <Typography.Text className="font-medium text-sm">Create a new testset</Typography.Text>
            <Upload.Dragger
                accept=".csv,.json"
                beforeUpload={(file) => {
                    onFileUpload?.(file)
                    return false // Prevent automatic upload
                }}
                showUploadList={false}
                disabled={!onFileUpload}
                className="!bg-white !border-gray-200 !rounded-xl"
            >
                <div className="flex flex-col items-center justify-center gap-2 py-2">
                    <InboxOutlined className="text-gray-400 text-xl" />
                    <Typography.Text className="text-sm">
                        Drop CSV/JSON here or click to browse
                    </Typography.Text>
                </div>
            </Upload.Dragger>

            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
                <span className="h-px flex-1 bg-gray-200" />
                <span>or</span>
                <span className="h-px flex-1 bg-gray-200" />
            </div>

            <Button
                type="primary"
                block
                disabled={!onBuildInUI}
                icon={<Table size={16} weight="regular" />}
                onClick={onBuildInUI}
            >
                Build in UI
            </Button>
        </div>
    )
}
