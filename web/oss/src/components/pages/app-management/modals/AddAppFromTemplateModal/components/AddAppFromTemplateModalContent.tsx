import {useCallback, useMemo, useState} from "react"

import {Typography, Input, Card, Radio, Flex, Button, notification} from "antd"
import clsx from "clsx"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {GenericObject} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"
import {useTemplates} from "@/oss/state/app"

import {getTemplateKey} from "../../../assets/helpers"
import {useStyles} from "../assets/styles"

const {Text} = Typography

interface AddAppFromTemplateModalContentProps {
    handleTemplateCardClick: (templateId: string, appName: string) => Promise<void>
}

const AddAppFromTemplateModalContent = ({
    handleTemplateCardClick,
}: AddAppFromTemplateModalContentProps) => {
    const classes = useStyles()

    const [newApp, setNewApp] = useState("")
    const [templateKey, setTemplateKey] = useState<string | undefined>(undefined)

    const {apps} = useAppsData()
    const [{data: allTemplates = [], isLoading: fetchingTemplate}, noTemplateMessage] =
        useTemplates()

    const templates = useMemo(
        () =>
            allTemplates.filter(
                (t) =>
                    !t.data?.uri?.startsWith("agenta:custom:") &&
                    !t.data?.uri?.startsWith("agenta:builtin:llm:"),
            ),
        [allTemplates],
    )

    const appNameExist = useMemo(
        () =>
            apps.some(
                (app: GenericObject) =>
                    ((app?.name ?? app?.slug) || "").toLowerCase() === newApp.toLowerCase(),
            ),
        [apps, newApp],
    )

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
            handleTemplateCardClick(templateKey as string, newApp)
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

    const onCardClick = useCallback((template: (typeof templates)[number]) => {
        const key = getTemplateKey(template)
        if (key) {
            setTemplateKey(key)
        }
    }, [])

    return (
        <section className={classes.modal}>
            <div className={classes.headerText}>
                <Typography.Text>Create New Prompt</Typography.Text>
            </div>

            <div className="space-y-2">
                <Text className={classes.label}>Provide the name of the application</Text>
                <Input
                    placeholder="Enter a name"
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
                    <Typography.Text className={classes.modalError}>
                        App name must contain only letters, numbers, underscore, or dash without any
                        spaces.
                    </Typography.Text>
                )}
            </div>

            <div className="space-y-2">
                <Text className={classes.label}>Choose the prompt type</Text>
                <Flex gap={16}>
                    {noTemplateMessage ? (
                        <Card title="No Templates Available" className={classes.card}>
                            <Text>{noTemplateMessage}</Text>
                        </Card>
                    ) : (
                        templates.map((temp) => (
                            <Card
                                key={temp.key}
                                title={temp.name ?? temp.key}
                                extra={<Radio checked={getTemplateKey(temp) === templateKey} />}
                                className={clsx(classes.card, "capitalize")}
                                onClick={() => onCardClick(temp)}
                            >
                                <Text>{temp.description ?? ""}</Text>
                            </Card>
                        ))
                    )}
                </Flex>
            </div>

            <div className="flex justify-end">
                <Button
                    type="primary"
                    disabled={!newApp || isError || !templateKey}
                    onClick={handleCreateApp}
                >
                    Create New Prompt
                </Button>
            </div>
        </section>
    )
}

export default AddAppFromTemplateModalContent
