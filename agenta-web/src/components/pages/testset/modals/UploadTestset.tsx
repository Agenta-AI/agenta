import React, {useState} from "react"
import {GenericObject, JSSTheme} from "@/lib/Types"
import {ArrowLeft, FileCode, FileCsv, Trash} from "@phosphor-icons/react"
import {Button, Collapse, Form, Input, message, Radio, Typography, Upload, UploadFile} from "antd"
import {createUseStyles} from "react-jss"
import {UploadOutlined} from "@ant-design/icons"
import {isValidCSVFile, isValidJSONFile} from "@/lib/helpers/fileManipulations"
import {useRouter} from "next/router"
import {globalErrorHandler} from "@/lib/helpers/errorHandler"
import {uploadTestsets, useLoadTestsetsList} from "@/services/testsets/api"

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

type Props = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const UploadTestset: React.FC<Props> = ({setCurrent, onCancel}) => {
    const classes = useStyles()
    const router = useRouter()
    const [form] = Form.useForm()
    const testsetFile = Form.useWatch("file", form)
    const [uploadType, setUploadType] = useState<"JSON" | "CSV" | undefined>("CSV")
    const [testsetName, setTestsetName] = useState("")
    const [uploadLoading, setUploadLoading] = useState(false)
    const [fileProgress, setFileProgress] = useState<UploadFile>({} as UploadFile)
    const {mutate} = useLoadTestsetsList()

    const onFinish = async (values: any) => {
        const {file} = values
        const fileObj = file[0].originFileObj
        const malformedFileError = `The file you uploaded is either malformed or is not a valid ${uploadType} file`

        if (file && file.length > 0 && uploadType) {
            const isValidFile = await (uploadType == "CSV"
                ? isValidCSVFile(fileObj)
                : isValidJSONFile(fileObj))
            if (!isValidFile) {
                message.error(malformedFileError)
                return
            }

            const formData = new FormData()
            formData.append("upload_type", uploadType)
            formData.append("file", fileObj)
            if (testsetName && testsetName.trim() !== "") {
                formData.append("testset_name", testsetName)
            }

            try {
                setUploadLoading(true)
                await uploadTestsets(formData)
                form.resetFields()
                setTestsetName("")
                mutate()
                onCancel()
            } catch (e: any) {
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

                <Text className={classes.headerText}>Upload a test set</Text>
            </div>

            <div className="flex flex-col gap-6">
                <Text>Upload your test set as CSV or JSON</Text>

                <div className="grid gap-2">
                    <Text className={classes.label}>Select type</Text>
                    <Radio.Group value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                        <Radio value="CSV">CSV</Radio>
                        <Radio value="JSON">JSON</Radio>
                    </Radio.Group>
                </div>

                <div className="grid gap-1">
                    <Text className={classes.label}>Test Set Name</Text>
                    <Input
                        placeholder="Enter a name"
                        value={testsetName}
                        onChange={(e) => setTestsetName(e.target.value)}
                        data-cy="upload-testset-file-name"
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <Text className={classes.label}>Upload CSV or JSON</Text>

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
                                    accept={uploadType == "CSV" ? ".csv" : ".json"}
                                    multiple={false}
                                    maxCount={1}
                                    showUploadList={false}
                                    onChange={(e) => {
                                        setFileProgress(e.fileList[0])
                                        !testsetName &&
                                            setTestsetName(
                                                e.fileList[0].name.split(".")[0] as string,
                                            )
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
                                                    The test set should be in CSV format with the
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
                                                    The test set should be in JSON format with the
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
                                            href="https://docs.agenta.ai/evaluation/create-test-sets#creating-a-test-set-from-a-csv-or-json"
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
                    data-cy="testset-upload-button"
                >
                    Create test set
                </Button>
            </div>
        </section>
    )
}

export default UploadTestset
