import {Modal, message, Card, Avatar} from "antd"
import {DeleteOutlined} from "@ant-design/icons"
import {removeApp} from "@/lib/services/api"
import useSWR, {mutate} from "swr"
import {useState} from "react"
import Link from "next/link"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {createUseStyles} from "react-jss"

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
    appName: string
    variantName: string
    key: number
    index: number
}> = ({appName, index}) => {
    const [visibleDelete, setVisibleDelete] = useState(false)
    const [confirmLoading, setConfirmLoading] = useState(false) // add this line
    const showDeleteModal = () => {
        setVisibleDelete(true)
    }

    const handleDeleteOk = async () => {
        setConfirmLoading(true)
        try {
            await removeApp(appName)
            // Refresh the data (if you're using SWR or a similar library)
            mutate(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/list_apps/`)
        } finally {
            setVisibleDelete(false)
            setConfirmLoading(false)
        }
    }
    const handleDeleteCancel = () => {
        setVisibleDelete(false)
    }
    const gradients = [
        "linear-gradient(to bottom right, #424242, #9F1239, #560BAD)",
        "linear-gradient(to bottom right, #C6F6D5, #34D399, #3B82F6)",
        "linear-gradient(to bottom right, #FEEBC8, #F59E0B, #9A3412)",
        "linear-gradient(to bottom right, #C6F6D5, #22D3EE, #7137F1)",
        "linear-gradient(to bottom right, #BFDBFE, #60A5FA, #3B82F6)",
        "linear-gradient(to bottom right, #8B5CF6, #FDE047)",
        "linear-gradient(to bottom right, #B91C1C, #D97706, #F59E0B)",
        "linear-gradient(to bottom right, #93C5FD, #C6F6D5, #FDE047)",
        "linear-gradient(to bottom right, #3B82F6, #1D4ED8, #111827)",
        "linear-gradient(to bottom right, #34D399, #A78BFA)",
        "linear-gradient(to bottom right, #FEEBC8, #F9A8D4, #F43F5E)",
        "linear-gradient(to bottom right, #10B981, #047857)",
        "linear-gradient(to bottom right, #F472B6, #D946EF, #4F46E5)",
        "linear-gradient(to bottom right, #60A5FA, #3B82F6)",
    ]

    const classes = useStyles()

    return (
        <>
            <Card
                className={classes.card}
                actions={[<DeleteOutlined key="delete" onClick={showDeleteModal} />]}
            >
                <Link data-cy="app-card-link" href={`/apps/${appName}/playground/${variantName}`}>
                    <Card.Meta
                        title={<div>{renameVariablesCapitalizeAll(appName)}</div>}
                        avatar={
                            <Avatar
                                size="large"
                                style={{backgroundImage: gradients[index % gradients.length]}}
                            >
                                {appName.charAt(0).toUpperCase()}
                            </Avatar>
                        }
                    />
                </Link>
            </Card>

            <DeleteModal
                open={visibleDelete}
                handleOk={handleDeleteOk}
                handleCancel={handleDeleteCancel}
                appName={appName}
                confirmLoading={confirmLoading}
            />
        </>
    )
}

export default AppCard
