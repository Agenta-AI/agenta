import {useCallback, useEffect, useMemo, useState} from "react"

import {invalidateWorkflowsListCache, updateWorkflow} from "@agenta/entities/workflow"
import {Input} from "@agenta/primitive-ui/components/input"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {CheckOutlined} from "@ant-design/icons"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {GenericObject} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"
import {getProjectValues} from "@/oss/state/project"

import {invalidateAppManagementWorkflowQueries} from "../../store"

import {closeEditAppModalAtom, editAppModalAtom} from "./store/editAppModalStore"

const EditAppModal = () => {
    const {open, appDetails, onRenamed} = useAtomValue(editAppModalAtom)
    const closeModal = useSetAtom(closeEditAppModalAtom)
    const {apps, isLoading, mutate} = useAppsData()
    const [appNameInput, setAppNameInput] = useState(appDetails?.name || "")

    useEffect(() => {
        setAppNameInput(appDetails?.name)
    }, [appDetails])

    const appNameExist = useMemo(
        () =>
            apps.some(
                (app: GenericObject) =>
                    ((app?.name ?? app?.slug) || "").toLowerCase() ===
                        appNameInput?.toLowerCase() &&
                    ((app?.name ?? app?.slug) || "").toLowerCase() !==
                        appDetails?.name.toLowerCase(),
            ),
        [apps, appNameInput, appDetails?.name],
    )

    const handleEditAppName = useCallback(async () => {
        try {
            const {projectId} = getProjectValues()
            await updateWorkflow(projectId, {
                id: appDetails?.id,
                name: appNameInput,
                flags: {is_application: true},
            })
            invalidateWorkflowsListCache()
            await mutate()
            await invalidateAppManagementWorkflowQueries()
            try {
                await onRenamed?.({id: appDetails?.id, name: appNameInput})
            } catch (callbackError) {
                console.error(callbackError)
            }
            closeModal()
        } catch (error) {
            console.error(error)
        }
    }, [appDetails, appNameInput, mutate, closeModal, onRenamed])

    return (
        <EnhancedModal
            centered
            destroyOnHidden
            okButtonProps={{
                icon: <CheckOutlined />,
                disabled: !appDetails || appNameExist || appNameInput?.length === 0,
                loading: isLoading,
            }}
            onOk={handleEditAppName}
            okText={"Confirm"}
            title={<span className="text-base leading-normal font-semibold">Rename App</span>}
            open={open}
            onCancel={closeModal}
        >
            <div className="mt-4 mb-6">
                <Input
                    value={appNameInput}
                    onChange={(e) => setAppNameInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleEditAppName()
                        }
                    }}
                />
                {appNameExist && (
                    <div className={clsx("text-red", "ml-2")}>App name already exists</div>
                )}
            </div>
        </EnhancedModal>
    )
}

export default EditAppModal
