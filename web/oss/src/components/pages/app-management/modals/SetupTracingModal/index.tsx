import {useMemo, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"
import {EnhancedModal, type EnhancedModalProps} from "@agenta/ui/components/modal"
import {CloseOutlined, LinkOutlined} from "@ant-design/icons"
import {Book, Play} from "@phosphor-icons/react"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {isDemo} from "@/oss/lib/helpers/utils"

import {generateCodeBlocks} from "./assets/generateCodeBlocks"

export const modalContainerClass = "overflow-hidden rounded-2xl p-0 transition-[width] duration-300"

export const modalHeaderClass =
    "flex items-center gap-3 py-4 px-6 [border-bottom:1px_solid_var(--ag-colorBorderSecondary)]"

export const modalBodyClass = "flex flex-col h-full overflow-y-auto gap-3 py-3 px-6"

const tabsClass = "h-full min-h-0 overflow-hidden"

const TracingTabContent = dynamic(
    () => import("./components/TracingTabContent").then((m) => m.TracingTabContent),
    {
        ssr: false,
    },
)

export const SetupTracingModalContent = ({
    isModal = true,
    isPostLogin = false,
    ...props
}: {
    isModal?: boolean
    onCancel: EnhancedModalProps["onCancel"]
    isPostLogin?: boolean
}) => {
    const [apiKeyValue, setApiKeyValue] = useState("")
    const codeBlocks = useMemo(() => generateCodeBlocks(apiKeyValue, isDemo()), [apiKeyValue])
    const items = [
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
                    <span className="text-center text-base">
                        Looking for other integrations? We support many more frameworks and
                        libraries.
                    </span>
                    <Button
                        size="lg"
                        render={
                            <a
                                href="https://agenta.ai/docs/observability/overview#integrations"
                                target="_blank"
                                rel="noopener noreferrer"
                            />
                        }
                    >
                        {<Book size={16} className="mt-1" />}
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
                    <Button onClick={() => props.onCancel?.({} as any)} variant="ghost" size="icon">
                        {<CloseOutlined />}
                    </Button>
                    <span className="flex-1 text-sm font-medium leading-[1.5714285714285714]">
                        Set up tracing
                    </span>

                    <div className="flex gap-2 items-center">
                        <Button
                            variant="outline"
                            render={
                                <a
                                    href="https://colab.research.google.com/github/Agenta-AI/agenta/blob/main/examples/jupyter/observability/quickstart.ipynb"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                />
                            }
                        >
                            {<Play size={16} className="mt-1" />}
                            Run in colab
                        </Button>
                        <Button
                            variant="outline"
                            render={
                                <a
                                    href="https://agenta.ai/docs/observability/observability-sdk"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                />
                            }
                        >
                            {<Book size={16} className="mt-1" />}
                            Read the docs
                        </Button>
                    </div>
                </div>
            )}
            <div className={modalBodyClass}>
                <div className={clsx("flex flex-col gap-1", isPostLogin && "mb-8")}>
                    <div className="flex justify-between items-center">
                        <h1 className="m-0 text-xl font-medium leading-[1.4]">Setup Tracing</h1>
                        {isPostLogin && (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    render={
                                        <a
                                            href="https://colab.research.google.com/github/Agenta-AI/agenta/blob/main/examples/jupyter/observability/quickstart.ipynb"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        />
                                    }
                                >
                                    {<Play size={16} className="mt-1" />}
                                    Run in colab
                                </Button>
                                <Button
                                    variant="outline"
                                    render={
                                        <a
                                            href="https://agenta.ai/docs/observability/quickstart-python"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        />
                                    }
                                >
                                    {<Book size={16} className="mt-1" />}
                                    Read the docs
                                </Button>
                            </div>
                        )}
                    </div>
                    <span className="text-sm leading-[1.5714285714285714]">
                        Debug effectively, bootstrap testsets, monitor and compare app versions
                    </span>
                </div>
                <Tabs defaultValue="openai" className={tabsClass}>
                    <TabsList variant="line" className="shrink-0 gap-4 overflow-x-auto">
                        {items.map((item) => (
                            <TabsTrigger key={item.key} value={item.key} className="p-0 pb-3">
                                {"icon" in item ? item.icon : null}
                                {item.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {items.map((item) => (
                            <TabsContent key={item.key} value={item.key} keepMounted>
                                {item.children}
                            </TabsContent>
                        ))}
                    </div>
                </Tabs>
            </div>
        </div>
    )
}

const SetupTracingModal = (props: EnhancedModalProps) => {
    return (
        <EnhancedModal
            footer={null}
            title={null}
            className={modalContainerClass}
            width={720}
            closeIcon={null}
            classNames={{body: "h-full overflow-hidden p-0"}}
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
