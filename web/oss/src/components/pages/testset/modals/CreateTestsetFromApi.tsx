import {useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {CopyButton} from "@agenta/ui"
import {PythonOutlined} from "@ant-design/icons"
import {ArrowLeft, FileCode, FileTs} from "@phosphor-icons/react"
import {Radio, Tabs} from "antd"

import cURLCode from "@/oss/code_snippets/testsets/create_with_json/curl"
import pythonCode from "@/oss/code_snippets/testsets/create_with_json/python"
import tsCode from "@/oss/code_snippets/testsets/create_with_json/typescript"
import cURLCodeUpload from "@/oss/code_snippets/testsets/create_with_upload/curl"
import pythonCodeUpload from "@/oss/code_snippets/testsets/create_with_upload/python"
import tsCodeUpload from "@/oss/code_snippets/testsets/create_with_upload/typescript"
import CodeBlock from "@/oss/components/DynamicCodeBlock/CodeBlock"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

interface Props {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}
interface LanguageCodeBlockProps {
    selectedLang: string
    codeSnippets: Record<string, string>
}

const LanguageCodeBlock = ({selectedLang, codeSnippets}: LanguageCodeBlockProps) => {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-end">
                <CopyButton buttonText={null} text={codeSnippets[selectedLang]} icon={true} />
            </div>

            <div className="w-[430px] max-h-[380px] !overflow-y-auto">
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
    const [uploadType, setUploadType] = useState<"csv" | "json">("csv")
    const [selectedLang, setSelectedLang] = useState("python")

    const uploadURI = `${getAgentaApiUrl()}/simple/testsets/upload`
    const jsonURI = `${getAgentaApiUrl()}/simple/testsets/`

    const params = `{
    "testset": {
        "slug": "your-testset-slug",
        "name": "your_testset_name",
        "data": {
            "testcases": [
                {"data": {"column1": "value1", "column2": "value2"}},
                {"data": {"column1": "value3", "column2": "value4"}}
            ]
        }
    }
}`

    const jsonCodeSnippets: Record<string, string> = {
        python: pythonCode(jsonURI, params),
        bash: cURLCode(jsonURI, params),
        typescript: tsCode(jsonURI, params),
    }

    const csvCodeSnippets: Record<string, string> = {
        python: pythonCodeUpload(uploadURI),
        bash: cURLCodeUpload(uploadURI),
        typescript: tsCodeUpload(uploadURI),
    }

    const codeSnippets = uploadType === "csv" ? csvCodeSnippets : jsonCodeSnippets

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2 mb-1">
                <Button
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                    variant="outline"
                    size="icon"
                >
                    {<ArrowLeft size={14} className="mt-0.5" />}
                </Button>

                <span className="leading-[1.5714285714285714] text-[16px] font-semibold">
                    Create a testset with API
                </span>
            </div>

            <div className="flex flex-col gap-6">
                <span>Create a testset programmatically using our API endpoints</span>

                <div className="grid gap-2">
                    <span className="font-medium">Select type</span>
                    <Radio.Group value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                        <Radio value="csv">CSV</Radio>
                        <Radio value="json">JSON</Radio>
                    </Radio.Group>
                </div>

                <span>Use these endpoints to create a testset via JSON or upload a file</span>

                <div>
                    <Tabs
                        destroyOnHidden
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
                                icon: <FileTs size={14} className="!-mb-[3px]" />,
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
                                icon: <FileCode size={14} className="!-mb-[3px]" />,
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="w-full flex items-center justify-between">
                <a
                    href="https://agenta.ai/docs/evaluation/managing-test-sets/create-programatically"
                    target="_blank"
                    className="text-colorTextSecondary"
                >
                    Read the docs
                </a>

                <Button onClick={onCancel} variant="outline">
                    Close
                </Button>
            </div>
        </section>
    )
}

export default CreateTestsetFromApi
