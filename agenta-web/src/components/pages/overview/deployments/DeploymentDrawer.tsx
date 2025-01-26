import CopyButton from "@/components/CopyButton/CopyButton"
import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {CloseOutlined, MoreOutlined, PythonOutlined} from "@ant-design/icons"
import {
    ArrowRight,
    ClockClockwise,
    CloudWarning,
    FileCode,
    FileTs,
    Rocket,
    Swap,
} from "@phosphor-icons/react"
import {Button, Drawer, DrawerProps, Dropdown, Space, Tabs, Tag, Tooltip, Typography} from "antd"
import React, {Dispatch, SetStateAction, useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import fetchConfigcURLCode from "@/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/code_snippets/endpoints/fetch_config/typescript"
import invokeLlmAppcURLCode from "@/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/code_snippets/endpoints/invoke_llm_app/typescript"
import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import {useRouter} from "next/router"
import {fetchAppContainerURL} from "@/services/api"
import {useVariant} from "@/lib/hooks/useVariant"
import {createParams, isDemo} from "@/lib/helpers/utils"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import VariantPopover from "../variants/VariantPopover"
import {useAppsData} from "@/contexts/app.context"

const DeploymentHistoryModal: any = dynamicComponent(
    "pages/overview/deployments/DeploymentHistoryModal",
)

interface DeploymentDrawerProps {
    selectedEnvironment: Environment
    variants: Variant[]
    loadEnvironments: () => Promise<void>
    setQueryEnv: (val: string) => void
    setOpenChangeVariantModal: Dispatch<SetStateAction<boolean>>
}

interface LanguageCodeBlockProps {
    selectedLang: string
    fetchConfigCodeSnippet: Record<string, string>
    invokeLlmAppCodeSnippet: Record<string, string>
}

const {Title, Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    drawerTitleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading5,
            fontWeight: theme.fontWeightMedium,
            textTransform: "capitalize",
        },
    },
    noDataContainer: {
        height: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
    },
}))

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

const DeploymentDrawer = ({
    variants,
    selectedEnvironment,
    loadEnvironments,
    setQueryEnv,
    setOpenChangeVariantModal,
    ...props
}: DeploymentDrawerProps & DrawerProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const {currentApp} = useAppsData()
    const [selectedLang, setSelectedLang] = useState("python")
    const [uri, setURI] = useState<string | null>(null)
    const [variant, setVariant] = useState<Variant | null>(null)
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

    useEffect(() => {
        loadURL(selectedEnvironment)
    }, [selectedEnvironment, appId])

    useEffect(() => {
        const variant = variants.find(
            (variant) => variant.variantId === selectedEnvironment.deployed_app_variant_id,
        )
        if (!variant) return

        setVariant(variant)
    }, [selectedEnvironment, variants])

    const loadURL = async (environment: Environment) => {
        if (environment.deployed_app_variant_id) {
            const url = await fetchAppContainerURL(appId, environment.deployed_app_variant_id)
            setURI(`${url}/generate_deployed`)
        }
    }

    const {inputParams, isChatVariant} = useVariant(appId, variant!)

    const params = createParams(
        inputParams,
        selectedEnvironment?.name || "none",
        "add_a_value",
        isChatVariant,
    )

    const invokeLlmAppCodeSnippet: Record<string, string> = {
        python: invokeLlmApppythonCode(uri!, params),
        bash: invokeLlmAppcURLCode(uri!, params),
        typescript: invokeLlmApptsCode(uri!, params),
    }

    const fetchConfigCodeSnippet: Record<string, string> = {
        python: fetchConfigpythonCode(currentApp?.app_name!, selectedEnvironment?.name!),
        bash: fetchConfigcURLCode(currentApp?.app_name!, selectedEnvironment?.name!),
        typescript: fetchConfigtsCode(currentApp?.app_name!, selectedEnvironment?.name!),
    }

    return (
        <>
            <Drawer
                width={720}
                {...props}
                destroyOnClose
                closeIcon={null}
                title={
                    <Space className={classes.drawerTitleContainer}>
                        <Space className="gap-3">
                            <Button
                                onClick={() => props.onClose?.({} as any)}
                                type="text"
                                icon={<CloseOutlined />}
                            />
                            <Title>{selectedEnvironment?.name} environment</Title>
                        </Space>

                        {selectedEnvironment.deployed_variant_name && (
                            <Space direction="horizontal">
                                <Tooltip
                                    title={
                                        isDemo()
                                            ? ""
                                            : "History available in Cloud/Enterprise editions only"
                                    }
                                >
                                    <Button
                                        size="small"
                                        className="flex items-center gap-2"
                                        disabled={!isDemo()}
                                        onClick={() => setIsHistoryModalOpen(true)}
                                    >
                                        <ClockClockwise size={16} />
                                        View history
                                    </Button>
                                </Tooltip>
                                <Dropdown
                                    trigger={["hover"]}
                                    menu={{
                                        items: [
                                            {
                                                key: "change_variant",
                                                label: "Change Variant",
                                                icon: <Swap size={16} />,
                                                onClick: () => {
                                                    setOpenChangeVariantModal(true)
                                                    setQueryEnv("")
                                                },
                                            },
                                            {
                                                key: "open_playground",
                                                label: "Open in playground",
                                                icon: <Rocket size={16} />,
                                                onClick: () =>
                                                    router.push(
                                                        `/apps/${appId}/playground?variant=${selectedEnvironment.deployed_variant_name}`,
                                                    ),
                                            },
                                        ],
                                    }}
                                >
                                    <Button type="text" icon={<MoreOutlined />} size="small" />
                                </Dropdown>
                            </Space>
                        )}
                    </Space>
                }
            >
                {selectedEnvironment.deployed_variant_name ? (
                    <div className="flex flex-col gap-6">
                        <div className="flex justify-between">
                            <Text className="font-[500]">Variant Deployed</Text>

                            {variant && (
                                <VariantPopover
                                    env={selectedEnvironment}
                                    selectedDeployedVariant={variant}
                                />
                            )}
                        </div>

                        <div>
                            <Tabs
                                destroyInactiveTabPane
                                defaultActiveKey={selectedLang}
                                items={[
                                    {
                                        key: "python",
                                        label: "Python",
                                        children: (
                                            <LanguageCodeBlock
                                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
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
                                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                                selectedLang={selectedLang}
                                            />
                                        ),
                                        icon: <FileTs size={14} />,
                                    },
                                    {
                                        key: "bash",
                                        label: "cURL",
                                        children: (
                                            <LanguageCodeBlock
                                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                                selectedLang={selectedLang}
                                            />
                                        ),
                                        icon: <FileCode size={14} />,
                                    },
                                ]}
                                onChange={setSelectedLang}
                            />
                        </div>
                    </div>
                ) : (
                    <div className={classes.noDataContainer}>
                        <CloudWarning size={40} />

                        <Typography.Text>
                            No deployment has been done on {selectedEnvironment.name} environment
                        </Typography.Text>

                        <Button
                            className="flex items-center gap-2"
                            onClick={() => {
                                setOpenChangeVariantModal(true)
                                setQueryEnv("")
                            }}
                        >
                            Deploy now <ArrowRight size={14} />
                        </Button>
                    </div>
                )}
            </Drawer>

            <DeploymentHistoryModal
                open={isHistoryModalOpen}
                onCancel={() => setIsHistoryModalOpen(false)}
                setIsHistoryModalOpen={setIsHistoryModalOpen}
                selectedEnvironment={selectedEnvironment}
                variant={variant}
            />
        </>
    )
}

export default DeploymentDrawer
