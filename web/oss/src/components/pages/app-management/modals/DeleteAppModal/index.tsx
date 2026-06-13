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
    const appCount = appDetails.length

    const handleDeleteOk = useCallback(async () => {
        if (!appCount) return

        setLoading(true)
        try {
            const {projectId} = getProjectValues()
            await Promise.all(
                appDetails.map((app) => workflowMolecule.lifecycle.archive(app.id, {projectId})),
            )
            await mutateApps?.()
            await invalidateAppManagementWorkflowQueries()
            await onArchived?.(appDetails)
            message.success(appCount === 1 ? "App archived" : `${appCount} apps archived`)
            closeModal()
            if (
                router.pathname.includes("/apps/[app_id]") &&
                appDetails.some((app) => app.id === router.query.app_id)
            ) {
                router.push(baseAppURL)
            }
        } catch (error) {
            console.error(error)
            message.error(appCount === 1 ? "Failed to archive app" : "Failed to archive apps")
        } finally {
            setLoading(false)
        }
    }, [appCount, appDetails, setLoading, mutateApps, onArchived, closeModal, router, baseAppURL])

    return (
        <Modal
            {...props}
            title={appCount === 1 ? "Archive app" : "Archive apps"}
            open={open}
            onOk={handleDeleteOk}
            onCancel={closeModal}
            cancelText="Cancel"
            centered
            okText={appCount === 1 ? "Archive app" : "Archive apps"}
            okButtonProps={{disabled: !appCount, danger: true}}
            confirmLoading={confirmLoading}
            destroyOnHidden
        >
            {appCount === 1 ? (
                <p>{appDetails[0]?.name} will move to archived apps.</p>
            ) : (
                <div className="flex flex-col gap-2">
                    <p className="m-0">The selected apps will move to archived apps:</p>
                    <ul className="m-0 pl-5">
                        {appDetails.map((app) => (
                            <li key={app.id}>{app.name}</li>
                        ))}
                    </ul>
                </div>
            )}
        </Modal>
    )
}

export default DeleteAppModal
