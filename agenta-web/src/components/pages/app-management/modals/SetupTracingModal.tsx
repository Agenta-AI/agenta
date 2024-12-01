import CopyButton from "@/components/CopyButton/CopyButton"
import {JSSTheme} from "@/lib/Types"
import {CloseOutlined, PythonOutlined} from "@ant-design/icons"
import {CodeBlock, FileTs, Play} from "@phosphor-icons/react"
import {Button, Flex, Input, Modal, message, Radio, Space, Tabs, TabsProps, Typography} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {IBM_Plex_Mono} from "next/font/google"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicContext, dynamicService} from "@/lib/helpers/dynamic"
import ApiKeyInput from "../components/ApiKeyInput"

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
            overflow: "hidden",
            borderRadius: 16,
            padding: 0,
            height: "100%",
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
        padding: theme.paddingLG,
        display: "flex",
        height: "100%",
        flexDirection: "column",
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

const SetupTracingModal = ({...props}: SetupTracingModalProps) => {
    const classes = useStyles()
    const [apiKeyValue, setApiKeyValue] = useState("")

    const listOfCommands = [
        {
            title: "Install dependencies",
            code: `pip install -U langchain langchain-openai`,
            radio: true,
        },
        {
            title: "Configure environment to langsmith",
            code: `LANGCHAIN_TRACING_V2=true\nLANGCHAIN_ENDPOINT="https://api.smith.langchain.com"\nLANGCHAIN_API_KEY="${apiKeyValue || "<your-api-key>"}"\nLANGCHAIN_PROJECT="pr-terrible-junk-60"`,
        },
        {
            title: "Run LLM, Chat model, or chain. Its trace will be sent to this project",
            code: `from langchain_openai import ChatOpenAI\nllm = ChatOpenAI()\n\nllm.invoke("Hello, world!")`,
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

                    {listOfCommands.map((command, index) => (
                        <div className="flex flex-col gap-2" key={index}>
                            <Flex align="center" justify="space-between">
                                <Space>
                                    <Text>{index + 1}.</Text>
                                    <Text>Install dependencies</Text>
                                </Space>

                                <Space>
                                    {command.radio && (
                                        <Radio.Group
                                            defaultValue={"python"}
                                            // defaultValue={appMsgDisplay}
                                            // onChange={(e) => setAppMsgDisplay(e.target.value)}
                                        >
                                            <Radio.Button value="python">Python</Radio.Button>
                                            <Radio.Button value="typescript">
                                                TypeScript
                                            </Radio.Button>
                                        </Radio.Group>
                                    )}
                                    <CopyButton buttonText={""} icon text={command.code} />
                                </Space>
                            </Flex>

                            <div className={`${classes.command}`}>
                                <pre className="m-0">{command.code}</pre>
                            </div>
                        </div>
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

                    <div>LiteLLM</div>
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

                    <div>LangChain</div>
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

                    <div>Instructor</div>
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
            <div className="h-full">
                <div className={classes.modalHeader}>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                    <Text>Set up tracing</Text>
                    <Button>
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
