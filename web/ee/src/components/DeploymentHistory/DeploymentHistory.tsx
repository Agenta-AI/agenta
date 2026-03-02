import {useCallback, useEffect, useRef, useState} from "react"

import {DeploymentRevisionConfig, DeploymentRevisions} from "@agenta/oss/src/lib/types_ee"
import {Button, Card, Divider, Space, Typography, notification} from "antd"
import dayjs from "dayjs"
import duration from "dayjs/plugin/duration"
import relativeTime from "dayjs/plugin/relativeTime"
import debounce from "lodash/debounce"
import {createUseStyles} from "react-jss"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import {Environment, JSSTheme} from "@/oss/lib/Types"
import {
    createRevertDeploymentRevision,
    fetchAllDeploymentRevisions,
} from "@/oss/services/deploymentVersioning/api"

dayjs.extend(relativeTime)
dayjs.extend(duration)

interface DeploymentHistoryProps {
    selectedEnvironment: Environment
}

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        gap: 20,
    },
    historyItemsContainer: {
        flex: 0.2,
        backgroundColor: theme.isDark ? "#333" : "#FFFFFF",
        border: theme.isDark ? "" : "1px solid #f0f0f0",
        overflowY: "scroll",
        padding: 10,
        borderRadius: 10,
        minWidth: 300,
        height: "600px",
    },
    historyItems: {
        display: "flex",
        flexDirection: "column",
        padding: "10px 20px",
        margin: "20px 0",
        borderRadius: 10,
        cursor: "pointer",
    },
    promptHistoryCard: {
        margin: "30px",
    },
    promptHistoryInfo: {
        flex: 0.8,
        backgroundColor: theme.isDark ? "#333" : "#FFFFFF",
        border: theme.isDark ? "" : "1px solid #f0f0f0",
        padding: 20,
        borderRadius: 10,
    },
    promptHistoryInfoHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1": {
            fontSize: 32,
        },
    },
    emptyContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "30px auto",
        fontSize: 20,
        fontWeight: "bold",
    },
    divider: {
        margin: "10px 0",
    },
    historyItemsTitle: {
        fontSize: 14,
        "& span": {
            color: theme.isDark ? "#f1f5f8" : "#656d76",
        },
    },
    noParams: {
        color: theme.colorTextDescription,
        textAlign: "center",
        marginTop: theme.marginLG,
    },
    loadingContainer: {
        display: "grid",
        placeItems: "center",
        height: "100%",
    },
}))

const DeploymentHistory: React.FC<DeploymentHistoryProps> = ({selectedEnvironment}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const [activeItem, setActiveItem] = useState(0)
    const [isLoading, setIsLoading] = useState(false)
    const [isReverting, setIsReverted] = useState(false)
    const [showDeployment, setShowDeployment] = useState<DeploymentRevisionConfig>()
    const [deploymentRevisionId, setDeploymentRevisionId] = useState("")
    const [deploymentRevisions, setDeploymentRevisions] = useState<DeploymentRevisions>()
    const [showDeploymentLoading, setShowDeploymentLoading] = useState(false)
    const {current} = useRef<{id: string; revision: string | undefined}>({
        id: "",
        revision: "",
    })

    useEffect(() => {
        current.revision = deploymentRevisions?.revisions[activeItem].deployed_app_variant_revision
    }, [activeItem])

    const fetchData = async () => {
        setIsLoading(true)
        try {
            const data = await fetchAllDeploymentRevisions(
                selectedEnvironment?.app_id,
                selectedEnvironment?.name,
            )
            setDeploymentRevisions(data)
            current.id = data.deployed_app_variant_revision_id || ""
        } catch (error) {
            setIsLoading(false)
        } finally {
            setIsLoading(false)
        }
    }

    const handleRevert = useCallback(async (deploymentRevisionId: string) => {
        setIsReverted(true)
        try {
            const response = await createRevertDeploymentRevision(deploymentRevisionId)
            notification.success({
                message: "Environment Revision",
                description: response?.data,
                duration: 3,
            })
            await fetchData()
        } catch (err) {
            console.error(err)
        } finally {
            setIsReverted(false)
        }
    }, [])

    useEffect(() => {
        fetchData()
    }, [selectedEnvironment.app_id, selectedEnvironment.name])

    useEffect(() => {
        const fetch = async () => {
            try {
                setShowDeploymentLoading(true)
                if (deploymentRevisions && deploymentRevisions.revisions.length) {
                    setActiveItem(deploymentRevisions.revisions.length - 1)

                    const mod = await import("@/oss/services/deploymentVersioning/api")
                    const fetchAllDeploymentRevisionConfig = mod?.fetchAllDeploymentRevisionConfig
                    if (!mod || !fetchAllDeploymentRevisionConfig) return

                    const revisionConfig = await fetchAllDeploymentRevisionConfig(
                        deploymentRevisions.revisions[deploymentRevisions.revisions.length - 1].id,
                    )
                    setShowDeployment(revisionConfig)
                }
            } catch (error) {
                console.error(error)
            } finally {
                setShowDeploymentLoading(false)
            }
        }

        fetch()
    }, [deploymentRevisions])

    const handleShowDeployments = async (revision: number, index: number) => {
        const findRevision = deploymentRevisions?.revisions.find(
            (deploymentRevision) => deploymentRevision.revision === revision,
        )

        if (!findRevision) return

        setActiveItem(index)
        setDeploymentRevisionId(findRevision.id)

        try {
            setShowDeploymentLoading(true)
            const mod = await import("@/oss/services/deploymentVersioning/api")
            const fetchAllDeploymentRevisionConfig = mod?.fetchAllDeploymentRevisionConfig
            if (!mod || !fetchAllDeploymentRevisionConfig) return

            const revisionConfig = await fetchAllDeploymentRevisionConfig(findRevision.id)

            setShowDeployment(revisionConfig)
        } catch (error) {
            console.error(error)
        } finally {
            setShowDeploymentLoading(false)
        }
    }

    const debouncedHandleShowDeployments = debounce(handleShowDeployments, 300)

    return (
        <>
            {isLoading ? (
                <ResultComponent status="info" title="Loading..." spinner={true} />
            ) : deploymentRevisions?.revisions?.length ? (
                <div className={classes.container}>
                    <div className={classes.historyItemsContainer}>
                        {deploymentRevisions?.revisions
                            ?.map((item, index) => (
                                <div
                                    key={item.revision}
                                    style={{
                                        backgroundColor:
                                            activeItem === index
                                                ? appTheme === "dark"
                                                    ? "#4AA081"
                                                    : "#F3F8F6"
                                                : appTheme === "dark"
                                                  ? "#1f1f1f"
                                                  : "#fff",
                                        border:
                                            activeItem === index
                                                ? "1px solid #4aa081"
                                                : `1px solid ${
                                                      appTheme === "dark"
                                                          ? "transparent"
                                                          : "#f0f0f0"
                                                  }`,
                                    }}
                                    className={classes.historyItems}
                                    onClick={() =>
                                        debouncedHandleShowDeployments(item.revision, index)
                                    }
                                >
                                    <Space style={{justifyContent: "space-between"}}>
                                        <Text className={classes.historyItemsTitle}>
                                            <b>Revision</b> <span>v{index + 1}</span>
                                        </Text>
                                        <Text className={classes.historyItemsTitle}>
                                            <span style={{fontSize: 12}}>
                                                {dayjs(item.created_at).fromNow()}
                                            </span>
                                        </Text>
                                    </Space>

                                    {deploymentRevisions.deployed_app_variant_revision_id ===
                                        item.deployed_app_variant_revision && (
                                        <Text
                                            style={{
                                                fontStyle: "italic",
                                                fontSize: 12,
                                                color: appTheme === "dark" ? "#fff" : "#4AA081",
                                            }}
                                        >
                                            In production...
                                        </Text>
                                    )}

                                    <Divider className={classes.divider} />

                                    <Space orientation="vertical">
                                        <div>
                                            <Text strong>Modified By: </Text>
                                            <Text>{item.modified_by}</Text>
                                        </div>
                                    </Space>
                                </div>
                            ))
                            .reverse()}
                    </div>

                    <div className={classes.promptHistoryInfo}>
                        <div className={classes.promptHistoryInfoHeader}>
                            <h1>Information</h1>

                            {deploymentRevisions.revisions.length > 1 && (
                                <Button
                                    type="primary"
                                    loading={isReverting}
                                    onClick={() => handleRevert(deploymentRevisionId)}
                                    disabled={current.id === current.revision}
                                >
                                    Revert
                                </Button>
                            )}
                        </div>

                        {showDeploymentLoading ? (
                            <div className={classes.loadingContainer}>
                                <ResultComponent spinner={true} title="" status={"info"} />
                            </div>
                        ) : (
                            <>
                                {showDeployment?.parameters &&
                                Object.keys(showDeployment?.parameters).length ? (
                                    <Card
                                        title="Model Parameters"
                                        className={classes.promptHistoryCard}
                                    >
                                        <Space orientation="vertical">
                                            <>
                                                {Object.entries(showDeployment.parameters).map(
                                                    ([key, value], index) => {
                                                        return (
                                                            <>
                                                                <div key={index}>
                                                                    <Typography.Text
                                                                        style={{fontWeight: "bold"}}
                                                                    >
                                                                        {key}:{" "}
                                                                    </Typography.Text>
                                                                    {Array.isArray(value)
                                                                        ? JSON.stringify(value)
                                                                        : typeof value === "boolean"
                                                                          ? `${value}`
                                                                          : value}
                                                                </div>
                                                            </>
                                                        )
                                                    },
                                                )}
                                            </>
                                        </Space>
                                    </Card>
                                ) : (
                                    <div className={classes.noParams}>No parameters to display</div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            ) : (
                <div className={classes.emptyContainer}>You have no saved prompts</div>
            )}
        </>
    )
}

export default DeploymentHistory
