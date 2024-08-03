import CopyButton from "@/components/CopyButton/CopyButton"
import DynamicCodeBlock from "@/components/DynamicCodeBlock/DynamicCodeBlock"
import {Environment, JSSTheme} from "@/lib/Types"
import {createParams} from "@/pages/apps/[app_id]/endpoints"
import {MoreOutlined, PythonOutlined} from "@ant-design/icons"
import {FileCode, FileTs} from "@phosphor-icons/react"
import {Button, Drawer, DrawerProps, Dropdown, Space, Tabs, Tag, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import fetchConfigcURLCode from "@/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/code_snippets/endpoints/fetch_config/typescript"
import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"

interface DeploymentDrawerProps {
    selectedEnvironment: Environment | undefined
}

const {Title, Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    drawerTitleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1.ant-typography": {
            fontSize: 22,
            fontWeight: 500,
            textTransform: "capitalize",
        },
    },
    drawerTabs: {
        "& .ant-tabs-content-holder": {
            maxHeight: 700,
            overflowY: "scroll",
        },
    },
}))

const DeploymentDrawer = ({selectedEnvironment, ...props}: DeploymentDrawerProps & DrawerProps) => {
    const classes = useStyles()
    const [selectedLang, setSelectedLang] = useState("python")

    // const params = createParams(inputParams, selectedEnvironment?.name || "none", "add_a_value")
    // const invokeLlmAppCodeSnippet: Record<string, string> = {
    //     Python: invokeLlmApppythonCode(uri!, params),
    //     cURL: invokeLlmAppcURLCode(uri!, params),
    //     TypeScript: invokeLlmApptsCode(uri!, params),
    // }

    // const fetchConfigCodeSnippet: Record<string, string> = {
    //     Python: fetchConfigpythonCode(variant.baseId, selectedEnvironment?.name!),
    //     cURL: fetchConfigcURLCode(variant.baseId, selectedEnvironment?.name!),
    //     TypeScript: fetchConfigtsCode(variant.baseId, selectedEnvironment?.name!),
    // }

    const fetchConfigCodeSnippet: Record<string, string> = {
        python: fetchConfigpythonCode("variant.baseId", selectedEnvironment?.name!),
        bash: fetchConfigcURLCode("variant.baseId", selectedEnvironment?.name!),
        typescript: fetchConfigtsCode("variant.baseId", selectedEnvironment?.name!),
    }

    return (
        <Drawer
            width={600}
            {...props}
            destroyOnClose
            closeIcon={null}
            title={
                <Space className={classes.drawerTitleContainer}>
                    <Title>{selectedEnvironment?.name} environment</Title>

                    <Space direction="horizontal">
                        <Button type="primary">Button1</Button>
                        <Button>Button2</Button>
                    </Space>
                </Space>
            }
        >
            <div className="flex flex-col gap-2">
                <div className="flex justify-between">
                    <div className="flex flex-col gap-1">
                        <Text className="font-[500]">Variant Deployed</Text>
                        <Tag color="blue" className="w-fit">
                            {selectedEnvironment?.deployed_variant_name}
                        </Tag>
                    </div>

                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                {
                                    key: "change_variant",
                                    label: "Change Variant",
                                },

                                {
                                    key: "open_playground",
                                    label: "Open in playground",
                                },
                            ],
                        }}
                    >
                        <Button type="text" icon={<MoreOutlined />} size="small" />
                    </Dropdown>
                </div>

                <div>
                    <Tabs
                        destroyInactiveTabPane
                        defaultActiveKey={selectedLang}
                        className={classes.drawerTabs}
                        items={[
                            {
                                key: "python",
                                label: "Python",
                                children: (
                                    <div className="flex flex-col gap-6">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <Text className="font-[500]">
                                                    Fetch Prompt/Config
                                                </Text>
                                                <CopyButton
                                                    buttonText={null}
                                                    text={"result"}
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
                                                    text={"result"}
                                                    icon={true}
                                                />
                                            </div>

                                            <CodeBlock
                                                key={selectedLang}
                                                language={selectedLang}
                                                value={fetchConfigCodeSnippet[selectedLang]}
                                            />
                                        </div>
                                    </div>
                                ),
                                icon: <PythonOutlined />,
                            },
                            {
                                key: "typescript",
                                label: "TypeScript",
                                children: (
                                    <div className="flex flex-col gap-6">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <Text className="font-[500]">
                                                    Fetch Prompt/Config
                                                </Text>
                                                <CopyButton
                                                    buttonText={null}
                                                    text={"result"}
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
                                                    text={"result"}
                                                    icon={true}
                                                />
                                            </div>

                                            <CodeBlock
                                                key={selectedLang}
                                                language={selectedLang}
                                                value={fetchConfigCodeSnippet[selectedLang]}
                                            />
                                        </div>
                                    </div>
                                ),
                                icon: <FileTs size={14} />,
                            },
                            {
                                key: "bash",
                                label: "cURL",
                                children: (
                                    <div className="flex flex-col gap-6">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <Text className="font-[500]">
                                                    Fetch Prompt/Config
                                                </Text>
                                                <CopyButton
                                                    buttonText={null}
                                                    text={"result"}
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
                                                    text={"result"}
                                                    icon={true}
                                                />
                                            </div>

                                            <CodeBlock
                                                key={selectedLang}
                                                language={selectedLang}
                                                value={fetchConfigCodeSnippet[selectedLang]}
                                            />
                                        </div>
                                    </div>
                                ),
                                icon: <FileCode size={14} />,
                            },
                        ]}
                        onChange={setSelectedLang}
                    />
                </div>
            </div>
        </Drawer>
    )
}

export default DeploymentDrawer
