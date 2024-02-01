import {Button, Card, Divider, Result, Space, Typography} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {LoadingOutlined} from "@ant-design/icons"
import {promptVersioning} from "@/lib/services/api"
import {IPromptRevisions, IPromptVersioning, Variant} from "@/lib/Types"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import duration from "dayjs/plugin/duration"
dayjs.extend(relativeTime)
dayjs.extend(duration)

type StyleProps = {
    themeMode: "dark" | "light"
}

type DeploymentHistoryProps = {
    variant: Variant
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

const DeploymentHistory: React.FC<DeploymentHistoryProps> = ({variant}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [deploymentRevisions, setDeploymentRevisions] = useState<IPromptVersioning>()
    const [isLoading, setIsLoading] = useState(false)
    const [filtered, setFiltered] = useState<IPromptRevisions[]>()

    const [showDeployments, setShowDeployments] = useState<IPromptRevisions>()
    const [activeItem, setActiveItem] = useState(0)

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true)
            try {
                const data = await promptVersioning(variant.variantId)
                setDeploymentRevisions(data)

                setFiltered(
                    data?.revisions.filter(
                        (item: IPromptRevisions) =>
                            Object.keys(item.config.parameters).length !== 0,
                    ),
                )
            } catch (error) {
                setIsLoading(false)
                console.log(error)
            } finally {
                setIsLoading(false)
            }
        }

        fetchData()
    }, [variant.variantId])

    useEffect(() => {
        if (filtered && filtered.length) {
            setShowDeployments(filtered[0])
        }
    }, [filtered])

    const handleShowDeployments = (id: number, index: number) => {
        setActiveItem(index)
        const findPrompt = deploymentRevisions?.revisions.find((prompt) => prompt.revision === id)

        setShowDeployments(findPrompt)
    }

    const handleRevert = (id: number) => {}

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
                                        <Text strong>Config Name: </Text>
                                        <Text>{item.config.config_name}</Text>
                                    </div>
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
                                onClick={() => handleRevert(showDeployments?.revision!)}
                            >
                                Revert
                            </Button>
                        </div>

                        <div>{dayjs(showDeployments?.created_at).format("DD-MM-YYYY mm:ss")}</div>

                        <Card title="Prompt System" className={classes.promptHistoryCard}>
                            <div>{showDeployments?.config.parameters?.prompt_system}</div>
                        </Card>

                        <Card title="Model Parameters" className={classes.promptHistoryCard}>
                            <Space direction="vertical">
                                {showDeployments?.config.parameters?.temperature && (
                                    <Typography.Text>
                                        Temperature:{" "}
                                        {showDeployments?.config.parameters?.temperature}
                                    </Typography.Text>
                                )}

                                {showDeployments?.config.parameters?.model && (
                                    <Typography.Text>
                                        Model: {showDeployments?.config.parameters?.model}
                                    </Typography.Text>
                                )}

                                {showDeployments?.config.parameters?.max_tokens && (
                                    <Typography.Text>
                                        Max tokens: {showDeployments?.config.parameters?.max_tokens}
                                    </Typography.Text>
                                )}

                                {showDeployments?.config.parameters?.top_p && (
                                    <Typography.Text>
                                        Top p: {showDeployments?.config.parameters?.top_p}
                                    </Typography.Text>
                                )}

                                {showDeployments?.config.parameters?.frequence_penalty ||
                                showDeployments?.config.parameters?.frequence_penalty == 0 ? (
                                    <Typography.Text>
                                        Frequence penalty:{" "}
                                        {showDeployments?.config.parameters?.frequence_penalty}
                                    </Typography.Text>
                                ) : (
                                    ""
                                )}

                                {showDeployments?.config.parameters?.presence_penalty ||
                                showDeployments?.config.parameters?.presence_penalty == 0 ? (
                                    <Typography.Text>
                                        Presence penalty:{" "}
                                        {showDeployments?.config.parameters?.presence_penalty}
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
