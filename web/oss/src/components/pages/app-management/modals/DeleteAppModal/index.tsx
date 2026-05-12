import {useCallback} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {Modal} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {useAppsData} from "@/oss/state/app"
import {getProjectValues} from "@/oss/state/project"

import {invalidateAppManagementWorkflowQueries} from "../../store"

import {
    closeDeleteAppModalAtom,
    deleteAppModalAtom,
    setDeleteAppModalLoadingAtom,
} from "./store/deleteAppModalStore"

const DeleteAppModal = (props = {}) => {
    const router = useRouter()
    const {open, appDetails, confirmLoading, onArchived} = useAtomValue(deleteAppModalAtom)
    const closeModal = useSetAtom(closeDeleteAppModalAtom)
    const setLoading = useSetAtom(setDeleteAppModalLoadingAtom)
    const {mutate: mutateApps} = useAppsData()
    const {baseAppURL} = useURL()

    const handleDeleteOk = useCallback(async () => {
        if (!appDetails) return

        setLoading(true)
        try {
            const {projectId} = getProjectValues()
            await workflowMolecule.lifecycle.archive(appDetails.id, {projectId})
            await mutateApps?.()
            await invalidateAppManagementWorkflowQueries()
            await onArchived?.(appDetails)
            message.success("App archived")
            closeModal()
            if (router.pathname.includes("/apps/")) {
                await router.push(baseAppURL)
            }
        } catch (error) {
            console.error("Failed to archive app:", error)
        } finally {
            setLoading(false)
        }
    }, [appDetails, setLoading, mutateApps, onArchived, closeModal, router, baseAppURL])

    return (
        <Modal
            title="Archive prompt?"
            confirmLoading={confirmLoading}
            okText="Archive"
            okButtonProps={{disabled: !appDetails}}
            onCancel={closeModal}
            cancelText="Cancel"
            onOk={handleDeleteOk}
            destroyOnHidden
            centered
            {...props}
            open={open}
        >
            <p>{appDetails?.name} will move to archived prompts.</p>
        </Modal>
    )
}

export default DeleteAppModal
