import {Typography, Input, Card, Radio, Space, Button, Flex} from "antd"
import {createUseStyles} from "react-jss"
import {JSSTheme, Template} from "@/lib/Types"
import {isAppNameInputValid} from "@/lib/helpers/utils"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
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
    handleCreateApp: () => void
    templateId: string | undefined
}

const AddAppFromTemplatedModal = ({
    newApp,
    setNewApp,
    templates,
    noTemplateMessage,
    onCardClick,
    appNameExist,
    handleCreateApp,
    templateId,
}: Props) => {
    const classes = useStyles()

    const isError = appNameExist || (newApp.length > 0 && !isAppNameInputValid(newApp))

    const handleEnterKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && templateId) {
            handleCreateApp()
        }
    }

    return (
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
                        App name must contain only letters, numbers, underscore, or dash without any
                        spaces.
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
                                extra={<Radio checked={temp.id?.includes(templateId as string)} />}
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
    )
}

export default AddAppFromTemplatedModal
