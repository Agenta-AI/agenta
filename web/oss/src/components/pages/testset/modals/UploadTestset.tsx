import {UploadOutlined} from "@ant-design/icons"
import {ArrowLeft, FileCode, FileCsv, Trash} from "@phosphor-icons/react"
import {Button, Collapse, Form, Input, Typography, Upload, theme} from "antd"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {testsetsRefreshTriggerAtom} from "@/oss/components/TestsetsTable/atoms/tableStore"
import {useTestsetFileUpload} from "@/oss/hooks/useTestsetFileUpload"
import useURL from "@/oss/hooks/useURL"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {invalidateTestsetsListCache} from "@/oss/state/entities/testset"

const {Text} = Typography

interface Props {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const UploadTestset: React.FC<Props> = ({setCurrent, onCancel}) => {
    const {
        token: {cyan5},
    } = theme.useToken()
    const router = useRouter()
    const {projectURL} = useURL()
    const [form] = Form.useForm()
    const testsetFile = Form.useWatch("file", form)
    const setRefreshTrigger = useSetAtom(testsetsRefreshTriggerAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    const {
        uploadType,
        testsetName,
        uploadLoading,
        fileProgress,
        setTestsetName,
        handleFileSelect,
        uploadFile,
        resetUpload,
    } = useTestsetFileUpload({
        onSuccess: (response) => {
            form.resetFields()

            // Revalidate testsets data
            invalidateTestsetsListCache()
            setRefreshTrigger((prev) => prev + 1)
            recordWidgetEvent("testset_created")

            // Get the revision ID from the response and navigate to it
            const revisionId = response.data?.testset?.revision_id
            if (revisionId) {
                router.push(`${projectURL}/testsets/${revisionId}`)
            }
            onCancel()
        },
    })

    const onFinish = async () => {
        await uploadFile()
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2 mb-1">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                />

                <Text className="leading-[1.5714285714285714] text-[16px] font-semibold">
                    Upload a testset
                </Text>
            </div>

            <div className="flex flex-col gap-6">
                <Text>Upload your testset as CSV or JSON</Text>

                <div className="grid gap-1">
                    <Text className="font-medium">Testset Name</Text>
                    <Input
                        placeholder="Enter a name"
                        value={testsetName}
                        onChange={(e) => setTestsetName(e.target.value)}
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <Text className="font-medium">Upload your testset file</Text>
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
                                    beforeUpload={() => false}
                                    onChange={(e) => {
                                        const file = e.fileList[0]
                                        if (file) {
                                            handleFileSelect(file)
                                        }
                                    }}
                                >
                                    <Button icon={<UploadOutlined />}>Upload</Button>
                                </Upload>
                            </Form.Item>
                        </Form>
                    </div>

                    {fileProgress.name && (
                        <div className="p-2 flex items-center justify-between border border-solid border-colorBorder rounded-lg relative overflow-hidden">
                            {fileProgress.status == "uploading" && (
                                <div
                                    className="absolute inset-0 opacity-30"
                                    style={{
                                        width: `${fileProgress.percent}%`,
                                        backgroundColor: cyan5,
                                    }}
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
                                className="text-colorTextSecondary cursor-pointer"
                                onClick={() => {
                                    form.resetFields()
                                    resetUpload()
                                }}
                            />
                        </div>
                    )}
                </div>

                <div>
                    <Collapse
                        defaultActiveKey={["1"]}
                        expandIconPlacement="end"
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
