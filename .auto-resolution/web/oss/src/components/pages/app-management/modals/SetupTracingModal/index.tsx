import {useMemo, useState} from "react"

import {CloseOutlined, LinkOutlined} from "@ant-design/icons"
import {Book, Play} from "@phosphor-icons/react"
import {Button, ModalProps, Tabs, TabsProps, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {isDemo} from "@/oss/lib/helpers/utils"

import {generateCodeBlocks} from "./assets/generateCodeBlocks"

export const modalContainerClass =
    "[transition:width_0.3s_ease] [&>div]:h-full [&_.ant-modal-container]:p-0 " +
    "[&_h1.ant-typography]:text-xl [&_h1.ant-typography]:leading-[1.4] [&_h1.ant-typography]:font-medium " +
    "[&_span.ant-typography]:text-sm [&_span.ant-typography]:leading-[1.5714285714285714] " +
    "[&_.ant-modal-content]:h-full [&_.ant-modal-content]:overflow-y-hidden [&_.ant-modal-content]:rounded-2xl " +
    "[&_.ant-modal-content]:p-0 [&_.ant-modal-body]:h-full"

export const modalHeaderClass =
    "flex items-center gap-3 py-4 px-6 [border-bottom:1px_solid_var(--ag-colorBorderSecondary)] " +
    "[&_.ant-typography]:flex-1 [&_.ant-typography]:text-sm [&_.ant-typography]:leading-[1.5714285714285714] " +
    "[&_.ant-typography]:font-medium"

export const modalBodyClass =
    "flex flex-col h-full overflow-y-auto gap-3 py-3 px-6 [&_.ant-tabs-tab-btn]:flex " +
    "[&_.ant-tabs-tab-btn]:items-center [&_.ant-tabs-tab-btn]:gap-0 [&_.ant-tabs-tab-icon]:flex " +
    "[&_.ant-tabs-tab-icon]:mr-0 [&_.ant-tabs-tab]:p-0 [&_.ant-tabs-tab]:mr-0"

const tabsClass =
    "h-full overflow-y-auto [&_.ant-tabs-tab-btn]:mb-3 [&_.ant-tabs-content-holder]:h-full " +
    "[&_.ant-tabs-content-holder]:overflow-y-auto"

const TracingTabContent = dynamic(
    () => import("./components/TracingTabContent").then((m) => m.TracingTabContent),
    {
        ssr: false,
    },
)

const {Text, Title} = Typography

export const SetupTracingModalContent = ({
    isModal = true,
    isPostLogin = false,
    ...props
}: {
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
                <div className={modalHeaderClass}>
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
            <div className={modalBodyClass}>
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
                <Tabs defaultActiveKey="openai" items={items} className={tabsClass} />
            </div>
        </div>
    )
}

const SetupTracingModal = (props: ModalProps) => {
    return (
        <EnhancedModal
            footer={null}
            title={null}
            className={modalContainerClass}
            width={720}
            closeIcon={null}
            styles={{
                container: {
                    height: 832,
                },
            }}
            {...props}
        >
            <SetupTracingModalContent onCancel={props.onCancel} />
        </EnhancedModal>
    )
}

export default SetupTracingModal
