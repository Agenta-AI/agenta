import {useState} from "react"

import {MinusCircleOutlined} from "@ant-design/icons"
import {FileArchive} from "@phosphor-icons/react"
import {Button, Input, Typography, Upload} from "antd"
import clsx from "clsx"

import {PromptDocumentUploadProps} from "./types"

const {Dragger} = Upload
const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8MB

const PromptDocumentUpload = ({disabled, onRemove, ...rest}: PromptDocumentUploadProps) => {
    const [error, setError] = useState("")

    const currentValue = (): string =>
        rest.mode === "value" ? rest.value.file_id || "" : rest.fileIdValue || ""

    const setValue = (fileId: string) => {
        if (rest.mode === "value") {
            rest.onValueChange({file_id: fileId})
        } else {
            rest.onChange(rest.fileIdPropertyId, fileId)
        }
    }

    const handleUpload = (file: File) => {
        if (file.size > MAX_FILE_SIZE) {
            setError("File too large. Please upload a PDF smaller than 8 MB.")
            return Upload.LIST_IGNORE
        }
        const isPdf =
            file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")
        if (!isPdf) {
            setError("Unsupported format. Please upload a PDF file.")
            return Upload.LIST_IGNORE
        }

        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result
            if (typeof result !== "string") {
                setError("Failed to read file.")
                return
            }
            setError("")
            setValue(result)
        }
        reader.onerror = () => setError("Failed to read file.")
        reader.readAsDataURL(file)
        return Upload.LIST_IGNORE
    }

    const value = currentValue()

    return (
        <div
            className={clsx(
                "flex flex-col gap-2 w-full rounded-md border border-dashed border-[#d9d9d9] p-3",
                disabled && "opacity-70 cursor-not-allowed",
            )}
        >
            <div className="flex items-start gap-2">
                <FileArchive size={32} className="text-[#758391] mt-1 shrink-0" />
                <div className="flex-1 flex flex-col gap-2">
                    <Typography.Text type="warning">
                        Ensure the selected model supports document/PDF input before saving.
                    </Typography.Text>

                    <Dragger
                        accept=".pdf,application/pdf"
                        showUploadList={false}
                        multiple={false}
                        disabled={disabled}
                        beforeUpload={handleUpload}
                        className="!p-4 !rounded-md !border-[#e1e7ef] !bg-[rgba(247,249,252,0.6)]"
                    >
                        <Typography.Text>
                            Drag a PDF here or click to upload. Uploaded files are embedded as
                            base64 data URIs.
                        </Typography.Text>
                    </Dragger>

                    <div className="flex flex-col gap-1">
                        <Typography.Text strong>Document source</Typography.Text>
                        <Typography.Text type="secondary">
                            Paste a public URL, a base64 data URI, or a provider-specific file id (for
                            example file-xyz123).
                        </Typography.Text>
                        <Input.TextArea
                            disabled={disabled}
                            autoSize={{minRows: 2, maxRows: 6}}
                            placeholder="https://example.com/file.pdf | data:application/pdf;base64,... | file-abc123"
                            value={value}
                            onChange={(e) => setValue(e.target.value.trim())}
                        />
                    </div>

                    {value.startsWith("data:") && (
                        <Typography.Text type="secondary">
                            Embedded file size ≈ {(value.length / 1024).toFixed(1)} KB
                        </Typography.Text>
                    )}

                    {error && <Typography.Text className="text-[#D61010]">{error}</Typography.Text>}
                </div>
                <Button
                    type="text"
                    icon={<MinusCircleOutlined />}
                    disabled={disabled}
                    onClick={(e) => {
                        e.stopPropagation()
                        onRemove()
                    }}
                />
            </div>
        </div>
    )
}

export default PromptDocumentUpload
