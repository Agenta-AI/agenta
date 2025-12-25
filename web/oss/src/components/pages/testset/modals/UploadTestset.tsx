import {useState} from "react"

import {UploadOutlined} from "@ant-design/icons"
import {ArrowLeft, FileCode, FileCsv, Trash} from "@phosphor-icons/react"
import {Button, Collapse, Form, Input, Typography, Upload, UploadFile} from "antd"
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

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
    uploadContainer: {
        padding: theme.paddingXS,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: "1px solid",
        borderColor: theme.colorBorder,
        borderRadius: theme.borderRadiusLG,
        position: "relative",
        overflow: "hidden",
    },
    trashIcon: {
        color: theme.colorTextSecondary,
        cursor: "pointer",
    },
    progressBar: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: theme["cyan5"],
        opacity: 0.3,
    },
}))

interface Props {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const getFileType = (fileName: string): "JSON" | "CSV" | undefined => {
    const extension = fileName.split(".").pop()?.toLowerCase()
    if (extension === "csv") return "CSV"
    if (extension === "json") return "JSON"
    return undefined
}

const UploadTestset: React.FC<Props> = ({setCurrent, onCancel}) => {
    const classes = useStyles()
    const router = useRouter()
    const {projectURL} = useURL()
    const [form] = Form.useForm()
    const testsetFile = Form.useWatch("file", form)
    const [uploadType, setUploadType] = useState<"JSON" | "CSV" | undefined>(undefined)
    const [testsetName, setTestsetName] = useState("")
    const [uploadLoading, setUploadLoading] = useState(false)
    const [fileProgress, setFileProgress] = useState<UploadFile>({} as UploadFile)
    const {mutate} = useTestsetsData()
    const setRefreshTrigger = useSetAtom(testsetsRefreshTriggerAtom)

    const onFinish = async (values: any) => {
        const {file} = values
        const fileObj = file[0].originFileObj as File
        const malformedFileError = `The file you uploaded is either malformed or is not a valid ${uploadType} file`

        if (file && file.length > 0 && uploadType) {
            const isValidFile = await (uploadType == "CSV"
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

                // IF e.response.data.detail is string then show it as error
                if (typeof e?.response?.data?.detail === "string") {
                    message.error(e.response.data.detail)
                    return
                }

                // IF e.response.data.detail is array then check if it contains the string "csvdata"
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
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2 mb-1">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                />

                <Text className={classes.headerText}>Upload a testset</Text>
            </div>

            <div className="flex flex-col gap-6">
                <Text>Upload your testset as CSV or JSON</Text>

                <div className="grid gap-1">
                    <Text className={classes.label}>Testset Name</Text>
                    <Input
                        placeholder="Enter a name"
                        value={testsetName}
                        onChange={(e) => setTestsetName(e.target.value)}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <Text className={classes.label}>Upload your testset file</Text>
                            <Text type="secondary" style={{fontSize: 11}}>
                                CSV and JSON formats are supported
                            </Text>
                        </div>

                        <Form onFinish={onFinish} form={form}>
                            <Form.Item
                                name="file"
                                valuePropName="fileList"
                                getValueFromEvent={(e) => e.fileList}
                                className="mb-0"
                                rules={[{required: true}]}
                            >
                                <Upload
                                    name="file"
                                    accept=".csv,.json"
                                    multiple={false}
                                    maxCount={1}
                                    showUploadList={false}
                                    onChange={(e) => {
                                        const file = e.fileList[0]
                                        if (file) {
                                            setFileProgress(file)
                                            const detectedType = getFileType(file.name)
                                            setUploadType(detectedType)
                                            if (!testsetName) {
                                                setTestsetName(file.name.split(".")[0] as string)
                                            }
                                        }
                                    }}
                                >
                                    <Button icon={<UploadOutlined />}>Upload</Button>
                                </Upload>
                            </Form.Item>
                        </Form>
                    </div>

                    {fileProgress.name && (
                        <div className={classes.uploadContainer}>
                            {fileProgress.status == "uploading" && (
                                <div
                                    className={classes.progressBar}
                                    style={{width: `${fileProgress.percent}%`}}
                                ></div>
                            )}
                            <div className="flex items-center gap-2">
                                {uploadType === "CSV" ? (
                                    <FileCsv size={32} />
                                ) : (
                                    <FileCode size={32} />
                                )}
                                <Text>{fileProgress.name}</Text>
                            </div>

                            <Trash
                                size={22}
                                className={classes.trashIcon}
                                onClick={() => {
                                    form.resetFields()
                                    setTestsetName("")
                                    setUploadType(undefined)
                                    setFileProgress({} as UploadFile)
                                }}
                            />
                        </div>
                    )}
                </div>

                <div>
                    <Collapse
                        defaultActiveKey={["1"]}
                        expandIconPosition="end"
                        items={[
                            {
                                key: "1",
                                label: "Instructions",
                                children: (
                                    <div className="flex flex-col items-start gap-4">
                                        {uploadType === "CSV" ? (
                                            <>
                                                <Text>
                                                    The testset should be in CSV format with the
                                                    following requirements:
                                                </Text>
                                                <div className="flex flex-col">
                                                    <Text>1. Comma separated values</Text>
                                                    <Text>
                                                        2. The first row should contain the headers
                                                    </Text>
                                                </div>
                                                <Typography.Paragraph>
                                                    Here is an example of a valid CSV file: <br />
                                                    recipe_name,correct_answer <br />
                                                    ChickenParmesan,Chicken <br /> "a, special,
                                                    recipe",Beef
                                                </Typography.Paragraph>
                                            </>
                                        ) : (
                                            <>
                                                <Text>
                                                    The testset should be in JSON format with the
                                                    following requirements:
                                                </Text>

                                                <div className="flex flex-col">
                                                    <Text>
                                                        1. A json file with an array of rows
                                                    </Text>
                                                    <Text>
                                                        2. Each row in the array should be an object
                                                    </Text>
                                                    <Text>
                                                        of column header name as key and row data as
                                                        value.
                                                    </Text>
                                                </div>

                                                <Typography.Paragraph>
                                                    Here is an example of a valid JSON file: <br />
                                                    {JSON.stringify(
                                                        [
                                                            {
                                                                recipe_name: "Chicken Parmesan",
                                                                correct_answer: "Chicken",
                                                            },
                                                            {
                                                                recipe_name: "a, special, recipe",
                                                                correct_answer: "Beef",
                                                            },
                                                        ],
                                                        null,
                                                        2,
                                                    )}
                                                </Typography.Paragraph>
                                            </>
                                        )}

                                        <Typography.Link
                                            href="https://agenta.ai/docs/evaluation/managing-test-sets/upload-csv"
                                            target="_blank"
                                        >
                                            <Button>Read the docs</Button>
                                        </Typography.Link>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-2 mt-3">
                <Button disabled={uploadLoading} onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    disabled={!testsetName || !testsetFile}
                    loading={uploadLoading}
                    type="primary"
                    onClick={() => form.submit()}
                >
                    Create testset
                </Button>
            </div>
        </section>
    )
}

export default UploadTestset
