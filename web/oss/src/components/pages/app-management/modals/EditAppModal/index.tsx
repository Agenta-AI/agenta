import {useCallback, useEffect, useMemo, useState} from "react"

import {CheckOutlined} from "@ant-design/icons"
import {Input, Modal, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {createUseStyles} from "react-jss"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {GenericObject, JSSTheme} from "@/oss/lib/Types"
import {updateAppName} from "@/oss/services/app-selector/api"
import {useAppsData} from "@/oss/state/app"

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
    const [appNameInput, setAppNameInput] = useState(appDetails?.app_name || "")

    useEffect(() => {
        setAppNameInput(appDetails?.app_name)
    }, [appDetails])

    const appNameExist = useMemo(
        () =>
            apps.some(
                (app: GenericObject) =>
                    app.app_name.toLowerCase() === appNameInput?.toLowerCase() &&
                    app.app_name.toLowerCase() !== appDetails?.app_name.toLowerCase(),
            ),
        [apps, appNameInput, appDetails?.app_name],
    )

    const handleEditAppName = useCallback(async () => {
        try {
            await updateAppName(appDetails?.app_id, appNameInput)
            await mutate()
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
