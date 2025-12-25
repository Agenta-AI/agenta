import {Button, Divider, Drawer, Empty, Space, Typography} from "antd"
import dayjs from "dayjs"
import duration from "dayjs/plugin/duration"
import relativeTime from "dayjs/plugin/relativeTime"
import {createUseStyles} from "react-jss"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import ResultComponent from "@/oss/components/ResultComponent/ResultComponent"
import {IPromptRevisions} from "@/oss/lib/Types"
dayjs.extend(relativeTime)
dayjs.extend(duration)

const {Text} = Typography

interface StyleProps {
    themeMode: "dark" | "light"
}

interface PromptVersioningDrawerProps {
    historyStatus: {
        loading: boolean
        error: boolean
    }
    setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
    isDrawerOpen: boolean
    onStateChange: (isDirty: boolean) => void
    setRevisionNum: (val: string) => void
    promptRevisions: IPromptRevisions[] | undefined
}

const useStyles = createUseStyles({
    historyContainer: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexDirection: "column",
        padding: "10px 20px 20px",
        margin: "20px 0",
        borderRadius: 10,
        backgroundColor: themeMode === "dark" ? "#1f1f1f" : "#fff",
        color: themeMode === "dark" ? "#fff" : "#000",
        borderColor: themeMode === "dark" ? "#333" : "#eceff1",
        border: "1px solid",
        boxShadow: `0px 4px 8px ${
            themeMode === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
        }`,
    }),
    tagText: {
        color: "#656d76",
        fontSize: 12,
    },
    revisionText: {
        fontWeight: "bold",
    },
    emptyContainer: {
        marginTop: "4rem",
    },
    divider: {
        margin: "15px 0",
    },
})

const PromptVersioningDrawer: React.FC<PromptVersioningDrawerProps> = ({
    historyStatus,
    setIsDrawerOpen,
    isDrawerOpen,
    onStateChange,
    setRevisionNum,
    promptRevisions,
}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    return (
        <Drawer
            open={isDrawerOpen}
            title="History"
            size="default"
            destroyOnHidden
            onClose={() => setIsDrawerOpen(false)}
        >
            {historyStatus.loading ? (
                <div className={classes.emptyContainer}>
                    <ResultComponent title="" status={"info"} spinner={true} />
                </div>
            ) : historyStatus.error ? (
                <div className={classes.emptyContainer}>
                    <ResultComponent title="" subtitle="Failed to Load History." status={"error"} />
                </div>
            ) : (
                <>
                    {promptRevisions?.length ? (
                        promptRevisions
                            ?.map((item: IPromptRevisions) => (
                                <div key={item.revision} className={classes.historyContainer}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                        }}
                                    >
                                        <Text className={classes.revisionText}>
                                            {`# ${item.revision}`}
                                        </Text>

                                        <Text className={classes.tagText}>
                                            {dayjs(item.created_at).fromNow()}
                                        </Text>
                                    </div>

                                    <Divider className={classes.divider} />

                                    <Space style={{justifyContent: "space-between"}}>
                                        <Space orientation="vertical">
                                            <div>
                                                <Text strong>Config Name: </Text>
                                                <Text>{item.config.config_name}</Text>
                                            </div>
                                            <div>
                                                <Text strong>Modified By: </Text>
                                                <Text>{item.modified_by}</Text>
                                            </div>
                                        </Space>
                                        <Button
                                            type="primary"
                                            disabled={
                                                promptRevisions.length === 1 &&
                                                promptRevisions[0]?.revision === 1
                                            }
                                            onClick={() => {
                                                setRevisionNum(item.revision.toString())
                                                onStateChange(true)
                                                setIsDrawerOpen(false)
                                            }}
                                        >
                                            Restore
                                        </Button>
                                    </Space>
                                </div>
                            ))
                            .reverse()
                    ) : (
                        <Empty
                            className={classes.emptyContainer}
                            description="You have no saved changes"
                        />
                    )}
                </>
            )}
        </Drawer>
    )
}

export default PromptVersioningDrawer
