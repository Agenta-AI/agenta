import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    generateSlugWithExistingSuffix,
    generateSlugWithSuffix,
    getSlugSuffix,
    isValidSlug,
    regenerateSlugSuffix,
} from "@agenta/shared/utils"
import {ArrowClockwise, WarningCircle} from "@phosphor-icons/react"
import {Button, Card, Flex, Input, notification, Radio, Tag, Typography} from "antd"
import clsx from "clsx"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {GenericObject} from "@/oss/lib/Types"
import {useAppsData, useTemplates} from "@/oss/state/app"

import {getTemplateKey} from "../../../assets/helpers"
import {useStyles} from "../assets/styles"

const {Text} = Typography

interface AddAppFromTemplateModalContentProps {
    handleTemplateCardClick: (
        templateId: string,
        appName: string,
        appSlug?: string,
    ) => Promise<void>
}

const AddAppFromTemplateModalContent = ({
    handleTemplateCardClick,
}: AddAppFromTemplateModalContentProps) => {
    const classes = useStyles()

    const [newApp, setNewApp] = useState("")
    const [newAppSlug, setNewAppSlug] = useState<string | null>(null)
    const [slugEditing, setSlugEditing] = useState(false)
    const [templateKey, setTemplateKey] = useState<string | undefined>(undefined)
    const generatedSlugSuffixRef = useRef<string | null>(null)
    const slugManuallyEditedRef = useRef(false)

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
    const slugValidationError =
        newAppSlug && !isValidSlug(newAppSlug)
            ? "Slug may only contain a-z, 0-9, hyphens, underscores, and periods."
            : null

    useEffect(() => {
        if (!newApp.trim()) {
            setNewAppSlug(null)
            setSlugEditing(false)
            generatedSlugSuffixRef.current = null
            slugManuallyEditedRef.current = false
            return
        }

        if (slugManuallyEditedRef.current) return

        const generatedSlug = generateSlugWithExistingSuffix(newApp, generatedSlugSuffixRef.current)
        generatedSlugSuffixRef.current = getSlugSuffix(generatedSlug)
        setNewAppSlug(generatedSlug)
    }, [newApp])

    const handleAppNameChange = useCallback(
        (value: string) => {
            setNewApp(value)

            if (!value.trim()) {
                setNewAppSlug(null)
                setSlugEditing(false)
                generatedSlugSuffixRef.current = null
                slugManuallyEditedRef.current = false
                return
            }

            if (!slugManuallyEditedRef.current && !newAppSlug?.trim() && value.trim()) {
                const generatedSlug = generateSlugWithExistingSuffix(
                    value,
                    generatedSlugSuffixRef.current,
                )
                generatedSlugSuffixRef.current = getSlugSuffix(generatedSlug)
                setNewAppSlug(generatedSlug)
            }
        },
        [newAppSlug, slugEditing],
    )

    const handleSlugInputChange = useCallback((value: string) => {
        slugManuallyEditedRef.current = true
        setNewAppSlug(value)
    }, [])

    const handleRegenerateSlug = useCallback(() => {
        const generatedSlug = regenerateSlugSuffix(
            newAppSlug || newApp,
            generatedSlugSuffixRef.current,
        )
        generatedSlugSuffixRef.current = getSlugSuffix(generatedSlug)
        setNewAppSlug(generatedSlug)
    }, [newApp, newAppSlug])

    const handleEditSlug = useCallback(() => {
        if (!newAppSlug && newApp.trim()) {
            const generatedSlug = generateSlugWithSuffix(newApp)
            generatedSlugSuffixRef.current = getSlugSuffix(generatedSlug)
            setNewAppSlug(generatedSlug)
        }
        setSlugEditing(true)
    }, [newApp, newAppSlug])

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
        } else if (
            !fetchingTemplate &&
            newApp.length > 0 &&
            isAppNameInputValid(newApp) &&
            newAppSlug &&
            !slugValidationError
        ) {
            handleTemplateCardClick(templateKey as string, newApp, newAppSlug)
        } else {
            notification.warning({
                message: "Template Selection",
                description: "Please provide a valid app name to choose a template.",
                duration: 3,
            })
        }
    }, [
        appNameExist,
        fetchingTemplate,
        handleTemplateCardClick,
        newApp,
        newAppSlug,
        slugValidationError,
        templateKey,
    ])

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
                    onChange={(e) => handleAppNameChange(e.target.value)}
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

                <div className="flex flex-col gap-1">
                    {slugEditing ? (
                        <>
                            <Text className="font-medium">Slug</Text>
                            <Input
                                value={newAppSlug ?? ""}
                                onChange={(e) => handleSlugInputChange(e.target.value)}
                                status={slugValidationError ? "error" : undefined}
                                suffix={
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<ArrowClockwise size={14} />}
                                        onClick={handleRegenerateSlug}
                                        title="Regenerate random suffix"
                                    />
                                }
                            />
                            {slugValidationError && (
                                <div className="mt-0.5 flex items-start gap-1 text-[#ff4d4f]">
                                    <WarningCircle size={16} className="mt-0.5 shrink-0" />
                                    <span>{slugValidationError}</span>
                                </div>
                            )}
                            {!slugValidationError && (
                                <Typography.Text type="secondary">
                                    Edit freely - use the regenerate button to add a random suffix
                                    back.
                                </Typography.Text>
                            )}
                        </>
                    ) : (
                        <div className="flex h-7 min-w-0 items-center gap-2">
                            {newAppSlug && (
                                <>
                                    <Typography.Text className="shrink-0 font-medium">
                                        Slug:
                                    </Typography.Text>
                                    <Tag
                                        className="min-w-0 max-w-[min(360px,calc(100%-88px))] truncate bg-gray-100 font-mono text-gray-500 text-[10px]"
                                        title={newAppSlug}
                                    >
                                        {newAppSlug}
                                    </Tag>
                                    <Button
                                        type="link"
                                        size="small"
                                        className="shrink-0"
                                        onClick={handleEditSlug}
                                    >
                                        Edit
                                    </Button>
                                </>
                            )}
                        </div>
                    )}
                </div>
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
                    disabled={
                        !newApp || isError || !templateKey || !newAppSlug || !!slugValidationError
                    }
                    onClick={handleCreateApp}
                >
                    Create New Prompt
                </Button>
            </div>
        </section>
    )
}

export default AddAppFromTemplateModalContent
