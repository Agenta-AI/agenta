import {Button, Card, Divider, Result, Space, Typography, notification} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {LoadingOutlined} from "@ant-design/icons"
import {
    fetchDeploymentRevisions,
    fetchDeploymentRevisionConfig,
    revertDeploymentRevision,
} from "@/lib/services/api"
import {
    IPromptRevisions,
    DeploymentRevisions,
    DeploymentRevisionConfig,
    IEnvironmentRevision,
    Environment,
} from "@/lib/Types"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import duration from "dayjs/plugin/duration"

dayjs.extend(relativeTime)
dayjs.extend(duration)

type StyleProps = {
    themeMode: "dark" | "light"
}

type DeploymentHistoryProps = {
    selectedEnvironment: Environment
}

const {Text} = Typography

const useStyles = createUseStyles({
    container: {
        display: "flex",
        gap: 20,
    },
    historyItemsContainer: ({themeMode}: StyleProps) => ({
        flex: 0.2,
        backgroundColor: themeMode === "dark" ? "#333" : "#eceff1",
        overflowY: "scroll",
        padding: 10,
        borderRadius: 10,
        minWidth: 300,
        height: "600px",
    }),
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
    promptHistoryInfo: ({themeMode}: StyleProps) => ({
        flex: 0.8,
        backgroundColor: themeMode === "dark" ? "#333" : "#eceff1",
        padding: 20,
        borderRadius: 10,
    }),
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
    historyItemsTitle: ({themeMode}: StyleProps) => ({
        fontSize: 14,
        "& span": {
            color: themeMode === "dark" ? "#f1f5f8" : "#656d76",
        },
    }),
})

const DeploymentHistory: React.FC<DeploymentHistoryProps> = ({selectedEnvironment}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)

    const [activeItem, setActiveItem] = useState(0)
    const [isLoading, setIsLoading] = useState(false)
    const [isReverting, setIsReverted] = useState(false)
    const [filtered, setFiltered] = useState<IEnvironmentRevision[]>()
    const [showDeployment, setShowDeployment] = useState<DeploymentRevisionConfig>()
    const [deploymentRevisionId, setDeploymentRevisionId] = useState<string>("")
    const [deploymentRevisions, setDeploymentRevisions] = useState<DeploymentRevisions>()

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true)
            try {
                const data = await fetchDeploymentRevisions(
                    selectedEnvironment?.app_id,
                    selectedEnvironment?.name,
                )
                setDeploymentRevisions(data)
                setFiltered(
                    data?.revisions.filter((item: IEnvironmentRevision) => item.revision >= 1),
                )
            } catch (error) {
                setIsLoading(false)
            } finally {
                setIsLoading(false)
            }
        }

        fetchData()
    }, [selectedEnvironment.app_id, selectedEnvironment.name])

    useEffect(() => {
        if (filtered && filtered.length) {
            setShowDeployment(filtered[0])
        }
    }, [filtered])

    const handleShowDeployments = async (id: number, index: number) => {
        setActiveItem(index)
        const findRevision = deploymentRevisions?.revisions.find(
            (deploymentRevision) => deploymentRevision.revision === id,
        )
        setDeploymentRevisionId(findRevision.id)

        const revisionConfig = await fetchDeploymentRevisionConfig(findRevision.id)
        setShowDeployment(revisionConfig)
    }

    const handleRevert = async (deploymentRevisionId: string) => {
        setIsReverted(true)
        try {
            const response = await revertDeploymentRevision(deploymentRevisionId)
            if (response.status && response.status == 200) {
                notification.success({
                    message: "Environment Revision",
                    description: response?.data,
                    duration: 3,
                })
                setIsReverted(false)
            }
        } catch (err) {
            setIsReverted(false)
        }
    }

    return (
        <>
            {isLoading ? (
                <Result icon={<LoadingOutlined />} subTitle="Loading..." />
            ) : !!filtered?.length ? (
                <div className={classes.container}>
                    <div className={classes.historyItemsContainer}>
                        {filtered?.map((item, index) => (
                            <div
                                key={item.revision}
                                style={{
                                    backgroundColor:
                                        activeItem === index
                                            ? appTheme === "dark"
                                                ? "#1668dc"
                                                : "#b3e5fc"
                                            : appTheme === "dark"
                                            ? "#1f1f1f"
                                            : "#fff",
                                    border:
                                        activeItem === index
                                            ? "1px solid #2196f3"
                                            : "1px solid transparent",
                                }}
                                className={classes.historyItems}
                                onClick={() => handleShowDeployments(item.revision, index)}
                            >
                                <Space style={{justifyContent: "space-between"}}>
                                    <Text className={classes.historyItemsTitle}>
                                        <b>Revision</b> <span>#{item.revision}</span>
                                    </Text>
                                    <Text className={classes.historyItemsTitle}>
                                        <span style={{fontSize: 12}}>
                                            {dayjs(item.created_at).fromNow()}
                                        </span>
                                    </Text>
                                </Space>

                                <Divider className={classes.divider} />

                                <Space direction="vertical">
                                    <div>
                                        <Text strong>Modified By: </Text>
                                        <Text>{item.modified_by}</Text>
                                    </div>
                                </Space>
                            </div>
                        ))}
                    </div>

                    <div className={classes.promptHistoryInfo}>
                        <div className={classes.promptHistoryInfoHeader}>
                            <h1>Information</h1>

                            <Button
                                type="primary"
                                loading={isReverting}
                                onClick={() => handleRevert(deploymentRevisionId)}
                            >
                                Revert
                            </Button>
                        </div>

                        <div>{dayjs(showDeployment?.created_at).format("DD-MM-YYYY mm:ss")}</div>

                        <Card title="Prompt System" className={classes.promptHistoryCard}>
                            <div>{showDeployment?.parameters?.prompt_system}</div>
                        </Card>

                        <Card title="Model Parameters" className={classes.promptHistoryCard}>
                            <Space direction="vertical">
                                {showDeployment?.parameters?.temperature && (
                                    <Typography.Text>
                                        Temperature: {showDeployment?.parameters?.temperature}
                                    </Typography.Text>
                                )}

                                {showDeployment?.parameters?.model && (
                                    <Typography.Text>
                                        Model: {showDeployment?.parameters?.model}
                                    </Typography.Text>
                                )}

                                {showDeployment?.parameters?.max_tokens && (
                                    <Typography.Text>
                                        Max tokens: {showDeployment?.parameters?.max_tokens}
                                    </Typography.Text>
                                )}

                                {showDeployment?.parameters?.top_p && (
                                    <Typography.Text>
                                        Top p: {showDeployment?.parameters?.top_p}
                                    </Typography.Text>
                                )}

                                {showDeployment?.parameters?.frequence_penalty ||
                                showDeployment?.parameters?.frequence_penalty == 0 ? (
                                    <Typography.Text>
                                        Frequence penalty:{" "}
                                        {showDeployment?.parameters?.frequence_penalty}
                                    </Typography.Text>
                                ) : (
                                    ""
                                )}

                                {showDeployment?.parameters?.presence_penalty ||
                                showDeployment?.parameters?.presence_penalty == 0 ? (
                                    <Typography.Text>
                                        Presence penalty:{" "}
                                        {showDeployment?.parameters?.presence_penalty}
                                    </Typography.Text>
                                ) : (
                                    ""
                                )}
                            </Space>
                        </Card>
                    </div>
                </div>
            ) : (
                <div className={classes.emptyContainer}>You have no saved prompts</div>
            )}
        </>
    )
}

export default DeploymentHistory
