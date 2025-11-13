import {useCallback, useEffect, useMemo} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Scroll} from "@phosphor-icons/react"
import {Typography, Space, Button, notification} from "antd"
import {useAtom} from "jotai"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {findCustomWorkflowPath, removeTrailingSlash} from "@/oss/lib/shared/variant"
import {updateVariant} from "@/oss/services/app-selector/api"
import {useAppsData} from "@/oss/state/app"
import {
    customWorkflowValuesAtomFamily,
    customWorkflowTestStatusAtom,
    customWorkflowConfiguringAtom,
} from "@/oss/state/customWorkflow/modalAtoms"

import {useStyles} from "../assets/styles"
import {CustomWorkflowModalProps} from "../types"

import CustomWorkflowModalFooter from "./CustomWorkflowModalFooter"

const {Text} = Typography

const CustomWorkflowModalContent = ({
    customWorkflowAppValues,
    setCustomWorkflowAppValues,
    handleCreateApp,
    configureWorkflow = false,
    variants,
    allVariantsDataMutate,
    appNameExist,
    mutate,
    ...props
}: CustomWorkflowModalProps) => {
    const classes = useStyles()
    const [testConnectionStatus, setTestConnectionStatus] = useAtom(customWorkflowTestStatusAtom)
    const [isConfiguringWorkflow, setIsConfiguringWorkflow] = useAtom(customWorkflowConfiguringAtom)

    const rawAppId = (props as any)?.appId ?? ""
    const appKey = rawAppId && String(rawAppId).trim().length ? String(rawAppId) : "new-app"
    const [values, setValues] = useAtom(customWorkflowValuesAtomFamily(appKey))
    const workflowUrlInput = values.appUrl
    const isUrlValid = useMemo(() => {
        const url = (workflowUrlInput || "").trim()
        if (!url) return false
        try {
            const parsed = new URL(url)
            return parsed.protocol === "http:" || parsed.protocol === "https:"
        } catch (e) {
            return false
        }
    }, [workflowUrlInput])

    useEffect(() => {
        // Only sync from props when creating a new app (unhydrated) AND values are explicitly provided
        if (configureWorkflow) return
        if (!customWorkflowAppValues) return
        const hasExplicit = Boolean(
            customWorkflowAppValues.appName ||
                customWorkflowAppValues.appUrl ||
                customWorkflowAppValues.appDesc,
        )
        if (!hasExplicit) return
        setValues((draft) => {
            draft.appName = customWorkflowAppValues.appName
            draft.appUrl = customWorkflowAppValues.appUrl
            draft.appDesc = customWorkflowAppValues.appDesc
        })
    }, [configureWorkflow, customWorkflowAppValues, setValues])

    // Access current app and variants before seeding effect
    const {currentApp, apps} = useAppsData()
    // Fetch variants as a fallback if not provided via props
    // @ts-ignore
    const {data: fetchedVariantsData} = useVariants(currentApp)
    const effectiveVariants = variants?.length ? variants : fetchedVariantsData?.variants

    // Seeding is handled on modal open via openCustomWorkflowModalAtom -> customWorkflowSeedAtom

    // Fallback hydration: if modal opened before atoms resolved, hydrate missing fields once they arrive
    useEffect(() => {
        if (!configureWorkflow) return
        const derivedName = (currentApp as any)?.app_name || ""
        const derivedUrl = (effectiveVariants as any)?.[0]?.uri || ""
        if (!derivedName && !derivedUrl) return
        if (!values.appName && derivedName) {
            setValues((draft) => {
                draft.appName = derivedName
            })
        }
        if (!values.appUrl && derivedUrl) {
            setValues((draft) => {
                draft.appUrl = derivedUrl
            })
            setTestConnectionStatus({success: false, error: false, loading: false})
        }
    }, [configureWorkflow, (currentApp as any)?.app_name, (effectiveVariants as any)?.[0]?.uri])

    // When URL changes, clear previous test status so user gets accurate hints
    useEffect(() => {
        setTestConnectionStatus({success: false, error: false, loading: false})
    }, [workflowUrlInput])

    // Compute appNameExist locally based on current form values (applies to both create & configure)
    const appNameExistComputed = useMemo(() => {
        if (!Array.isArray(apps)) return false
        const name = (values.appName || "").toLowerCase().trim()
        if (!name) return false
        return apps.some((app: any) => (app?.app_name || "").toLowerCase() === name)
    }, [apps, values.appName])

    const handleEditCustomUrl = useCallback(async () => {
        if (!effectiveVariants?.length) {
            notification.error({
                message: "Custom workflow",
                description: "No variants found to update.",
                duration: 3,
            })
            return
        }

        // Deduplicate by effective target variant ID: parent id if present, else own id
        const targetIds = new Set<string>()
        for (const v of effectiveVariants) {
            const parent = (v as any)._parentVariant
            const parentId =
                typeof parent === "string"
                    ? parent
                    : (parent?.id as string | undefined) ||
                      (parent?.variantId as string | undefined)
            const selfId = (v as any).id || (v as any).variantId
            const resolved = parentId || selfId
            if (resolved) targetIds.add(resolved)
        }

        setIsConfiguringWorkflow(true)
        try {
            await Promise.all(
                Array.from(targetIds).map((id) =>
                    updateVariant({
                        serviceUrl: removeTrailingSlash(workflowUrlInput),
                        variantId: id,
                    }),
                ),
            )
            await Promise.all([allVariantsDataMutate?.(), mutate()])
            setCustomWorkflowAppValues?.((prev) => ({
                ...prev,
                appUrl: workflowUrlInput,
            }))
            notification.success({
                message: "Custom workflow",
                description: "Workflow URL saved successfully.",
                duration: 2,
            })
            // Close only on success
            props.onCancel?.({} as any)
        } catch (error) {
            console.error("Failed to update variants:", error)
            notification.error({
                message: "Custom workflow",
                description: "Failed to save the workflow URL. Please try again.",
                duration: 3,
            })
        } finally {
            setIsConfiguringWorkflow(false)
        }
    }, [
        effectiveVariants,
        workflowUrlInput,
        allVariantsDataMutate,
        mutate,
        setCustomWorkflowAppValues,
        props,
    ])

    const runTestConnection = useCallback(async (delay = 0, url?: string) => {
        if (!url) return

        setTestConnectionStatus({success: false, error: false, loading: true})

        try {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
            const {status} = (await findCustomWorkflowPath(url, "/health")) || {}
            if (!status) throw new Error("Unable to establish connection")
            setTestConnectionStatus({success: true, error: false, loading: false})
        } catch (error) {
            console.error(error)
            setTestConnectionStatus({success: false, error: true, loading: false})
        }
    }, [])

    useEffect(() => {
        if (workflowUrlInput) {
            const timeout = setTimeout(() => runTestConnection(undefined, workflowUrlInput), 100)
            return () => clearTimeout(timeout)
        }
    }, [workflowUrlInput, runTestConnection])

    useEffect(() => {
        if (props.open) {
            setTestConnectionStatus({
                error: false,
                success: false,
                loading: false,
            })
        }
    }, [props.open])

    // Footer rendered inline at the end to keep it bound to live local values

    return (
        <section className={classes.modal}>
            <div className="flex items-center justify-between">
                <Space className={classes.headerText}>
                    {configureWorkflow ? (
                        <Typography.Text>Configure</Typography.Text>
                    ) : (
                        <Typography.Text>Custom workflow</Typography.Text>
                    )}
                </Space>

                <Space>
                    {!configureWorkflow && (
                        <Typography.Link
                            href="https://docs.agenta.ai/custom-workflows/quick-start"
                            target="_blank"
                        >
                            <Button icon={<Scroll size={14} className="mt-[2px]" />} size="small">
                                Tutorial
                            </Button>
                        </Typography.Link>
                    )}
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                </Space>
            </div>

            {!configureWorkflow && (
                <Text>
                    Connect your own AI service to Agenta to use our evaluation tools with your
                    code. Your application will remain on your infrastructure while Agenta
                    communicates with it through the URL you provide.
                </Text>
            )}

            <div className="space-y-1" id="tour-custom-app-name-input">
                <SharedEditor
                    header={<Typography className={classes.label}>App name *</Typography>}
                    initialValue={values.appName}
                    handleChange={(value) => {
                        setValues((draft) => {
                            draft.appName = value
                        })
                        setCustomWorkflowAppValues?.((prev) => ({...prev, appName: value}))
                    }}
                    editorType="border"
                    placeholder="Enter app name"
                    editorClassName={`!border-none !shadow-none px-0 ${
                        appNameExistComputed ||
                        (values.appName.length > 0 && !isAppNameInputValid(values.appName))
                            ? "border-red-500 !border"
                            : ""
                    }`}
                    className="py-1 px-[11px] !w-auto"
                    useAntdInput
                    disabled={configureWorkflow}
                    state={configureWorkflow ? "disabled" : "filled"}
                />

                {appNameExist && (
                    <Typography.Text
                        style={{
                            color: "red",
                            fontSize: "12px",
                            marginTop: "2px",
                            display: "block",
                        }}
                    >
                        App name already exists
                    </Typography.Text>
                )}
                {values.appName.length > 0 && !isAppNameInputValid(values.appName) && (
                    <Typography.Text
                        style={{
                            color: "red",
                            fontSize: "12px",
                            marginTop: "2px",
                            display: "block",
                        }}
                    >
                        App name must contain only letters, numbers, underscore, or dash without any
                        spaces.
                    </Typography.Text>
                )}
            </div>

            <div id="tour-custom-app-url-input">
                <SharedEditor
                    header={<Typography className={classes.label}>Workflow URL *</Typography>}
                    initialValue={workflowUrlInput}
                    handleChange={(value) => {
                        setValues((draft) => {
                            draft.appUrl = value
                        })
                        setCustomWorkflowAppValues?.((prev) => ({...prev, appUrl: value}))
                    }}
                    editorType="border"
                    placeholder="Enter workflow URL"
                    editorClassName="!border-none !shadow-none px-0"
                    className="py-1 px-[11px] !w-auto"
                    useAntdInput
                />
            </div>
            {
                <CustomWorkflowModalFooter
                    handleCancelButton={() => props.onCancel?.({} as any)}
                    handleCreateApp={handleCreateApp}
                    handleEditCustomUrl={handleEditCustomUrl}
                    isConfiguringWorkflow={isConfiguringWorkflow}
                    configureWorkflow={configureWorkflow}
                    customWorkflowAppValues={values}
                    testConnectionStatus={testConnectionStatus}
                    appNameExist={appNameExistComputed}
                    runTestConnection={runTestConnection}
                    isUrlValid={isUrlValid}
                    variantsReady={Array.isArray(effectiveVariants) && effectiveVariants.length > 0}
                />
            }
        </section>
    )
}

export default CustomWorkflowModalContent
