import {useState} from "react"

import {CloseOutlined, FileOutlined, InfoCircleOutlined, InboxOutlined} from "@ant-design/icons"
import {Alert, Button, Modal, Popover, Typography, Upload, UploadFile} from "antd"
import {createUseStyles} from "react-jss"

import {message} from "@/oss/components/AppMessageContext"
import {FilePreviewTable} from "@/oss/components/pages/testset/modals/components/FilePreviewTable"
import {globalErrorHandler} from "@/oss/lib/helpers/errorHandler"
import {isValidCSVFile, isValidJSONFile} from "@/oss/lib/helpers/fileManipulations"
import {GenericObject, JSSTheme} from "@/oss/lib/Types"
import {uploadTestsetRevisionPreview} from "@/oss/services/testsets/api"

const {Text} = Typography
const {Dragger} = Upload

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        gap: 16,
        display: "flex",
        flexDirection: "column",
    },
    dragger: {
        "& .ant-upload-drag": {
            borderRadius: theme.borderRadiusLG,
            backgroundColor: theme.colorBgContainer,
        },
    },
    fileInfoBar: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        backgroundColor: theme.colorFillQuaternary,
        borderRadius: theme.borderRadius,
        border: `1px solid ${theme.colorBorderSecondary}`,
    },
    fileIcon: {
        color: theme.colorPrimary,
        fontSize: 16,
    },
    fileName: {
        flex: 1,
        fontWeight: theme.fontWeightMedium,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    removeButton: {
        color: theme.colorTextSecondary,
        cursor: "pointer",
        padding: 4,
        borderRadius: theme.borderRadiusSM,
        "&:hover": {
            color: theme.colorError,
            backgroundColor: theme.colorErrorBg,
        },
    },
}))

const getFileType = (fileName: string): "JSON" | "CSV" | undefined => {
    const extension = fileName.split(".").pop()?.toLowerCase()
    if (extension === "csv") return "CSV"
    if (extension === "json") return "JSON"
    return undefined
}

interface ImportTestsetRevisionModalProps {
    open: boolean
    onCancel: () => void
    onSuccess: (revisionId: string) => void
    testsetId: string
    testsetName: string
}

/**
 * Modal for importing a CSV/JSON file as a new revision to an existing testset
 */
export function ImportTestsetRevisionModal({
    open,
    onCancel,
    onSuccess,
    testsetId,
    testsetName,
}: ImportTestsetRevisionModalProps) {
    const classes = useStyles()
    const [uploadType, setUploadType] = useState<"JSON" | "CSV" | undefined>(undefined)
    const [uploadLoading, setUploadLoading] = useState(false)
    const [fileProgress, setFileProgress] = useState<UploadFile | null>(null)
    const [validationError, setValidationError] = useState<string | null>(null)
    const [previewData, setPreviewData] = useState<GenericObject[]>([])

    const parseFileForPreview = async (
        file: File,
        fileType: "CSV" | "JSON",
    ): Promise<GenericObject[]> => {
        const text = await file.text()
        const maxPreviewRows = 10
        try {
            if (fileType === "JSON") {
                const parsed = JSON.parse(text)
                if (Array.isArray(parsed)) {
                    return parsed.slice(0, maxPreviewRows)
                }
            } else {
                const lines = text.split("\n").filter((line) => line.trim())
                if (lines.length > 0) {
                    const headers = lines[0].split(",").map((h) => h.trim())
                    const rows: GenericObject[] = []
                    for (let i = 1; i < Math.min(lines.length, maxPreviewRows + 1); i++) {
                        const values = lines[i].split(",").map((v) => v.trim())
                        const row: GenericObject = {}
                        headers.forEach((header, idx) => {
                            row[header] = values[idx] || ""
                        })
                        rows.push(row)
                    }
                    return rows
                }
            }
        } catch {
            return []
        }
        return []
    }

    const handleUpload = async () => {
        if (!fileProgress?.originFileObj || !uploadType) return

        const fileObj = fileProgress.originFileObj as File
        const malformedFileError = `The file you uploaded is either malformed or is not a valid ${uploadType} file`

        const isValidFile = await (uploadType === "CSV"
            ? isValidCSVFile(fileObj)
            : isValidJSONFile(fileObj))
        if (!isValidFile) {
            message.error(malformedFileError)
            return
        }

        try {
            setUploadLoading(true)
            const response = await uploadTestsetRevisionPreview(
                testsetId,
                fileObj,
                uploadType.toLowerCase() as "csv" | "json",
            )

            message.success("File imported successfully as new revision")

            // Get the revision ID from the response
            const revisionId = response.data?.testset?.revision_id
            if (revisionId) {
                onSuccess(revisionId)
            }

            handleClose()
        } catch (e: any) {
            console.log(e)

            if (typeof e?.response?.data?.detail === "string") {
                message.error(e.response.data.detail)
                return
            }

            if (
                e?.response?.data?.detail?.find((item: GenericObject) =>
                    item?.loc?.includes("csvdata"),
                )
            )
                message.error(malformedFileError)
            else globalErrorHandler(e)
        } finally {
            setUploadLoading(false)
        }
    }

    const handleFileChange = async (file: UploadFile) => {
        setValidationError(null)
        const detectedType = getFileType(file.name)

        if (!detectedType) {
            setValidationError("Unsupported file format. Please upload a CSV or JSON file.")
            return
        }

        if (file.originFileObj) {
            const isValidFile = await (detectedType === "CSV"
                ? isValidCSVFile(file.originFileObj)
                : isValidJSONFile(file.originFileObj))

            if (!isValidFile) {
                setValidationError(
                    detectedType === "CSV"
                        ? "Invalid CSV format. Ensure it has comma-separated values with headers in the first row."
                        : "Invalid JSON format. Ensure it's an array of objects with consistent keys.",
                )
                return
            }

            const preview = await parseFileForPreview(file.originFileObj, detectedType)
            setPreviewData(preview)
        }

        setFileProgress(file)
        setUploadType(detectedType)
    }

    const handleRemoveFile = () => {
        setFileProgress(null)
        setUploadType(undefined)
        setValidationError(null)
        setPreviewData([])
    }

    const handleClose = () => {
        handleRemoveFile()
        onCancel()
    }

    return (
        <Modal
            title="Import file as new revision"
            open={open}
            onCancel={handleClose}
            footer={
                fileProgress
                    ? [
                          <Button key="cancel" disabled={uploadLoading} onClick={handleClose}>
                              Cancel
                          </Button>,
                          <Button
                              key="import"
                              type="primary"
                              disabled={!fileProgress || !!validationError}
                              loading={uploadLoading}
                              onClick={handleUpload}
                          >
                              Import
                          </Button>,
                      ]
                    : null
            }
            destroyOnHidden
            width={600}
        >
            <section className={classes.container}>
                <Text type="secondary">
                    Import a CSV or JSON file to replace the current data in "{testsetName}". This
                    will create a new revision.
                </Text>

                {!fileProgress ? (
                    <div className={classes.dragger}>
                        <Dragger
                            name="file"
                            accept=".csv,.json"
                            multiple={false}
                            maxCount={1}
                            showUploadList={false}
                            fileList={[]}
                            beforeUpload={() => false}
                            onChange={(info) => {
                                if (info.fileList.length > 0) {
                                    handleFileChange(info.fileList[0])
                                }
                            }}
                        >
                            <p className="ant-upload-drag-icon">
                                <InboxOutlined />
                            </p>
                            <p className="ant-upload-text">
                                Click or drag file to this area to upload
                            </p>
                            <p className="ant-upload-hint">
                                CSV and JSON formats are supported{" "}
                                <Popover
                                    title="File format requirements"
                                    content={
                                        <div style={{maxWidth: 280}}>
                                            <Text strong>CSV:</Text>
                                            <ul style={{paddingLeft: 16, margin: "4px 0 8px"}}>
                                                <li>Comma-separated values</li>
                                                <li>First row must be headers</li>
                                            </ul>
                                            <Text strong>JSON:</Text>
                                            <ul style={{paddingLeft: 16, margin: "4px 0 0"}}>
                                                <li>Array of objects</li>
                                                <li>Each object has column names as keys</li>
                                            </ul>
                                        </div>
                                    }
                                >
                                    <InfoCircleOutlined style={{cursor: "pointer"}} />
                                </Popover>
                            </p>
                        </Dragger>
                    </div>
                ) : (
                    <>
                        <div className={classes.fileInfoBar}>
                            <FileOutlined className={classes.fileIcon} />
                            <span className={classes.fileName}>{fileProgress.name}</span>
                            <CloseOutlined
                                className={classes.removeButton}
                                onClick={handleRemoveFile}
                            />
                        </div>

                        {validationError && (
                            <Alert
                                message={validationError}
                                type="error"
                                showIcon
                                closable
                                onClose={() => setValidationError(null)}
                            />
                        )}

                        {previewData.length > 0 && (
                            <FilePreviewTable data={previewData} maxRows={5} />
                        )}
                    </>
                )}
            </section>
        </Modal>
    )
}

export default ImportTestsetRevisionModal
