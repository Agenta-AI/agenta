import React, {useEffect, useRef} from "react"
import {Col, Row, Divider, Button, Tooltip, Spin, notification, Result} from "antd"
import TestView from "./Views/TestView"
import ParametersView from "./Views/ParametersView"
import {useVariant} from "@/lib/hooks/useVariant"
import {Environment, Variant} from "@/lib/Types"
import {useRouter} from "next/router"
import {useState} from "react"
import axios from "axios"
import {createUseStyles} from "react-jss"
import {
    getAppContainerURL,
    removeVariant,
    restartAppVariantContainer,
    waitForAppToStart,
} from "@/lib/services/api"
import {useAppsData} from "@/contexts/app.context"
import {isDemo} from "@/lib/helpers/utils"

interface Props {
    variant: Variant
    handlePersistVariant: (variantName: string) => void
    environments: Environment[]
    onAdd: () => void
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
})

const ViewNavigation: React.FC<Props> = ({
    variant,
    handlePersistVariant,
    environments,
    onAdd,
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
        optParams,
        refetch,
        isError,
        error,
        isParamSaveLoading,
        saveOptParams,
        isLoading,
        isChatVariant,
    } = useVariant(appId, variant)
    const [retrying, setRetrying] = useState(false)
    const [isParamsCollapsed, setIsParamsCollapsed] = useState("1")
    const [containerURI, setContainerURI] = useState("")
    const [restarting, setRestarting] = useState<boolean>(false)
    const {currentApp} = useAppsData()
    const retriedOnce = useRef(false)
    const netWorkError = (error as any)?.code === "ERR_NETWORK"

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
    }, [netWorkError])

    if (retrying || (!retriedOnce.current && netWorkError)) {
        return (
            <Result
                status="info"
                title="Waiting for the variant to start"
                extra={<Spin spinning={retrying} />}
            />
        )
    }

    if (isError) {
        let variantDesignator = variant.templateVariantName
        let appName = currentApp?.app_name || ""
        let imageName = `agentaai/${(appName).toLowerCase()}_`

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
        const containerName = `${appName}-${variant.baseName}-${containerURI.split("/")[3]}` // [3] is the user organization id
        return (
            <div>
                {error ? (
                    <div>
                        <p>
                            Error connecting to the variant {variant.variantName}.{" "}
                            {(axios.isAxiosError(error) && error.response?.status === 404 && (
                                <span>Container is not running.</span>
                            )) || <span>{error.message}</span>}
                        </p>
                        <p>To debug this issue, please follow the steps below:</p>
                        <ul>
                            <li>
                                Verify whether the API is up by checking if {apiAddress} is
                                accessible.
                            </li>
                            <li>
                                Check if the Docker container for the variant {variantDesignator} is active by running the following command in your terminal: 
                                <pre>docker logs {containerName} --tail 50 -f</pre>
                                Running the above command will enable you to continuously stream the container logs in real-time as they are generated.
                            </li>
                        </ul>
                        <p>
                            {" "}
                            In case the docker container is not running, please check the Docker logs to understand the issue. 
                            Most of the time, it is due to missing requirements. 
                            Also, please attempt restarting it (using cli or docker
                            desktop).
                        </p>
                        <p>
                            {" "}
                            If the issue persists please file an issue in github here:
                            https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20ViewNavigation.tsx
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
                        optParams={optParams}
                        isParamSaveLoading={isParamSaveLoading}
                        onOptParamsChange={saveOptParams}
                        handlePersistVariant={handlePersistVariant}
                        isPersistent={variant.persistent} // if the variant persists in the backend, then saveoptparams will need to know to update and not save new variant
                        deleteVariant={deleteVariant}
                        isParamsCollapsed={isParamsCollapsed}
                        setIsParamsCollapsed={setIsParamsCollapsed}
                        environments={environments}
                        onAdd={onAdd}
                        getHelpers={getHelpers}
                        onStateChange={onStateChange}
                        tabID={tabID}
                    />
                </Col>
            </Row>
            <Divider />

            <Row gutter={[{xs: 8, sm: 16, md: 24, lg: 32}, 20]} className={classes.row}>
                <Col span={24}>
                    <TestView
                        inputParams={inputParams}
                        optParams={optParams}
                        variant={variant}
                        isChatVariant={!!isChatVariant}
                    />
                </Col>
            </Row>
        </Spin>
    )
}

export default ViewNavigation
