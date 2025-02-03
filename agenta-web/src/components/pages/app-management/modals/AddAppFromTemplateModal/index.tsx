import {Typography, Input, Card, Radio, Space, Button, Flex, Modal, notification} from "antd"

import {isAppNameInputValid} from "@/lib/helpers/utils"
import {useStyles} from "./assets/styles"
import {AddAppFromTemplatedModalProps} from "./types"
import {useCallback} from "react"
import {getTemplateKey} from "../../assets/helpers"

const {Text} = Typography

const AddAppFromTemplatedModal = ({
    newApp,
    setNewApp,
    templates,
    noTemplateMessage,
    onCardClick,
    appNameExist,
    templateKey,
    handleTemplateCardClick,
    fetchingTemplate,
    ...props
}: AddAppFromTemplatedModalProps) => {
    const classes = useStyles()

    const isError = appNameExist || (newApp.length > 0 && !isAppNameInputValid(newApp))

    const handleCreateApp = useCallback(() => {
        if (appNameExist) {
            notification.warning({
                message: "Template Selection",
                description: "App name already exists. Please choose a different name.",
                duration: 3,
            })
        } else if (fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
            notification.info({
                message: "Template Selection",
                description: "The template image is currently being fetched. Please wait...",
                duration: 3,
            })
        } else if (!fetchingTemplate && newApp.length > 0 && isAppNameInputValid(newApp)) {
            handleTemplateCardClick(templateKey as string)
        } else {
            notification.warning({
                message: "Template Selection",
                description: "Please provide a valid app name to choose a template.",
                duration: 3,
            })
        }
    }, [appNameExist, fetchingTemplate, handleTemplateCardClick, newApp, templateKey])

    const handleEnterKeyPress = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter" && templateKey) {
                handleCreateApp()
            }
        },
        [handleCreateApp, templateKey],
    )

    return (
        <Modal
            destroyOnClose
            footer={null}
            title={null}
            className={classes.modalContainer}
            width={480}
            centered
            {...props}
        >
            <section className={classes.modal}>
                <Space className={classes.headerText}>
                    <Typography.Text>Start with a template</Typography.Text>
                </Space>

                <Text>Create a an application using our preset LLM configuration.</Text>

                <div className="space-y-2">
                    <Text className={classes.label}>Provide the name of the application</Text>
                    <Input
                        placeholder="Enter a name"
                        data-cy="enter-app-name-input"
                        value={newApp}
                        onChange={(e) => setNewApp(e.target.value)}
                        onKeyDown={handleEnterKeyPress}
                        className={`${isError && classes.inputName}`}
                        allowClear
                    />

                    {appNameExist && (
                        <Typography.Text className={classes.modalError}>
                            App name already exists
                        </Typography.Text>
                    )}
                    {newApp.length > 0 && !isAppNameInputValid(newApp) && (
                        <Typography.Text
                            className={classes.modalError}
                            data-cy="enter-app-name-modal-text-warning"
                        >
                            App name must contain only letters, numbers, underscore, or dash without
                            any spaces.
                        </Typography.Text>
                    )}
                </div>

                <div className="space-y-2">
                    <Text className={classes.label}>Choose your template</Text>
                    <Flex gap={16}>
                        {noTemplateMessage ? (
                            <Card title="No Templates Available" className={classes.card}>
                                <Text>{noTemplateMessage}</Text>
                            </Card>
                        ) : (
                            templates.map((temp) => (
                                <Card
                                    key={temp.id}
                                    data-cy="app-template-card"
                                    title={temp.image.title}
                                    extra={<Radio checked={getTemplateKey(temp) === templateKey} />}
                                    className={classes.card}
                                    onClick={() => {
                                        onCardClick(temp)
                                    }}
                                >
                                    <Text>{temp.image.description}</Text>
                                </Card>
                            ))
                        )}
                    </Flex>
                </div>

                <div className="flex justify-end">
                    <Button
                        type="primary"
                        disabled={!newApp || isError || !templateKey}
                        data-cy="create-app-from-template-button"
                        onClick={handleCreateApp}
                    >
                        Create new app
                    </Button>
                </div>
            </section>
        </Modal>
    )
}

export default AddAppFromTemplatedModal
