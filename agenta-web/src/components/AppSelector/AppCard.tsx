import {Modal, Card, Dropdown, Button, Typography, Tag} from "antd"
import {MoreOutlined} from "@ant-design/icons"
import {deleteApp} from "@/services/app-selector/api"
import {useState} from "react"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {createUseStyles} from "react-jss"
import {JSSTheme, ListAppsItem} from "@/lib/Types"
import {useAppsData} from "@/contexts/app.context"
import {Note, PencilLine, Trash} from "@phosphor-icons/react"
import {useRouter} from "next/router"
import {formatDay} from "@/lib/helpers/dateTimeHelper"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        width: 300,
        display: "flex",
        flexDirection: "column",
        transition: "all 0.025s ease-in",
        cursor: "pointer",
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,

            "& .ant-card-head-title": {
                fontSize: theme.fontSizeLG,
                fontWeight: 500,
            },
        },
        "& > .ant-card-body": {
            padding: theme.paddingSM,
        },
        "&:hover": {
            boxShadow: theme.boxShadow,
        },
    },
    app_card_link: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        "& > div": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            textDecoration: "none",
            color: theme.colorText,
        },
    },
}))

const DeleteModal: React.FC<{
    open: boolean
    handleOk: () => Promise<void>
    handleCancel: () => void
    appName: string
    confirmLoading: boolean
}> = ({open, handleOk, handleCancel, appName, confirmLoading}) => {
    return (
        <Modal
            title="Are you sure?"
            open={open}
            onOk={handleOk}
            confirmLoading={confirmLoading} // add this line
            onCancel={handleCancel}
            okText="Yes"
            cancelText="No"
        >
            <p>Are you sure you want to delete {appName}?</p>
        </Modal>
    )
}

const AppCard: React.FC<{
    app: ListAppsItem
}> = ({app}) => {
    const [visibleDelete, setVisibleDelete] = useState(false)
    const [confirmLoading, setConfirmLoading] = useState(false)
    const {mutate} = useAppsData()
    const router = useRouter()

    const handleDeleteOk = async () => {
        setConfirmLoading(true)
        try {
            await deleteApp(app.app_id)
            mutate()
        } catch (error) {
            console.error(error)
        } finally {
            // remove variant tabs position index from LS
            localStorage.removeItem(`tabIndex_${app.app_id}`)
            setVisibleDelete(false)
            setConfirmLoading(false)
        }
    }
    const handleDeleteCancel = () => {
        setVisibleDelete(false)
    }

    const classes = useStyles()

    return (
        <>
            <Card
                className={classes.card}
                title={renameVariablesCapitalizeAll(app.app_name)}
                onClick={() => router.push(`/apps/${app.app_id}/overview`)}
                extra={
                    <Dropdown
                        trigger={["hover"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "open_app",
                                    label: "Open",
                                    icon: <Note size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`/apps/${app.app_id}/overview`)
                                    },
                                },
                                {type: "divider"},
                                // {
                                //     key: "rename_app",
                                //     label: "Rename",
                                //     icon: <PencilLine size={16} />,
                                //     onClick: (e: any) => {
                                //         e.domEvent.stopPropagation()
                                //     },
                                // },
                                {
                                    key: "delete_app",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        setVisibleDelete(true)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            onClick={(e) => e.stopPropagation()}
                            icon={<MoreOutlined />}
                            size="small"
                        />
                    </Dropdown>
                }
            >
                <div data-cy="app-card-link" className={classes.app_card_link}>
                    <div>
                        <Text>Type</Text>
                        <Tag className="mr-0">Single Prompt</Tag>
                    </div>
                    <div>
                        <Text>Last modified:</Text>
                        <Text>{formatDay("2024-08-05T22:32:19.593503Z")}</Text>
                    </div>
                </div>
            </Card>

            <DeleteModal
                open={visibleDelete}
                handleOk={handleDeleteOk}
                handleCancel={handleDeleteCancel}
                appName={app.app_name}
                confirmLoading={confirmLoading}
            />
        </>
    )
}

export default AppCard
