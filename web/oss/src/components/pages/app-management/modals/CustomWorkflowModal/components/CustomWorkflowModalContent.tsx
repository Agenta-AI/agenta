import {useCallback, useEffect, useMemo} from "react"

import {probeEndpointPath} from "@agenta/entities/shared/openapi"
import {workflowRevisionsByWorkflowListDataAtomFamily} from "@agenta/entities/workflow"
import {removeTrailingSlash} from "@agenta/shared/utils"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {CloseOutlined} from "@ant-design/icons"
import {Scroll} from "@phosphor-icons/react"
import {Typography, Space, Button, notification} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import {updateVariant} from "@/oss/services/app-selector/api"
import {useAppsData} from "@/oss/state/app"
import {
    normalizeAppKey,
    customWorkflowValuesAtomFamily,
    customWorkflowTestStatusAtom,
    customWorkflowConfiguringAtom,
} from "@/oss/state/customWorkflow/modalAtoms"

import {useStyles} from "../assets/styles"

import CustomWorkflowModalFooter from "./CustomWorkflowModalFooter"

const {Text} = Typography

interface CustomWorkflowModalContentProps {
    appId?: string | null
    onCancel: () => void
    onSuccess?: () => Promise<void>
    onCreateApp?: () => void
}

const CustomWorkflowModalContent = ({
    appId: propsAppId,
    onCancel,
    onSuccess,
    onCreateApp,
}: CustomWorkflowModalContentProps) => {
    const classes = useStyles()
    const [testConnectionStatus, setTestConnectionStatus] = useAtom(customWorkflowTestStatusAtom)
    const [isConfiguringWorkflow, setIsConfiguringWorkflow] = useAtom(customWorkflowConfiguringAtom)

    const appKey = normalizeAppKey(propsAppId)
    const configureWorkflow = appKey !== "new-app"
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

    const {currentApp, apps} = useAppsData()
    const revisions = useAtomValue(
        useMemo(
            () => workflowRevisionsByWorkflowListDataAtomFamily(configureWorkflow ? appKey : ""),
            [configureWorkflow, appKey],
        ),
    )

    // Fallback hydration: if modal opened before atoms resolved, hydrate missing fields once they arrive
    useEffect(() => {
        if (!configureWorkflow) return
        const derivedName = currentApp?.name ?? currentApp?.slug ?? ""
        const derivedUrl = (revisions as any)?.[0]?.data?.url || ""
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
    }, [configureWorkflow, currentApp?.name, currentApp?.slug, (revisions as any)?.[0]?.data?.url])

    // When URL changes, clear previous test status so user gets accurate hints
    useEffect(() => {
        setTestConnectionStatus({success: false, error: false, loading: false})
    }, [workflowUrlInput])

    // Compute appNameExist locally based on current form values (applies to both create & configure)
    const appNameExist = useMemo(() => {
        if (!Array.isArray(apps)) return false
        const name = (values.appName || "").toLowerCase().trim()
        if (!name) return false
        return apps.some((app: any) => ((app?.name ?? app?.slug) || "").toLowerCase() === name)
    }, [apps, values.appName])

    const handleEditCustomUrl = useCallback(async () => {
        if (!revisions?.length) {
            notification.error({
                message: "Custom workflow",
                description: "No variants found to update.",
                duration: 3,
            })
            return
        }

        // Deduplicate by variant ID
        const targetIds = new Set<string>()
        for (const v of revisions) {
            const variantId =
                (v as any).workflow_variant_id || (v as any).variantId || (v as any).id
            if (variantId) targetIds.add(variantId)
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
            await onSuccess?.()
            notification.success({
                message: "Custom workflow",
                description: "Workflow URL saved successfully.",
                duration: 2,
            })
            onCancel()
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
    }, [revisions, workflowUrlInput, onSuccess, onCancel])

    const runTestConnection = useCallback(async (delay = 0, url?: string) => {
        if (!url) return

        setTestConnectionStatus({success: false, error: false, loading: true})

        try {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
            const result = await probeEndpointPath(url, {endpoint: "/health"})
            const status = result?.status
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
                            href="https://agenta.ai/docs/custom-workflows/quick-start"
                            target="_blank"
                        >
                            <Button icon={<Scroll size={14} className="mt-[2px]" />} size="small">
                                Tutorial
                            </Button>
                        </Typography.Link>
                    )}
                    <Button onClick={onCancel} type="text" icon={<CloseOutlined />} />
                </Space>
            </div>

            {!configureWorkflow && (
                <Text>
                    Connect your own AI service to Agenta to use our evaluation tools with your
                    code. Your application will remain on your infrastructure while Agenta
                    communicates with it through the URL you provide.
                </Text>
            )}

            <div className="space-y-1">
                <SharedEditor
                    header={<Typography className={classes.label}>App name *</Typography>}
                    initialValue={values.appName}
                    handleChange={(value) => {
                        setValues((draft) => {
                            draft.appName = value
                        })
                    }}
                    editorType="border"
                    placeholder="Enter app name"
                    editorClassName={`!border-none !shadow-none px-0 ${
                        appNameExist ||
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

            <SharedEditor
                header={<Typography className={classes.label}>Workflow URL *</Typography>}
                initialValue={workflowUrlInput}
                handleChange={(value) => {
                    setValues((draft) => {
                        draft.appUrl = value
                    })
                }}
                editorType="border"
                placeholder="Enter workflow URL"
                editorClassName="!border-none !shadow-none px-0"
                className="py-1 px-[11px] !w-auto"
                useAntdInput
            />

            <CustomWorkflowModalFooter
                handleCancelButton={onCancel}
                handleCreateApp={onCreateApp ?? (() => {})}
                handleEditCustomUrl={handleEditCustomUrl}
                isConfiguringWorkflow={isConfiguringWorkflow}
                configureWorkflow={configureWorkflow}
                customWorkflowAppValues={values}
                testConnectionStatus={testConnectionStatus}
                appNameExist={appNameExist}
                runTestConnection={runTestConnection}
                isUrlValid={isUrlValid}
                variantsReady={Array.isArray(revisions) && revisions.length > 0}
            />
        </section>
    )
}

export default CustomWorkflowModalContent
