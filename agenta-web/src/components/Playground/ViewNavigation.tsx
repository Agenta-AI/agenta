import React, {useEffect, useRef} from "react"
import {Col, Row, Divider, Button, Tooltip, Spin, notification} from "antd"
import TestView from "./Views/TestView"
import ParametersView from "./Views/ParametersView"
import {useVariant} from "@/lib/hooks/useVariant"
import {Environment, Variant} from "@/lib/Types"
import {useRouter} from "next/router"
import {useState} from "react"
import axios from "axios"
import {createUseStyles} from "react-jss"
import {
    fetchVariantLogs,
    getAppContainerURL,
    removeVariant,
    restartAppVariantContainer,
    waitForAppToStart,
} from "@/lib/services/api"
import {useAppsData} from "@/contexts/app.context"
import {isDemo} from "@/lib/helpers/utils"
import ResultComponent from "../ResultComponent/ResultComponent"

interface Props {
    variant: Variant
    handlePersistVariant: (variantName: string) => void
    environments: Environment[]
    deleteVariant: (deleteAction?: Function) => void
    getHelpers: (helpers: {save: Function; delete: Function}) => void
    onStateChange: (isDirty: boolean) => void
    compareMode: boolean
    tabID: React.MutableRefObject<string>
}

const useStyles = createUseStyles({
    row: {
        marginTop: "20px",
    },
    restartBtnMargin: {
        marginRight: "10px",
    },
    errorLogs: {
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
    },
})

const ViewNavigation: React.FC<Props> = ({
    variant,
    handlePersistVariant,
    environments,
    deleteVariant,
    getHelpers,
    onStateChange,
    compareMode,
    tabID,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as unknown as string
    const {
        inputParams,
        promptOptParams,
        refetch,
        isError,
        error,
        isParamSaveLoading,
        saveOptParams,
        isLoading,
        isChatVariant,
        historyStatus,
        setPromptOptParams,
        setHistoryStatus,
    } = useVariant(appId, variant)

    const [retrying, setRetrying] = useState(false)
    const [isParamsCollapsed, setIsParamsCollapsed] = useState("1")
    const [containerURI, setContainerURI] = useState("")
    const [variantErrorLogs, setVariantErrorLogs] = useState("")
    const [restarting, setRestarting] = useState<boolean>(false)
    const {currentApp} = useAppsData()
    const retriedOnce = useRef(false)
    const netWorkError = (error as any)?.code === "ERR_NETWORK"
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)

    let prevKey = ""
    const showNotification = (config: Parameters<typeof notification.open>[0]) => {
        if (prevKey) notification.destroy(prevKey)
        prevKey = (config.key || "") as string
        notification.open(config)
    }

    useEffect(() => {
        if (netWorkError) {
            retriedOnce.current = true
            setRetrying(true)
            waitForAppToStart({appId, variant, timeout: isDemo() ? 40000 : 6000})
                .then(() => {
                    refetch()
                })
                .catch(() => {
                    showNotification({
                        type: "error",
                        message: "Variant unreachable",
                        description: `Unable to connect to the variant.`,
                    })
                })
                .finally(() => {
                    setRetrying(false)
                })
        }

        if (isError) {
            const getLogs = async () => {
                const logs = await fetchVariantLogs(variant.variantId)
                setVariantErrorLogs(logs)
            }
            getLogs()
        }
    }, [netWorkError, isError, variant.variantId])

    if (retrying || (!retriedOnce.current && netWorkError)) {
        return (
            <ResultComponent
                status={"info"}
                title="Waiting for the variant to start"
                spinner={retrying}
            />
        )
    }

    if (isError) {
        let variantDesignator = variant.templateVariantName
        let appName = currentApp?.app_name || ""
        let imageName = `agentaai/${appName.toLowerCase()}_`

        if (!variantDesignator || variantDesignator === "") {
            variantDesignator = variant.variantName
            imageName += variantDesignator.toLowerCase()
        } else {
            imageName += variantDesignator.toLowerCase()
        }

        const variantContainerPath = async () => {
            const url = await getAppContainerURL(appId, variant.variantId, variant.baseId)
            setContainerURI(url)
        }
        if (!containerURI) {
            variantContainerPath()
        }

        const restartContainerHandler = async () => {
            // Set restarting to true
            setRestarting(true)
            try {
                const response = await restartAppVariantContainer(variant.variantId)
                if (response.status === 200) {
                    showNotification({
                        type: "success",
                        message: "App Container",
                        description: `${response.data.message}`,
                        duration: 5,
                        key: response.status,
                    })

                    // Set restarting to false
                    await waitForAppToStart({appId, variant})
                    router.reload()
                    setRestarting(false)
                }
            } catch {
            } finally {
                setRestarting(false)
            }
        }

        const apiAddress = `${containerURI}/openapi.json`
        return (
            <div>
                {error ? (
                    <div>
                        <p>
                            Error connecting to the variant {variant.variantName}.{" "}
                            {(axios.isAxiosError(error) && error.response?.status === 404 && (
                                <span>
                                    Container is not running. <b>See logs below:</b>
                                </span>
                            )) || <span>{error.message}</span>}
                        </p>
                        <ul>
                            {isDemo() && (
                                <div>
                                    <pre className={classes.errorLogs}>{variantErrorLogs}</pre>
                                </div>
                            )}
                            {!isDemo() && (
                                <div>
                                    <pre className={classes.errorLogs}>{variantErrorLogs}</pre>
                                </div>
                            )}
                        </ul>
                        <p>
                            Verify API accessibility at{" "}
                            <a href={apiAddress} target="_blank">
                                {apiAddress}
                            </a>
                        </p>
                        <p>
                            {" "}
                            If the issue persists please file an issue in github
                            <a
                                href="https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20ViewNavigation.tsx"
                                target="_blank"
                            >
                                {" "}
                                here
                            </a>
                        </p>

                        <Button
                            type="primary"
                            onClick={() => {
                                restartContainerHandler()
                            }}
                            disabled={restarting}
                            loading={restarting}
                            className={classes.restartBtnMargin}
                        >
                            <Tooltip placement="bottom" title="Restart the variant container">
                                Restart Container
                            </Tooltip>
                        </Button>

                        <Button
                            type="primary"
                            danger
                            onClick={() => {
                                deleteVariant(() => removeVariant(variant.variantId))
                            }}
                        >
                            <Tooltip placement="bottom" title="Delete the variant permanently">
                                Delete Variant
                            </Tooltip>
                        </Button>
                    </div>
                ) : null}
            </div>
        )
    }

    return (
        <Spin spinning={isLoading}>
            <Row gutter={[{xs: 8, sm: 16, md: 24, lg: 32}, 20]}>
                <Col span={24}>
                    <ParametersView
                        compareMode={compareMode}
                        variant={variant}
                        optParams={promptOptParams}
                        isParamSaveLoading={isParamSaveLoading}
                        onOptParamsChange={saveOptParams}
                        handlePersistVariant={handlePersistVariant}
                        isPersistent={variant.persistent} // if the variant persists in the backend, then saveoptparams will need to know to update and not save new variant
                        deleteVariant={deleteVariant}
                        isParamsCollapsed={isParamsCollapsed}
                        setIsParamsCollapsed={setIsParamsCollapsed}
                        environments={environments}
                        getHelpers={getHelpers}
                        onStateChange={onStateChange}
                        tabID={tabID}
                        setHistoryStatus={setHistoryStatus}
                        setIsDrawerOpen={setIsDrawerOpen}
                        isDrawerOpen={isDrawerOpen}
                        historyStatus={historyStatus}
                    />
                </Col>
            </Row>
            <Divider />

            <Row gutter={[{xs: 8, sm: 16, md: 24, lg: 32}, 20]} className={classes.row}>
                <Col span={24}>
                    <TestView
                        inputParams={inputParams}
                        optParams={promptOptParams}
                        variant={variant}
                        isChatVariant={!!isChatVariant}
                        compareMode={compareMode}
                        onStateChange={onStateChange}
                        setPromptOptParams={setPromptOptParams}
                        promptOptParams={promptOptParams}
                    />
                </Col>
            </Row>
        </Spin>
    )
}

export default ViewNavigation
