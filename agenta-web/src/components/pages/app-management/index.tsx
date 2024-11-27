import {useState, useEffect, useMemo} from "react"
import {PlusOutlined} from "@ant-design/icons"
import {
    Modal,
    Button,
    notification,
    Typography,
    Input,
    Card,
    Space,
    Flex,
    Radio,
    Pagination,
} from "antd"
import AppCard from "./components/AppCard"
import {Template, GenericObject, StyleProps, JSSTheme} from "@/lib/Types"

import {isAppNameInputValid, isDemo, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {createAndStartTemplate, fetchAllTemplates, deleteApp} from "@/services/app-selector/api"
import {waitForAppToStart} from "@/services/api"
import AddAppFromTemplatedModal from "./modals/AddAppFromTemplateModal"
import MaxAppModal from "./modals/MaxAppModal"
import WriteOwnAppModal from "./modals/WriteOwnAppModal"
import {createUseStyles} from "react-jss"
import {useAppsData} from "@/contexts/app.context"
import {useProfileData} from "@/contexts/profile.context"
import CreateAppStatusModal from "./modals/CreateAppStatusModal"
import {usePostHogAg} from "@/hooks/usePostHogAg"
import {LlmProvider, getAllProviderLlmKeys} from "@/lib/helpers/llmProviders"
import {dynamicContext} from "@/lib/helpers/dynamic"
import AppTemplateCard from "./components/AppTemplateCard"
import dayjs from "dayjs"
import {
    ArrowRight,
    BookOpen,
    Cards,
    Code,
    HandWaving,
    Info,
    Rocket,
    Table,
    TreeView,
} from "@phosphor-icons/react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useLocalStorage} from "usehooks-ts"
import AppTable from "./components/AppTable"
import NoResultsFound from "@/components/NoResultsFound/NoResultsFound"
import Image from "next/image"
import RagDemoImage from "@/media/rag-demo-app.png"
import Link from "next/link"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: ({themeMode}: StyleProps) => ({
        width: "100%",
        color: themeMode === "dark" ? "#fff" : "#000",
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading2,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading2,
        },
        "& h2.ant-typography": {
            fontSize: theme.fontSizeHeading3,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading3,
        },
        "& span.ant-typography": {
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
            color: "inherit",
        },
    }),
    cardsList: {
        width: "100%",
        display: "grid",
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadius,
        padding: theme.padding,
        gap: 16,
        "@media (max-width: 1199px)": {
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        },
        "@media (min-width: 1200px) and (max-width: 1699px)": {
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        },
        "@media (min-width: 1700px) and (max-width: 2000px)": {
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        },
        "@media (min-width: 2001px)": {
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        },
    },
    modal: {
        transition: "width 0.3s ease",
        "& .ant-modal-content": {
            overflow: "hidden",
            borderRadius: 16,
            "& > .ant-modal-close": {
                top: 16,
            },
        },
    },
    appTemplate: {
        gap: 16,
        display: "flex",
        flexDirection: "column",
    },
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    getStartedCard: {
        width: 226,
        cursor: "pointer",
        transition: "all 0.025s ease-in",
        "& .ant-card-head": {
            padding: 12,
            borderBottom: "none",
            minHeight: "auto",
            marginBottom: "auto",
            color: "inherit",
            "& .ant-card-head-title": {
                display: "flex",
            },
        },
        "& .ant-card-body": {
            padding: 12,
            "& span.ant-typography": {
                textOverflow: "ellipsis",
                fontSize: theme.fontSizeLG,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeightLG,
                color: "inherit",
            },
        },
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
        },
        "&:first-of-type": {
            backgroundColor: theme.colorPrimary,
            color: `${theme.colorWhite} !important`,
            "&:hover": {
                backgroundColor: theme.colorPrimaryHover,
            },
        },
    },
    rag_demo_card: {
        width: 400,
        "& .ant-card-body": {
            padding: theme.paddingSM,
            "& span.ant-typography": {
                textOverflow: "ellipsis",
                fontSize: theme.fontSizeLG,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeightLG,
                color: "inherit",
            },
            "& div.ant-typography": {
                fontSize: theme.fontSizeLG,
                lineHeight: theme.lineHeightLG,
                color: theme.colorTextSecondary,
            },
        },
    },
    helperCard: {
        maxWidth: 400,
        flex: 1,
        gap: 12,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        transition: "all 0.025s ease-in",
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadius,
        padding: theme.paddingSM,
        "& span.ant-typography": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: theme.fontSizeLG,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightLG,
            flex: 1,
        },
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
        },
    },
}))

const timeout = isDemo() ? 60000 : 30000

const {Title, Text, Paragraph} = Typography

const AppManagement: React.FC = () => {
    const posthog = usePostHogAg()
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [isCreateAppModalOpen, setIsCreateAppModalOpen] = useState(false)
    const [isMaxAppModalOpen, setIsMaxAppModalOpen] = useState(false)
    const [templates, setTemplates] = useState<Template[]>([])
    const {user} = useProfileData()
    const [noTemplateMessage, setNoTemplateMessage] = useState("")
    const [templateId, setTemplateId] = useState<string | undefined>(undefined)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const [fetchingTemplate, setFetchingTemplate] = useState(false)
    const [newApp, setNewApp] = useState("")
    const [current, setCurrent] = useState(0)
    const [searchTerm, setSearchTerm] = useState("")
    const {apps, error, isLoading, mutate} = useAppsData()
    const [statusData, setStatusData] = useState<{status: string; details?: any; appId?: string}>({
        status: "",
        details: undefined,
        appId: undefined,
    })
    const [appMsgDisplay, setAppMsgDisplay] = useLocalStorage<"card" | "list">(
        "app_management_display",
        "list",
    )
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")
    const {selectedOrg} = useOrgData()

    const hasAvailableApps = Array.isArray(apps) && apps.length > 0

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const showCreateAppFromTemplateModal = () => {
        setTemplateId(undefined)
        setNewApp("")
        setIsCreateAppModalOpen(true)
        setCurrent(hasAvailableApps ? 1 : 0)
    }

    const showWriteAppModal = () => {
        setIsCreateAppModalOpen(true)
        setCurrent(hasAvailableApps ? 2 : 1)
    }

    useEffect(() => {
        if (!isLoading) mutate()
        const fetchTemplates = async () => {
            const data = await fetchAllTemplates()
            if (typeof data == "object") {
                setTemplates(data)
            } else {
                setNoTemplateMessage(data)
            }
        }

        fetchTemplates()
    }, [])

    const handleTemplateCardClick = async (template_id: string) => {
        setIsCreateAppModalOpen(false)
        // warn the user and redirect if openAI key is not present
        // TODO: must be changed for multiples LLM keys
        if (redirectIfNoLLMKeys()) return

        setFetchingTemplate(true)
        setStatusModalOpen(true)

        // attempt to create and start the template, notify user of the progress
        const apiKeys = getAllProviderLlmKeys()
        await createAndStartTemplate({
            appName: newApp,
            templateId: template_id,
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            timeout,
            onStatusChange: async (status, details, appId) => {
                setStatusData((prev) => ({status, details, appId: appId || prev.appId}))
                if (["error", "bad_request", "timeout", "success"].includes(status))
                    setFetchingTemplate(false)
                if (status === "success") {
                    mutate()
                    posthog.capture("app_deployment", {
                        properties: {
                            app_id: appId,
                            environment: "UI",
                            deployed_by: user?.id,
                        },
                    })
                }
            },
        })
    }

    const onErrorRetry = async () => {
        if (statusData.appId) {
            setStatusData((prev) => ({...prev, status: "cleanup", details: undefined}))
            await deleteApp(statusData.appId).catch(console.error)
            mutate()
        }
        handleTemplateCardClick(templateId as string)
    }

    const onTimeoutRetry = async () => {
        if (!statusData.appId) return
        setStatusData((prev) => ({...prev, status: "starting_app", details: undefined}))
        try {
            await waitForAppToStart({appId: statusData.appId, timeout})
        } catch (error: any) {
            if (error.message === "timeout") {
                setStatusData((prev) => ({...prev, status: "timeout", details: undefined}))
            } else {
                setStatusData((prev) => ({...prev, status: "error", details: error}))
            }
        }
        setStatusData((prev) => ({...prev, status: "success", details: undefined}))
        mutate()
    }

    const appNameExist = useMemo(
        () =>
            apps.some((app: GenericObject) => app.app_name.toLowerCase() === newApp.toLowerCase()),
        [apps, newApp],
    )

    const handleCreateApp = () => {
        if (appNameExist) {
            notification.warning({
                message: "Template Selection",
                description: "App name already exists. Please choose a different name.",
                duration: 3,
            })
        } else if (fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
            notification.info({
                message: "Template Selection",
                description: "The template image is currently being fetched. Please wait...",
                duration: 3,
            })
        } else if (!fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
            handleTemplateCardClick(templateId as string)
        } else {
            notification.warning({
                message: "Template Selection",
                description: "Please provide a valid app name to choose a template.",
                duration: 3,
            })
        }
    }

    const filteredApps = useMemo(() => {
        let filtered = apps.sort(
            (a, b) => dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf(),
        )

        if (searchTerm) {
            filtered = apps.filter((app) =>
                app.app_name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
        return filtered
    }, [apps, searchTerm])

    const steps = [
        {
            content: (
                <AddAppFromTemplatedModal
                    newApp={newApp}
                    templates={templates}
                    noTemplateMessage={noTemplateMessage}
                    templateId={templateId}
                    appNameExist={appNameExist}
                    setNewApp={setNewApp}
                    onCardClick={(template) => {
                        setTemplateId(template.id)
                    }}
                    handleCreateApp={handleCreateApp}
                />
            ),
        },
        {
            content: <WriteOwnAppModal />,
        },
    ]

    if (hasAvailableApps) {
        steps.unshift({
            content: (
                <section className={classes.appTemplate}>
                    <Typography.Text className={classes.headerText}>Add new app</Typography.Text>

                    <AppTemplateCard
                        onWriteOwnApp={showWriteAppModal}
                        onCreateFromTemplate={showCreateAppFromTemplateModal}
                    />
                </section>
            ),
        })
    }

    return (
        <>
            <div className={classes.container}>
                <Title>App Management</Title>

                <div className="my-6 flex flex-col gap-4">
                    <Title level={2}>Get Started</Title>

                    <div className="flex gap-4">
                        <Card
                            title={<Rocket size={24} />}
                            className={classes.getStartedCard}
                            onClick={() => {
                                if (
                                    isDemo() &&
                                    selectedOrg?.is_paying == false &&
                                    apps.length > 2
                                ) {
                                    setIsMaxAppModalOpen(true)
                                } else {
                                    showCreateAppFromTemplateModal()
                                }
                            }}
                        >
                            <div className="flex items-center justify-between">
                                <Text>Create New Prompt</Text>

                                <Info size={16} />
                            </div>
                        </Card>

                        <Card title={<TreeView size={24} />} className={classes.getStartedCard}>
                            <div className="flex items-center justify-between">
                                <Text>Set Up Tracing</Text>

                                <Info size={16} />
                            </div>
                        </Card>

                        <Card
                            title={<Code size={24} />}
                            className={classes.getStartedCard}
                            onClick={showWriteAppModal}
                        >
                            <div className="flex items-center justify-between">
                                <Text>Create Custom Workflow</Text>

                                <Info size={16} />
                            </div>
                        </Card>
                    </div>
                </div>

                <div className="my-10 flex flex-col gap-2">
                    <Flex justify="space-between" align="center">
                        <Space>
                            <Title level={2}>Application</Title>
                            <Button
                                type="primary"
                                data-cy="create-new-app-button"
                                icon={<PlusOutlined />}
                                onClick={() => {
                                    if (
                                        isDemo() &&
                                        selectedOrg?.is_paying == false &&
                                        apps.length > 2
                                    ) {
                                        setIsMaxAppModalOpen(true)
                                    } else {
                                        showCreateAppFromTemplateModal()
                                    }
                                }}
                            >
                                Create new app
                            </Button>
                        </Space>
                        <Space>
                            <Input.Search
                                placeholder="Search"
                                className="w-[400px]"
                                allowClear
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />

                            <Radio.Group
                                defaultValue={appMsgDisplay}
                                onChange={(e) => setAppMsgDisplay(e.target.value)}
                            >
                                <Radio.Button value="list">
                                    <Table size={16} className="h-full" />
                                </Radio.Button>
                                <Radio.Button value="card">
                                    <Cards size={16} className="h-full" />
                                </Radio.Button>
                            </Radio.Group>
                        </Space>
                    </Flex>

                    <div>
                        {appMsgDisplay === "list" ? (
                            <AppTable filteredApps={filteredApps} isLoading={isLoading} />
                        ) : filteredApps.length ? (
                            <div className={classes.cardsList}>
                                {filteredApps.map((app, index: number) => (
                                    <div key={index}>
                                        <AppCard app={app} />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <NoResultsFound />
                        )}
                    </div>

                    <Pagination
                        total={85}
                        showTotal={(total) => `Total ${total} items`}
                        defaultPageSize={10}
                        defaultCurrent={1}
                        align="end"
                    />
                </div>

                <div className="my-10 flex flex-col gap-4">
                    <Space direction="vertical" size={8}>
                        <Title level={2}>Explore demo applications</Title>
                        <Text>
                            See Agenta in action by exploring fully build prompts, evaluations,
                            observability and traces. Learn how to set your application by watching
                            tutorials.
                        </Text>
                    </Space>

                    <div>
                        <Card
                            className={classes.rag_demo_card}
                            cover={
                                <Image
                                    src={RagDemoImage}
                                    alt="rag_demo_application_image"
                                    priority
                                />
                            }
                        >
                            <Space direction="vertical" size={24}>
                                <Space direction="vertical">
                                    <Text>RAG Q&A with Wikipedia</Text>
                                    <Paragraph>
                                        Use RAG to answer questions by fetching relevant information
                                        from wikipedia
                                    </Paragraph>
                                </Space>
                                <Flex gap={8}>
                                    <Button className="flex-[0.3]">Read Tutorial</Button>
                                    <Button className="flex-[0.7]">View Demo</Button>
                                </Flex>
                            </Space>
                        </Card>
                    </div>
                </div>

                <div className="mt-10 mb-20 flex flex-col gap-4">
                    <Space direction="vertical" size={8}>
                        <Title level={2}>Have a question?</Title>
                        <Text>Checkout our docs or send us a message on slack.</Text>
                    </Space>

                    <div className="flex items-center w-full gap-4">
                        <Link
                            href="https://docs.agenta.ai/"
                            target="_blank"
                            className={classes.helperCard}
                        >
                            <Code size={24} />
                            <Text>Learn how to create a prompt</Text>
                            <ArrowRight size={18} />
                        </Link>
                        <Link
                            className={classes.helperCard}
                            href="https://docs.agenta.ai/"
                            target="_blank"
                        >
                            <BookOpen size={24} />
                            <Text>Check out docs</Text>
                            <ArrowRight size={18} />
                        </Link>

                        <Link
                            href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA"
                            target="_blank"
                            className={classes.helperCard}
                        >
                            <HandWaving size={24} />
                            <Text>Say hello at Slack</Text>
                            <ArrowRight size={18} />
                        </Link>
                    </div>
                </div>
            </div>

            <Modal
                open={isCreateAppModalOpen}
                afterClose={() => setCurrent(0)}
                onCancel={() => {
                    setIsCreateAppModalOpen(false)
                }}
                footer={null}
                title={null}
                className={classes.modal}
                width={steps.length === 3 && current == 0 ? 855 : 480}
                centered
            >
                {steps[current]?.content}
            </Modal>

            <MaxAppModal
                open={isMaxAppModalOpen}
                onCancel={() => {
                    setIsMaxAppModalOpen(false)
                }}
            />

            <CreateAppStatusModal
                open={statusModalOpen}
                loading={fetchingTemplate}
                onErrorRetry={onErrorRetry}
                onTimeoutRetry={onTimeoutRetry}
                onCancel={() => setStatusModalOpen(false)}
                statusData={statusData}
                appName={newApp}
            />
        </>
    )
}

export default AppManagement
