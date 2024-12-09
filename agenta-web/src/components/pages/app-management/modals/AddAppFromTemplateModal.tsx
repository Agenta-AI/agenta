import {Typography, Input, Card, Radio, Space, Button, Flex, Modal, notification} from "antd"
import {createUseStyles} from "react-jss"
import {JSSTheme, Template} from "@/lib/Types"
import {isAppNameInputValid} from "@/lib/helpers/utils"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        transition: "width 0.3s ease",
        "& .ant-modal-content": {
            overflow: "hidden",
            borderRadius: 16,
            "& > .ant-modal-close": {
                top: 16,
            },
        },
    },
    modal: {
        display: "flex",
        flexDirection: "column",
        gap: 24,
    },
    modalError: {
        color: theme.colorError,
        marginTop: 2,
    },
    headerText: {
        "& .ant-typography": {
            lineHeight: theme.lineHeightLG,
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
        },
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
    card: {
        width: 208,
        height: 180,
        cursor: "pointer",
        transitionDuration: "0.3s",
        "&:hover": {
            boxShadow: theme.boxShadow,
        },
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,

            "& .ant-card-head-title": {
                fontSize: theme.fontSize,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeight,
            },
        },
        "& > .ant-card-body": {
            padding: theme.paddingSM,
            "& > .ant-typography": {
                color: theme.colorTextSecondary,
            },
        },
    },
    inputName: {
        borderColor: `${theme.colorError} !important`,
        "&  .ant-input-clear-icon": {
            color: theme.colorError,
        },
    },
}))

type Props = {
    newApp: string
    setNewApp: React.Dispatch<React.SetStateAction<string>>
    templates: Template[]
    noTemplateMessage: string
    onCardClick: (template: Template) => void
    appNameExist: boolean
    templateId: string | undefined
    handleTemplateCardClick: (template_id: string) => Promise<void>
    fetchingTemplate: boolean
} & React.ComponentProps<typeof Modal>

const AddAppFromTemplatedModal = ({
    newApp,
    setNewApp,
    templates,
    noTemplateMessage,
    onCardClick,
    appNameExist,
    templateId,
    handleTemplateCardClick,
    fetchingTemplate,
    ...props
}: Props) => {
    const classes = useStyles()

    const isError = appNameExist || (newApp.length > 0 && !isAppNameInputValid(newApp))

    const handleEnterKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && templateId) {
            handleCreateApp()
        }
    }

    const handleCreateApp = () => {
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
            handleTemplateCardClick(templateId as string)
        } else {
            notification.warning({
                message: "Template Selection",
                description: "Please provide a valid app name to choose a template.",
                duration: 3,
            })
        }
    }

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
                                    extra={
                                        <Radio checked={temp.id?.includes(templateId as string)} />
                                    }
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
                        disabled={!newApp || isError || !templateId}
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
