import {useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {Modal} from "antd"
import {useSetAtom} from "jotai"

import {closeTraceDrawerAtom} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {deletePreviewTrace} from "@/oss/services/tracing/api"
import {useObservability} from "@/oss/state/newObservability"

type DeleteTraceModalProps = {
    setSelectedTraceId: (val: string) => void
    activeTraceId: string
} & React.ComponentProps<typeof Modal>

const DeleteTraceModal = ({setSelectedTraceId, activeTraceId, ...props}: DeleteTraceModalProps) => {
    const {fetchTraces, setSelectedTraceId: setGlobalSelectedTraceId} = useObservability()
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)
    const [isLoading, setIsLoading] = useState(false)

    const handleDelete = async () => {
        try {
            setIsLoading(true)
            await deletePreviewTrace(activeTraceId)
            await fetchTraces()
            // Clear both local (drawer) and global (observability) selections
            setSelectedTraceId("")
            setGlobalSelectedTraceId("")
            // Close modal and drawer on success to avoid dangling state
            props.onCancel?.({} as any)
            closeDrawer()
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }
    return (
        <Modal
            centered
            destroyOnHidden
            width={380}
            title={"Are you sure you want to delete?"}
            okButtonProps={{icon: <DeleteOutlined />, danger: true, loading: isLoading}}
            okText={"Delete"}
            onOk={handleDelete}
            {...props}
        >
            This action is not reversible.
        </Modal>
    )
}

export default DeleteTraceModal
