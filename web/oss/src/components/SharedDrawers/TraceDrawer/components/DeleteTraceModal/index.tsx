import {useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {Modal} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import Router from "next/router"

import {deletePreviewTrace} from "@/oss/services/tracing/api"
import {useObservability} from "@/oss/state/newObservability"
import {traceIdAtom} from "@/oss/state/url/trace"

import {closeTraceDrawerAtom} from "../../store/traceDrawerStore"

import {deleteTraceModalAtom} from "./store/atom"

const DeleteTraceModal = () => {
    const {fetchTraces, setSelectedTraceId: setGlobalSelectedTraceId, traces} = useObservability()
    const closeDrawer = useSetAtom(closeTraceDrawerAtom)
    const currentTraceId = useAtomValue(traceIdAtom)
    const [isLoading, setIsLoading] = useState(false)
    const [{isOpen, traceIds, onClose}, setModalState] = useAtom(deleteTraceModalAtom)

    const handleClose = () => {
        setModalState((prev) => ({...prev, isOpen: false}))
    }

    const handleDelete = async () => {
        try {
            setIsLoading(true)
            await Promise.all(traceIds.map((id) => deletePreviewTrace(id)))
            await fetchTraces()

            const isCurrentTraceDeleted = traceIds.includes(currentTraceId || "")

            if (isCurrentTraceDeleted && traceIds.length === 1) {
                const deletedIndex = traces.findIndex((t) => t.trace_id === traceIds[0])
                const nextTrace = traces[deletedIndex + 1] || traces[deletedIndex - 1]

                if (nextTrace) {
                    const url = new URL(window.location.href)
                    url.searchParams.set("trace", nextTrace.trace_id)
                    url.searchParams.delete("span")
                    await Router.push(url.toString(), undefined, {shallow: true})
                } else {
                    closeDrawer()
                }
            } else if (isCurrentTraceDeleted) {
                closeDrawer()
            }

            // Clear global (observability) selections
            setGlobalSelectedTraceId("")

            // Execute the callback passed via atom (e.g. refresh, clear selection)
            onClose?.()

            // Close modal
            handleClose()
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
            width={400}
            title={`Are you sure you want to delete ${
                traceIds.length > 1 ? ` ${traceIds.length} traces` : ""
            }?`}
            open={isOpen}
            onCancel={handleClose}
            okButtonProps={{icon: <DeleteOutlined />, danger: true, loading: isLoading}}
            okText={"Delete"}
            onOk={handleDelete}
        >
            This action is not reversible.
        </Modal>
    )
}

export default DeleteTraceModal
