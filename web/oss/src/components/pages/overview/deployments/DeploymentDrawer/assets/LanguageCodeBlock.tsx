import {CloudArrowUp} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import clsx from "clsx"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import CodeBlock from "@/oss/components/DynamicCodeBlock/CodeBlock"

import type {LanguageCodeBlockProps} from "../types"

const {Text} = Typography

const LanguageCodeBlock = ({
    selectedLang,
    fetchConfigCodeSnippet,
    invokeLlmAppCodeSnippet,
    handleOpenSelectDeployVariantModal,
    invokeLlmUrl,
}: LanguageCodeBlockProps) => {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Text className="font-[500]">Fetch Prompt/Config</Text>
                    {invokeLlmUrl && (
                        <CopyButton
                            buttonText={null}
                            text={fetchConfigCodeSnippet[selectedLang]}
                            icon={true}
                        />
                    )}
                </div>

                <div className="relative">
                    <CodeBlock
                        key={selectedLang}
                        language={selectedLang}
                        value={fetchConfigCodeSnippet[selectedLang]}
                    />

                    {!invokeLlmUrl && (
                        <div
                            className={clsx(
                                "absolute top-0 left-0 right-0 bottom-0",
                                "backdrop-blur-md bg-[#051729] bg-opacity-10 z-10",
                                "flex flex-col gap-2 items-center justify-center rounded-lg",
                            )}
                        >
                            <Typography>Deploy a variant to start using this endpoint</Typography>
                            <Button
                                icon={<CloudArrowUp />}
                                onClick={handleOpenSelectDeployVariantModal}
                            >
                                Deploy variant
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Text className="font-[500]">Invoke LLM</Text>
                    {invokeLlmUrl && (
                        <CopyButton
                            buttonText={null}
                            text={invokeLlmAppCodeSnippet[selectedLang]}
                            icon={true}
                        />
                    )}
                </div>

                <div className="relative">
                    <CodeBlock
                        key={selectedLang}
                        language={selectedLang}
                        value={invokeLlmAppCodeSnippet[selectedLang]}
                    />

                    {!invokeLlmUrl && (
                        <div
                            className={clsx(
                                "absolute top-0 left-0 right-0 bottom-0",
                                "backdrop-blur-md bg-[#051729] bg-opacity-10 z-10",
                                "flex flex-col gap-2 items-center justify-center rounded-lg",
                            )}
                        >
                            <Typography>Deploy a variant to start using this endpoint</Typography>
                            <Button
                                icon={<CloudArrowUp />}
                                onClick={handleOpenSelectDeployVariantModal}
                            >
                                Deploy variant
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default LanguageCodeBlock
