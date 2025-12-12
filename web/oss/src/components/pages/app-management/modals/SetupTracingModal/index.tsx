import {useMemo, useState} from "react"

import {CloseOutlined, LinkOutlined} from "@ant-design/icons"
import {Book, Play} from "@phosphor-icons/react"
import {Button, ModalProps, Tabs, TabsProps, Typography} from "antd"
import clsx from "clsx"
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
    isPostLogin = false,
    ...props
}: {
    classes: any
    isModal?: boolean
    onCancel: ModalProps["onCancel"]
    isPostLogin?: boolean
}) => {
    const [apiKeyValue, setApiKeyValue] = useState("")
    const codeBlocks = useMemo(() => generateCodeBlocks(apiKeyValue, isDemo()), [apiKeyValue])
    const items: TabsProps["items"] = [
        {
            key: "openai",
            label: "OpenAI",
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
            children: (
                <TracingTabContent
                    apiKeyValue={apiKeyValue}
                    setApiKeyValue={setApiKeyValue}
                    codeBlock={codeBlocks.llamaIndex}
                />
            ),
        },
        {
            key: "others",
            label: "More Integrations",
            icon: <LinkOutlined />,
            children: (
                <div className="flex flex-col gap-6 items-center justify-center py-12">
                    <Text className="text-center" style={{fontSize: 16}}>
                        Looking for other integrations? We support many more frameworks and
                        libraries.
                    </Text>
                    <Button
                        type="primary"
                        size="large"
                        icon={<Book size={16} className="mt-1" />}
                        href="https://agenta.ai/docs/observability/overview#integrations"
                        target="_blank"
                    >
                        View All Integrations
                    </Button>
                </div>
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

                    <div className="flex gap-2 items-center">
                        <Button
                            icon={<Play size={16} className="mt-1" />}
                            href="https://colab.research.google.com/github/Agenta-AI/agenta/blob/main/examples/jupyter/observability/quickstart.ipynb"
                            target="_blank"
                        >
                            Run in colab
                        </Button>
                        <Button
                            target="_blank"
                            href="https://agenta.ai/docs/observability/observability-sdk"
                            icon={<Book size={16} className="mt-1" />}
                        >
                            Read the docs
                        </Button>
                    </div>
                </div>
            )}
            <div className={classes.modalBody}>
                <div className={clsx("flex flex-col gap-1", isPostLogin && "mb-8")}>
                    <div className="flex justify-between items-center">
                        <Title style={{margin: 0}}>Setup Tracing</Title>
                        {isPostLogin && (
                            <div className="flex items-center gap-2">
                                <Button
                                    icon={<Play size={16} className="mt-1" />}
                                    href="https://colab.research.google.com/github/Agenta-AI/agenta/blob/main/examples/jupyter/observability/quickstart.ipynb"
                                    target="_blank"
                                >
                                    Run in colab
                                </Button>
                                <Button
                                    icon={<Book size={16} className="mt-1" />}
                                    href="https://agenta.ai/docs/observability/quickstart-python"
                                    target="_blank"
                                >
                                    Read the docs
                                </Button>
                            </div>
                        )}
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
