import {Modal, Card, Avatar} from "antd"
import {DeleteOutlined} from "@ant-design/icons"
import {removeApp} from "@/lib/services/api"
import {useState} from "react"
import Link from "next/link"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {createUseStyles} from "react-jss"
import {getGradientFromStr} from "@/lib/helpers/colors"
import {ListAppsItem} from "@/lib/Types"
import {useProfileData, Role} from "@/contexts/profile.context"
import {useAppsData} from "@/contexts/app.context"

const useStyles = createUseStyles({
    card: {
        width: 300,
        height: 120,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        "& svg": {
            color: "red",
        },
        "& .ant-card-meta": {
            height: "90%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        "& .ant-card-meta-title div": {
            textAlign: "center",
        },
    },
    cardCover: {
        "z-index": 1,
        position: "absolute",
        top: 0,
        right: 0,
        left: 0,
        background: "transparent",
        margin: "auto",
        width: "300px",
        height: "70px",
        display: "flex",
        overflow: "hidden",
        "flex-direction": "column",
        "justify-content": "space-between",
    },
    cardLink: {
        padding: "24px",
    },
})

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
    const {role} = useProfileData()
    const isOwner = role === Role.OWNER
    const {mutate} = useAppsData()

    const showDeleteModal = () => {
        setVisibleDelete(true)
    }

    const handleDeleteOk = async () => {
        setConfirmLoading(true)
        try {
            await removeApp(app.app_id)
            mutate()
        } catch (error) {
            console.error(error)
        } finally {
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
                actions={
                    isOwner
                        ? [<DeleteOutlined key="delete" onClick={showDeleteModal} />]
                        : undefined
                }
            >
                <Link data-cy="app-card-link" href={`/apps/${app.app_id}/playground`}>
                    <Card.Meta
                        title={<div>{renameVariablesCapitalizeAll(app.app_name)}</div>}
                        avatar={
                            <Avatar
                                size="large"
                                style={{backgroundImage: getGradientFromStr(app.app_id)}}
                            >
                                {app.app_name.charAt(0).toUpperCase()}
                            </Avatar>
                        }
                    />
                </Link>
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
