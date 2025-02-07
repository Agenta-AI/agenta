import CopyButton from "@/components/CopyButton/CopyButton"
import {JSSTheme} from "@/lib/Types"
import {CloseOutlined, PythonOutlined} from "@ant-design/icons"
import {CodeBlock, FileTs, Play} from "@phosphor-icons/react"
import {Button, Flex, Modal, Space, Tabs, TabsProps, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import {IBM_Plex_Mono} from "next/font/google"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicComponent} from "@/lib/helpers/dynamic"

const ApiKeyInput: any = dynamicComponent("pages/app-management/components/ApiKeyInput")

const ibm_plex_mono = IBM_Plex_Mono({weight: "400", subsets: ["latin"]})

type SetupTracingModalProps = {} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        transition: "width 0.3s ease",
        "& > div": {
            height: "100%",
        },
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading3,
            lineHeight: theme.lineHeightHeading3,
            fontWeight: theme.fontWeightMedium,
        },
        "& span.ant-typography": {
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
        },
        "& .ant-modal-content": {
            height: "100%",
            overflowY: "hidden",
            borderRadius: 16,
            padding: 0,
            "& .ant-modal-body": {
                height: "100%",
            },
        },
    },
    modalHeader: {
        padding: `${theme.padding}px ${theme.paddingLG}px`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        "& .ant-typography": {
            flex: 1,
            fontSize: theme.fontSizeHeading5,
            lineHeight: theme.lineHeightHeading5,
            fontWeight: theme.fontWeightMedium,
        },
    },
    modalBody: {
        padding: `${theme.paddingSM}px ${theme.paddingLG}px`,
        display: "flex",
        height: "100%",
        flexDirection: "column",
        overflowY: "auto",
        gap: 24,
        "& .ant-tabs-tab-btn": {
            display: "flex",
            alignItems: "center",
            "& .ant-tabs-tab-icon": {
                display: "flex",
            },
        },
    },
    command: {
        padding: theme.paddingXS,
        backgroundColor: theme.colorBgContainerDisabled,
        borderRadius: theme.borderRadius,
        overflow: "auto",
        "& pre": {
            fontFamily: ibm_plex_mono.style.fontFamily,
        },
    },

    tabs: {
        height: "100%",
        "& .ant-tabs-content-holder": {
            height: "100%",
            overflowY: "auto",
        },
    },
}))

const {Text, Title} = Typography

const TracingCodeComponent = ({
    command,
    index,
}: {
    command: {
        title: string
        code: string
    }
    index: number
}) => {
    const classes = useStyles()

    return (
        <div className="flex flex-col gap-2">
            <Flex align="center" justify="space-between">
                <Space>
                    <Text>{index + 1}.</Text>
                    <Text>{command.title}</Text>
                </Space>

                <Space>
                    <CopyButton buttonText={""} icon text={command.code} />
                </Space>
            </Flex>

            <div className={`${classes.command}`}>
                <pre className="m-0">{command.code}</pre>
            </div>
        </div>
    )
}

const SetupTracingModal = ({...props}: SetupTracingModalProps) => {
    const classes = useStyles()
    const [apiKeyValue, setApiKeyValue] = useState("")

    const openaiCodeBlock = [
        {
            title: "Install the required packages:",
            code: `pip install -U agenta openai opentelemetry-instrumentation-openai`,
        },
        {
            title: "Initialize Agenta and Instrument OpenAI",
            code: `import os
import agenta as ag
import openai
from opentelemetry.instrumentation.openai import OpenAIInstrumentor

os.environ["AGENTA_HOST"] = "${process.env.NEXT_PUBLIC_AGENTA_API_URL}"
${isDemo() ? `os.environ["AGENTA_API_KEY"] = "${apiKeyValue || "{API_KEY}"}"` : ""}

ag.init()
OpenAIInstrumentor().instrument()

response = openai.ChatCompletion.create(
    model="gpt-3.5-turbo",
    messages=[{"role": "user", "content": "Write a short story about AI."
)

print(response.choices[0].message.content)`,
        },
    ]

    const langChainCodeBlock = [
        {
            title: "Install the required packages:",
            code: `pip install -U agenta openai opentelemetry-instrumentation-langchain langchain langchain_community`,
        },
        {
            title: "Initialize Agenta and Instrument LangChain",
            code: `import os
import agenta as ag
from langchain_community.chat_models import ChatOpenAI
from langchain.schema import HumanMessage
from opentelemetry.instrumentation.langchain import LangchainInstrumentor

os.environ["AGENTA_HOST"] = "${process.env.NEXT_PUBLIC_AGENTA_API_URL}"
${isDemo() ? `os.environ["AGENTA_API_KEY"] = ${apiKeyValue || "{API_KEY}"}` : ""}

ag.init()
LangchainInstrumentor().instrument()

chat = ChatOpenAI(model="gpt-3.5-turbo")

response = chat([HumanMessage(content="Write a short story about AI.")])

print(response.content)`,
        },
    ]

    const litellmCodeBlock = [
        {
            title: "Install the required packages:",
            code: `pip install -U agenta litellm`,
        },
        {
            title: "Initialize Agenta and Instrument LiteLLM",
            code: `import os
import agenta as ag
import litellm
import asyncio

os.environ["AGENTA_HOST"] = "${process.env.NEXT_PUBLIC_AGENTA_API_URL}"
${isDemo() ? `os.environ["AGENTA_API_KEY"] = ${apiKeyValue || "{API_KEY}"}` : ""}

ag.init()
litellm.callbacks = [ag.callbacks.litellm_handler()]

asyncio.run(
    litellm.acompletion(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": "Write a short story about AI."}],
    )
)

print(response["choices"][0]["message"]["content"])`,
        },
    ]

    const instructorCodeBlock = [
        {
            title: "Install the required packages:",
            code: `pip install -U agenta openai opentelemetry-instrumentation-openai instructor`,
        },
        {
            title: "Initialize Agenta and Instrument LiteLLM",
            code: `import os
import agenta as ag
import openai
import instructor
from opentelemetry.instrumentation.openai import OpenAIInstrumentor

os.environ["AGENTA_HOST"] = "${process.env.NEXT_PUBLIC_AGENTA_API_URL}"
${isDemo() ? `os.environ["AGENTA_API_KEY"] = "${apiKeyValue || "{API_KEY}"}"` : ""}

ag.init()
OpenAIInstrumentor().instrument()

client = instructor.from_openai(openai.OpenAI())

response = client.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[{"role": "user", "content": "Write a short story about AI."}],
)

print(response["choices"][0]["message"]["content"])`,
        },
    ]

    const items: TabsProps["items"] = [
        {
            key: "openai",
            label: "Open AI",
            icon: <PythonOutlined />,
            children: (
                <div className="flex flex-col gap-6">
                    <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />

                    {openaiCodeBlock.map((command, index) => (
                        <TracingCodeComponent key={index} command={command} index={index} />
                    ))}
                </div>
            ),
        },
        {
            key: "liteLLM",
            label: "LiteLLM",
            icon: <FileTs />,
            children: (
                <div className="flex flex-col gap-6">
                    <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />

                    {litellmCodeBlock.map((command, index) => (
                        <TracingCodeComponent key={index} command={command} index={index} />
                    ))}
                </div>
            ),
        },
        {
            key: "langChain",
            label: "LangChain",
            icon: <CodeBlock />,
            children: (
                <div className="flex flex-col gap-6">
                    <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />

                    {langChainCodeBlock.map((command, index) => (
                        <TracingCodeComponent key={index} command={command} index={index} />
                    ))}
                </div>
            ),
        },
        {
            key: "instructor",
            label: "Instructor",
            icon: <CodeBlock />,
            children: (
                <div className="flex flex-col gap-6">
                    <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />

                    {instructorCodeBlock.map((command, index) => (
                        <TracingCodeComponent key={index} command={command} index={index} />
                    ))}
                </div>
            ),
        },
    ]

    return (
        <Modal
            destroyOnClose
            footer={null}
            title={null}
            className={classes.modalContainer}
            width={720}
            height={832}
            centered
            closeIcon={null}
            {...props}
        >
            <div className="h-full flex flex-col">
                <div className={classes.modalHeader}>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                    <Text>Set up tracing</Text>
                    <Button
                        target="_blank"
                        href="https://docs.agenta.ai/observability/observability-sdk"
                    >
                        <Play />
                        Tutorial
                    </Button>
                </div>
                <div className={classes.modalBody}>
                    <Space direction="vertical">
                        <Title>Tracing</Title>
                        <Text>
                            Debug effectively, bootstrap test sets, monitor and compare app versions
                        </Text>
                    </Space>

                    <Tabs defaultActiveKey="openai" items={items} className={classes.tabs} />
                </div>
            </div>
        </Modal>
    )
}

export default SetupTracingModal
