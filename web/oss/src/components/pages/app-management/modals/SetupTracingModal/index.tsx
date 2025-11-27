import {MouseEvent, useMemo, useState} from "react"

import {CloseOutlined, PythonOutlined} from "@ant-design/icons"
import {Book, CodeBlock, FileTs, Play} from "@phosphor-icons/react"
import {Button, ModalProps, Space, Tabs, TabsProps, Typography} from "antd"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {isDemo} from "@/oss/lib/helpers/utils"

import {generateCodeBlocks} from "./assets/generateCodeBlocks"
import {useStyles} from "./assets/styles"

export {useStyles}

const TracingTabContent = dynamic(
    () => import("./components/TracingTabContent").then((m) => m.TracingTabContent),
    {
        ssr: false,
    },
)

const {Text, Title} = Typography

export const SetupTracingModalContent = ({
    classes,
    isModal = true,
    ...props
}: {
    classes: any
    isModal?: boolean
    onCancel: ModalProps["onCancel"]
}) => {
    const [apiKeyValue, setApiKeyValue] = useState("")
    const codeBlocks = useMemo(() => generateCodeBlocks(apiKeyValue, isDemo()), [apiKeyValue])
    const items: TabsProps["items"] = [
        {
            key: "openai",
            label: "Open AI",
            icon: <PythonOutlined />,
            children: (
                <TracingTabContent
                    apiKeyValue={apiKeyValue}
                    setApiKeyValue={setApiKeyValue}
                    codeBlock={codeBlocks.openai}
                />
            ),
        },
        {
            key: "liteLLM",
            label: "LiteLLM",
            icon: <FileTs />,
            children: (
                <TracingTabContent
                    apiKeyValue={apiKeyValue}
                    setApiKeyValue={setApiKeyValue}
                    codeBlock={codeBlocks.liteLLM}
                />
            ),
        },
        {
            key: "langChain",
            label: "LangChain",
            icon: <CodeBlock />,
            children: (
                <TracingTabContent
                    apiKeyValue={apiKeyValue}
                    setApiKeyValue={setApiKeyValue}
                    codeBlock={codeBlocks.langChain}
                />
            ),
        },
        {
            key: "instructor",
            label: "Instructor",
            icon: <CodeBlock />,
            children: (
                <TracingTabContent
                    apiKeyValue={apiKeyValue}
                    setApiKeyValue={setApiKeyValue}
                    codeBlock={codeBlocks.instructor}
                />
            ),
        },
        {
            key: "langGraph",
            label: "LangGraph",
            icon: <CodeBlock />,
            children: (
                <TracingTabContent
                    apiKeyValue={apiKeyValue}
                    setApiKeyValue={setApiKeyValue}
                    codeBlock={codeBlocks.langGraph}
                />
            ),
        },
        {
            key: "llamaIndex",
            label: "LlamaIndex",
            icon: <CodeBlock />,
            children: (
                <TracingTabContent
                    apiKeyValue={apiKeyValue}
                    setApiKeyValue={setApiKeyValue}
                    codeBlock={codeBlocks.llamaIndex}
                />
            ),
        },
    ]

    return (
        <div className="h-full flex flex-col">
            {isModal && (
                <div className={classes.modalHeader}>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                    <Text>Set up tracing</Text>
                    <Button
                        target="_blank"
                        href="https://agenta.ai/docs/observability/observability-sdk"
                    >
                        <Play />
                        Tutorial
                    </Button>
                </div>
            )}
            <div className={classes.modalBody}>
                <div className="flex flex-col gap-1 mb-8">
                    <div className="flex justify-between items-center">
                        <Title style={{margin: 0}}>Setup Tracing</Title>
                        <div className="flex items-center gap-2">
                            <Button
                                icon={<Play size={16} />}
                                href="https://colab.research.google.com/github/Agenta-AI/agenta/blob/main/examples/jupyter/observability/quickstart.ipynb"
                                target="_blank"
                            >
                                Run in Colab
                            </Button>
                            <Button
                                icon={<Book size={16} />}
                                href="https://agenta.ai/docs/observability/quickstart-python"
                                target="_blank"
                            >
                                Read the Docs
                            </Button>
                        </div>
                    </div>
                    <Text>
                        Debug effectively, bootstrap testsets, monitor and compare app versions
                    </Text>
                </div>
                <Tabs defaultActiveKey="openai" items={items} className={classes.tabs} />
            </div>
        </div>
    )
}

const SetupTracingModal = (props: ModalProps) => {
    const classes = useStyles()

    return (
        <EnhancedModal
            footer={null}
            title={null}
            className={classes.modalContainer}
            width={720}
            height={832}
            closeIcon={null}
            {...props}
        >
            <SetupTracingModalContent classes={classes} onCancel={props.onCancel} />
        </EnhancedModal>
    )
}

export default SetupTracingModal
