import {useCallback, useEffect, useMemo, useState} from "react"

import {invalidateWorkflowsListCache, updateWorkflow} from "@agenta/entities/workflow"
import {CheckOutlined} from "@ant-design/icons"
import {Input, Modal, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {createUseStyles} from "react-jss"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {GenericObject, JSSTheme} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"
import {getProjectValues} from "@/oss/state/project"

import {invalidateAppManagementWorkflowQueries} from "../../store"

import {closeEditAppModalAtom, editAppModalAtom} from "./store/editAppModalStore"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightStrong,
    },
}))

const EditAppModal = () => {
    const {open, appDetails} = useAtomValue(editAppModalAtom)
    const closeModal = useSetAtom(closeEditAppModalAtom)
    const classes = useStyles()
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
            closeModal()
        } catch (error) {
            console.error(error)
        }
    }, [appDetails, appNameInput, mutate, closeModal])

    return (
        <Modal
            centered
            destroyOnHidden
            okButtonProps={{
                icon: <CheckOutlined />,
                disabled: !appDetails || appNameExist || appNameInput?.length === 0,
                loading: isLoading,
            }}
            onOk={handleEditAppName}
            okText={"Confirm"}
            title={<Typography.Text className={classes.title}>Rename App</Typography.Text>}
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
                {appNameInput?.length > 0 && !isAppNameInputValid(appNameInput) && (
                    <div className={clsx("text-red", "ml-2")}>
                        App name must contain only letters, numbers, underscore, or dash
                    </div>
                )}
            </div>
        </Modal>
    )
}

export default EditAppModal
