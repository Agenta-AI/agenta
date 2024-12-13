import {useAppsData} from "@/contexts/app.context"
import {isAppNameInputValid} from "@/lib/helpers/utils"
import {GenericObject, JSSTheme, ListAppsItem} from "@/lib/Types"
import {updateAppName} from "@/services/app-selector/api"
import {CheckOutlined} from "@ant-design/icons"
import {Input, Modal, Typography} from "antd"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import {useUpdateEffect} from "usehooks-ts"

type EditAppModalProps = {
    appDetails: ListAppsItem
} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightStrong,
    },
    modalError: {
        color: "red",
        marginLeft: theme.marginXS,
    },
}))

const EditAppModal = ({appDetails, ...props}: EditAppModalProps) => {
    const classes = useStyles()
    const {apps, mutate} = useAppsData()
    const [appNameInput, setAppNameInput] = useState(appDetails.app_name)
    const [editAppLoading, setEditAppLoading] = useState(false)

    useUpdateEffect(() => {
        setAppNameInput(appDetails.app_name)
    }, [apps, appDetails])

    const appNameExist = useMemo(
        () =>
            apps.some(
                (app: GenericObject) =>
                    app.app_name.toLowerCase() === appNameInput.toLowerCase() &&
                    app.app_name.toLowerCase() !== appDetails.app_name.toLowerCase(),
            ),
        [apps, appNameInput, appDetails.app_name],
    )

    const handleEditAppName = async () => {
        try {
            setEditAppLoading(true)
            await updateAppName(appDetails.app_id, appNameInput)
            await mutate()
            props.onCancel?.({} as any)
        } catch (error) {
            console.error(error)
        } finally {
            setEditAppLoading(false)
        }
    }

    return (
        <Modal
            centered
            destroyOnClose
            okButtonProps={{
                icon: <CheckOutlined />,
                disabled: appNameExist || appNameInput.length === 0,
                loading: editAppLoading,
            }}
            onOk={handleEditAppName}
            okText={"Confirm"}
            title={<Typography.Text className={classes.title}>Rename App</Typography.Text>}
            {...props}
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
                {appNameExist && <div className={classes.modalError}>App name already exists</div>}
                {appNameInput.length > 0 && !isAppNameInputValid(appNameInput) && (
                    <div className={classes.modalError} data-cy="enter-app-name-modal-text-warning">
                        App name must contain only letters, numbers, underscore, or dash
                    </div>
                )}
            </div>
        </Modal>
    )
}

export default EditAppModal
