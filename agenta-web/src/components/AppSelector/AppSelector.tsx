import {useState, useEffect, useMemo} from "react"
import {PlusOutlined} from "@ant-design/icons"
import {Modal, ConfigProvider, theme, Button, notification, Typography, Input, Divider} from "antd"
import AppCard from "./AppCard"
import {Template, GenericObject, StyleProps, JSSTheme} from "@/lib/Types"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import Welcome from "./Welcome"
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
import ResultComponent from "../ResultComponent/ResultComponent"
import {dynamicContext} from "@/lib/helpers/dynamic"
import AppTemplateCard from "./AppTemplateCard"
import dayjs from "dayjs"
import NoResultsFound from "../NoResultsFound/NoResultsFound"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: ({themeMode}: StyleProps) => ({
        marginTop: "24px",
        width: "100%",
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
    cardsList: {
        width: "100%",
        display: "grid",
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
    title: {
        fontSize: 16,
        fontWeight: theme.fontWeightMedium,
        lineHeight: "24px",
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
}))

const timeout = isDemo() ? 60000 : 30000

const AppSelector: React.FC = () => {
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
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")
    const {selectedOrg} = useOrgData()

    const hasAvailableApps = Array.isArray(apps) && apps.length > 0

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const showCreateAppModal = async () => {
        setIsCreateAppModalOpen(true)
    }

    const showMaxAppError = () => {
        setIsMaxAppModalOpen(true)
    }

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
                    hasAvailableApps={hasAvailableApps}
                    newApp={newApp}
                    templates={templates}
                    noTemplateMessage={noTemplateMessage}
                    templateId={templateId}
                    appNameExist={appNameExist}
                    setCurrent={setCurrent}
                    setNewApp={setNewApp}
                    onCardClick={(template) => {
                        setTemplateId(template.id)
                    }}
                    handleCreateApp={handleCreateApp}
                />
            ),
        },
        {
            content: (
                <WriteOwnAppModal setCurrent={setCurrent} hasAvailableApps={hasAvailableApps} />
            ),
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
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <div className={classes.container}>
                {!isLoading && !error && (
                    <div className="flex items-center justify-between mb-5">
                        <h1 className={classes.title}>App Management</h1>
                        {Array.isArray(apps) && apps.length ? (
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
                                        showMaxAppError()
                                    } else {
                                        showCreateAppModal()
                                    }
                                }}
                            >
                                Create new app
                            </Button>
                        ) : null}
                    </div>
                )}

                {isLoading || (!apps && !error) ? (
                    <div>
                        <ResultComponent status={"info"} title="Loading..." spinner={true} />
                    </div>
                ) : error ? (
                    <div>
                        <ResultComponent status={"error"} title="Failed to load" />
                    </div>
                ) : Array.isArray(apps) && apps.length ? (
                    <div className="flex flex-col gap-2">
                        <div className="-mx-6">
                            <Input.Search
                                placeholder="Search"
                                className="w-[400px] mx-6"
                                allowClear
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            <Divider />
                        </div>

                        {Array.isArray(apps) && filteredApps.length ? (
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
                ) : (
                    <Welcome
                        onWriteOwnApp={showWriteAppModal}
                        onCreateFromTemplate={showCreateAppFromTemplateModal}
                    />
                )}
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
        </ConfigProvider>
    )
}

export default AppSelector
