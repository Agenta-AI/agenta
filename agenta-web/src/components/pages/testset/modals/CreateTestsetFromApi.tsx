import CopyButton from "@/components/CopyButton/CopyButton"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {JSSTheme} from "@/lib/Types"
import {PythonOutlined} from "@ant-design/icons"
import {ArrowLeft, FileCode, FileTs} from "@phosphor-icons/react"
import {Button, Radio, Tabs, Typography} from "antd"
import {useRouter} from "next/router"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import pythonCode from "@/code_snippets/testsets/create_with_json/python"
import cURLCode from "@/code_snippets/testsets/create_with_json/curl"
import tsCode from "@/code_snippets/testsets/create_with_json/typescript"
import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import pythonCodeUpload from "@/code_snippets/testsets/create_with_upload/python"
import cURLCodeUpload from "@/code_snippets/testsets/create_with_upload/curl"
import tsCodeUpload from "@/code_snippets/testsets/create_with_upload/typescript"

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
    },
    subText: {
        color: theme.colorTextSecondary,
    },
}))

type Props = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}
type LanguageCodeBlockProps = {
    selectedLang: string
    codeSnippets: Record<string, string>
}

const LanguageCodeBlock = ({selectedLang, codeSnippets}: LanguageCodeBlockProps) => {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-end">
                <CopyButton buttonText={null} text={codeSnippets[selectedLang]} icon={true} />
            </div>

            <div className="w-[430px] max-h-[380px] !overflow-auto">
                <CodeBlock
                    key={selectedLang}
                    language={selectedLang}
                    value={codeSnippets[selectedLang]}
                />
            </div>
        </div>
    )
}

const CreateTestsetFromApi: React.FC<Props> = ({setCurrent, onCancel}) => {
    const classes = useStyles()
    const router = useRouter()
    const [uploadType, setUploadType] = useState<"csv" | "json">("csv")
    const [selectedLang, setSelectedLang] = useState("python")

    const appId = router.query.app_id as string

    const uploadURI = `${getAgentaApiUrl()}/api/testsets/upload`
    const jsonURI = `${getAgentaApiUrl()}/api/testsets/${appId}`

    const params = `{
    "name": "testset_name",}`

    const jsonCodeSnippets: Record<string, string> = {
        python: pythonCode(jsonURI, params),
        bash: cURLCode(jsonURI, params),
        typescript: tsCode(jsonURI, params),
    }

    const csvCodeSnippets: Record<string, string> = {
        python: pythonCodeUpload(uploadURI, appId),
        bash: cURLCodeUpload(uploadURI, appId),
        typescript: tsCodeUpload(uploadURI, appId),
    }

    const codeSnippets = uploadType === "csv" ? csvCodeSnippets : jsonCodeSnippets

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                />

                <Typography.Text className={classes.headerText}>
                    Create a test set with API
                </Typography.Text>
            </div>

            <div className="flex flex-col gap-6">
                <Typography.Text>Create a new test set directly from the webUI</Typography.Text>

                <div className="grid gap-2">
                    <Typography.Text className={classes.label}>Select type</Typography.Text>
                    <Radio.Group value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                        <Radio value="csv">CSV</Radio>
                        <Radio value="json">JSON</Radio>
                    </Radio.Group>
                </div>

                <Typography.Text>
                    Use this endpoint to create a new Test set for your App using JSON
                </Typography.Text>

                <div>
                    <Tabs
                        destroyInactiveTabPane
                        defaultActiveKey={selectedLang}
                        onChange={setSelectedLang}
                        items={[
                            {
                                key: "python",
                                label: "Python",
                                children: (
                                    <LanguageCodeBlock
                                        codeSnippets={codeSnippets}
                                        selectedLang={selectedLang}
                                    />
                                ),
                                icon: <PythonOutlined />,
                            },
                            {
                                key: "typescript",
                                label: "TypeScript",
                                children: (
                                    <LanguageCodeBlock
                                        codeSnippets={codeSnippets}
                                        selectedLang={selectedLang}
                                    />
                                ),
                                icon: <FileTs size={14} />,
                            },
                            {
                                key: "bash",
                                label: "cURL",
                                children: (
                                    <LanguageCodeBlock
                                        codeSnippets={codeSnippets}
                                        selectedLang={selectedLang}
                                    />
                                ),
                                icon: <FileCode size={14} />,
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="w-full flex items-center justify-between">
                <Button type="link">Read the docs</Button>
                <Button onClick={onCancel}>Close</Button>
            </div>
        </section>
    )
}

export default CreateTestsetFromApi
