import {useState} from "react"

import {InfoCircleOutlined, InboxOutlined} from "@ant-design/icons"
import {Code, Table} from "@phosphor-icons/react"
import {
    Alert,
    Button,
    Form,
    Input,
    Popover,
    Table as AntTable,
    Typography,
    Upload,
    UploadFile,
} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import {message} from "@/oss/components/AppMessageContext"
import {testsetsRefreshTriggerAtom} from "@/oss/components/TestsetsTable/atoms/tableStore"
import useURL from "@/oss/hooks/useURL"
import {globalErrorHandler} from "@/oss/lib/helpers/errorHandler"
import {isValidCSVFile, isValidJSONFile} from "@/oss/lib/helpers/fileManipulations"
import {GenericObject, JSSTheme} from "@/oss/lib/Types"
import {uploadTestsetPreview} from "@/oss/services/testsets/api"
import {useTestsetsData} from "@/oss/state/testset"

const {Text} = Typography
const {Dragger} = Upload

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
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
    label: {
        fontWeight: theme.fontWeightMedium,
    },
    actionButton: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 8,
        height: "auto",
        padding: "12px 16px",
        textAlign: "left",
        "& .button-content": {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
        },
        "& .button-title": {
            fontWeight: theme.fontWeightMedium,
        },
        "& .button-description": {
            fontSize: 12,
            color: theme.colorTextSecondary,
        },
    },
}))

const getFileType = (fileName: string): "JSON" | "CSV" | undefined => {
    const extension = fileName.split(".").pop()?.toLowerCase()
    if (extension === "csv") return "CSV"
    if (extension === "json") return "JSON"
    return undefined
}

interface Props {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const CreateTestset: React.FC<Props> = ({setCurrent, onCancel}) => {
    const classes = useStyles()
    const router = useRouter()
    const {projectURL} = useURL()
    const [form] = Form.useForm()
    const [uploadType, setUploadType] = useState<"JSON" | "CSV" | undefined>(undefined)
    const [testsetName, setTestsetName] = useState("")
    const [uploadLoading, setUploadLoading] = useState(false)
    const [fileProgress, setFileProgress] = useState<UploadFile | null>(null)
    const [validationError, setValidationError] = useState<string | null>(null)
    const [previewData, setPreviewData] = useState<GenericObject[]>([])
    const {mutate} = useTestsetsData()
    const setRefreshTrigger = useSetAtom(testsetsRefreshTriggerAtom)

    const parseFileForPreview = async (
        file: File,
        fileType: "CSV" | "JSON",
    ): Promise<GenericObject[]> => {
        const text = await file.text()
        try {
            if (fileType === "JSON") {
                const parsed = JSON.parse(text)
                if (Array.isArray(parsed)) {
                    return parsed.slice(0, 3)
                }
            } else {
                const lines = text.split("\n").filter((line) => line.trim())
                if (lines.length > 0) {
                    const headers = lines[0].split(",").map((h) => h.trim())
                    const rows: GenericObject[] = []
                    for (let i = 1; i < Math.min(lines.length, 4); i++) {
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
            // Use the new preview API that creates testset + variant + v1 revision
            const response = await uploadTestsetPreview(
                fileObj,
                uploadType.toLowerCase() as "csv" | "json",
                testsetName.trim() || undefined,
            )

            form.resetFields()
            setTestsetName("")
            setFileProgress(null)
            setUploadType(undefined)

            // Revalidate testsets data
            mutate()
            setRefreshTrigger((prev) => prev + 1)

            message.success("Testset uploaded successfully")

            // Get the revision ID from the response and navigate to it
            const revisionId = response.data?.testset?.revision_id
            if (revisionId) {
                router.push(`${projectURL}/testsets/${revisionId}`)
            }
            onCancel()
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
        if (!testsetName) {
            setTestsetName(file.name.split(".")[0] as string)
        }
    }

    const handleRemoveFile = () => {
        setFileProgress(null)
        setTestsetName("")
        setUploadType(undefined)
        setValidationError(null)
        setPreviewData([])
    }

    const previewColumns: ColumnsType<GenericObject> =
        previewData.length > 0
            ? Object.keys(previewData[0]).map((key) => ({
                  title: key,
                  dataIndex: key,
                  key,
                  ellipsis: true,
                  width: 150,
              }))
            : []

    return (
        <section className={classes.container}>
            <Text className={classes.headerText}>Create new testset</Text>

            <Form form={form} layout="vertical">
                <div className="flex flex-col gap-4">
                    <div className={classes.dragger}>
                        <Dragger
                            name="file"
                            accept=".csv,.json"
                            multiple={false}
                            maxCount={1}
                            showUploadList={true}
                            fileList={fileProgress ? [fileProgress] : []}
                            beforeUpload={() => false}
                            onChange={(info) => {
                                if (info.fileList.length > 0) {
                                    handleFileChange(info.fileList[0])
                                } else {
                                    handleRemoveFile()
                                }
                            }}
                            onRemove={() => {
                                handleRemoveFile()
                                return true
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

                    {validationError && (
                        <Alert
                            message={validationError}
                            type="error"
                            showIcon
                            closable
                            onClose={() => setValidationError(null)}
                        />
                    )}

                    {fileProgress && (
                        <>
                            {previewData.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <Text className={classes.label}>
                                        Preview ({previewData.length} of first rows)
                                    </Text>
                                    <AntTable
                                        columns={previewColumns}
                                        dataSource={previewData.map((row, idx) => ({
                                            ...row,
                                            key: idx,
                                        }))}
                                        pagination={false}
                                        size="small"
                                        scroll={{x: "max-content"}}
                                        style={{maxHeight: 150, overflow: "auto"}}
                                    />
                                </div>
                            )}
                            <div className="flex flex-col gap-1">
                                <Text className={classes.label}>Testset Name</Text>
                                <Input
                                    placeholder="Enter a name"
                                    value={testsetName}
                                    onChange={(e) => setTestsetName(e.target.value)}
                                />
                            </div>
                        </>
                    )}
                </div>
            </Form>

            {fileProgress ? (
                <div className="flex justify-end gap-2 mt-2">
                    <Button disabled={uploadLoading} onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!testsetName || !fileProgress}
                        loading={uploadLoading}
                        type="primary"
                        onClick={handleUpload}
                    >
                        Create testset
                    </Button>
                </div>
            ) : (
                <div className="flex flex-col gap-3 mt-2">
                    <Text type="secondary" className="text-center">
                        Or create a testset manually
                    </Text>
                    <div className="flex gap-3">
                        <Button
                            block
                            className={classes.actionButton}
                            onClick={() => setCurrent(1)}
                        >
                            <Table size={24} />
                            <div className="button-content">
                                <span className="button-title">New via UI</span>
                                <span className="button-description">Create from scratch</span>
                            </div>
                        </Button>
                        <Button
                            block
                            className={classes.actionButton}
                            onClick={() => setCurrent(2)}
                        >
                            <Code size={24} />
                            <div className="button-content">
                                <span className="button-title">Create via API</span>
                                <span className="button-description">Use API endpoints</span>
                            </div>
                        </Button>
                    </div>
                </div>
            )}
        </section>
    )
}

export default CreateTestset
