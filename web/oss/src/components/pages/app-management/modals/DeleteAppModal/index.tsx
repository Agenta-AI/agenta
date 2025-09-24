import {useCallback} from "react"

import {Modal} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {deleteApp} from "@/oss/services/app-selector/api"
import {useAppsData} from "@/oss/state/app"

import {
    closeDeleteAppModalAtom,
    deleteAppModalAtom,
    setDeleteAppModalLoadingAtom,
} from "./store/deleteAppModalStore"

const DeleteAppModal = (props = {}) => {
    const router = useRouter()
    const {open, appDetails, confirmLoading} = useAtomValue(deleteAppModalAtom)
    const closeModal = useSetAtom(closeDeleteAppModalAtom)
    const setLoading = useSetAtom(setDeleteAppModalLoadingAtom)
    const {mutate: mutateApps} = useAppsData()
    const {baseProjectURL} = useURL()

    const handleDeleteOk = useCallback(async () => {
        if (!appDetails) return

        setLoading(true)
        try {
            await deleteApp(appDetails.app_id)
            await mutateApps()
            closeModal()
            if (router.pathname.includes("/overview")) {
                await router.push(baseProjectURL)
            }
        } catch (error) {
            console.error("Failed to delete app:", error)
        } finally {
            setLoading(false)
        }
    }, [appDetails, setLoading, mutateApps, closeModal, router])

    return (
        <Modal
            title="Are you sure?"
            confirmLoading={confirmLoading}
            okText="Yes"
            okButtonProps={{disabled: !appDetails}}
            onCancel={closeModal}
            cancelText="No"
            onOk={handleDeleteOk}
            destroyOnHidden
            {...props}
            open={open}
        >
            <p>Are you sure you want to delete {appDetails?.app_name}?</p>
        </Modal>
    )
}

export default DeleteAppModal
