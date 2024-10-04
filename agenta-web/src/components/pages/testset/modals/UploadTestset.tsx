import React, {useState} from "react"
import {GenericObject, JSSTheme} from "@/lib/Types"
import {ArrowLeft, FileCsv, Trash} from "@phosphor-icons/react"
import {Button, Collapse, Form, Input, message, Radio, Typography, Upload, UploadFile} from "antd"
import {createUseStyles} from "react-jss"
import {UploadOutlined} from "@ant-design/icons"
import {isValidCSVFile, isValidJSONFile} from "@/lib/helpers/fileManipulations"
import axios from "axios"
import {useRouter} from "next/router"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {globalErrorHandler} from "@/lib/helpers/errorHandler"
import {useLoadTestsetsList} from "@/services/testsets/api"

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
    subText: {
        color: theme.colorTextSecondary,
    },
    progressBar: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: theme["cyan5"],
        opacity: 0.4,
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
    const appId = router.query.app_id as string
    const [uploadType, setUploadType] = useState<"JSON" | "CSV" | undefined>("CSV")
    const [testsetName, setTestsetName] = useState("")
    const [uploadLoading, setUploadLoading] = useState(false)
    const [fileProgress, setFileProgress] = useState<UploadFile>({} as UploadFile)
    const {mutate} = useLoadTestsetsList(appId)

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
            if (values.testsetName && values.testsetName.trim() !== "") {
                formData.append("testset_name", values.testsetName)
            }
            formData.append("app_id", appId)

            try {
                setUploadLoading(true)
                // TODO: move to api.ts
                await axios.post(`${getAgentaApiUrl()}/api/testsets/upload/`, formData, {
                    headers: {
                        "Content-Type": "multipart/form-data",
                    },
                    //@ts-ignore
                    _ignoreError: true,
                })
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
            <div className="flex items-center gap-2">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                />

                <Typography.Text className={classes.headerText}>Upload a test set</Typography.Text>
            </div>

            <div className="flex flex-col gap-6">
                <Typography.Text>Create a new test set directly from the webUI</Typography.Text>

                <div className="grid gap-2">
                    <Typography.Text className={classes.label}>Select type</Typography.Text>
                    <Radio.Group value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                        <Radio value="CSV">CSV</Radio>
                        <Radio value="JSON">JSON</Radio>
                    </Radio.Group>
                </div>

                <div className="grid gap-1">
                    <Typography.Text className={classes.label}>Name of testset</Typography.Text>
                    <Input
                        placeholder="Enter a name"
                        value={testsetName}
                        onChange={(e) => setTestsetName(e.target.value)}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <Typography.Text className={classes.label}>
                            Upload CSV or JSON
                        </Typography.Text>

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
                                    <FileCsv size={32} />
                                )}
                                <Typography.Text>{fileProgress.name}</Typography.Text>
                            </div>

                            <Trash
                                size={22}
                                className={classes.subText}
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
                                                {" "}
                                                <Typography.Text>
                                                    The test set should be in CSV format with the
                                                    following requirements:
                                                </Typography.Text>
                                                <div className="flex flex-col">
                                                    <Typography.Text>
                                                        1. Comma separated values
                                                    </Typography.Text>
                                                    <Typography.Text>
                                                        2. The first row should contain the headers
                                                    </Typography.Text>
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
                                                <Typography.Text>
                                                    The test set should be in JSON format with the
                                                    following requirements:
                                                </Typography.Text>

                                                <div className="flex flex-col">
                                                    <Typography.Text>
                                                        1. A json file with an array of rows
                                                    </Typography.Text>
                                                    <Typography.Text>
                                                        2. Each row in the array should be an object
                                                    </Typography.Text>
                                                    <Typography.Text>
                                                        of column header name as key and row data as
                                                        value.
                                                    </Typography.Text>
                                                </div>

                                                <Typography.Paragraph>
                                                    Here is an example of a valid JSON file: <br />
                                                    {`[{ "recipe_name": "Chicken Parmesan","correct_answer": "Chicken" },
{ "recipe_name": "a, special, recipe","correct_answer": "Beef" }]`}
                                                </Typography.Paragraph>
                                            </>
                                        )}

                                        <Button>Read the docs</Button>
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
                    disabled={uploadLoading || !testsetName}
                    type="primary"
                    onClick={() => form.submit()}
                >
                    Create test set
                </Button>
            </div>
        </section>
    )
}

export default UploadTestset
