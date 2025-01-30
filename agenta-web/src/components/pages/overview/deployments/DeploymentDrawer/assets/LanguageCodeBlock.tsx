import {Typography} from "antd"

import CopyButton from "@/components/CopyButton/CopyButton"
import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"

import type {LanguageCodeBlockProps} from "../types"

const {Title, Text} = Typography

const LanguageCodeBlock = ({
    selectedLang,
    fetchConfigCodeSnippet,
    invokeLlmAppCodeSnippet,
}: LanguageCodeBlockProps) => {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Text className="font-[500]">Fetch Prompt/Config</Text>
                    <CopyButton
                        buttonText={null}
                        text={fetchConfigCodeSnippet[selectedLang]}
                        icon={true}
                    />
                </div>

                <CodeBlock
                    key={selectedLang}
                    language={selectedLang}
                    value={fetchConfigCodeSnippet[selectedLang]}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Text className="font-[500]">Invoke LLM</Text>
                    <CopyButton
                        buttonText={null}
                        text={invokeLlmAppCodeSnippet[selectedLang]}
                        icon={true}
                    />
                </div>

                <CodeBlock
                    key={selectedLang}
                    language={selectedLang}
                    value={invokeLlmAppCodeSnippet[selectedLang]}
                />
            </div>
        </div>
    )
}

export default LanguageCodeBlock
