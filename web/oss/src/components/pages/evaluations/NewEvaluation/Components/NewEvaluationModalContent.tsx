import {FC, memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {CloseCircleOutlined} from "@ant-design/icons"
import {Input, Typography, Tabs, Tag} from "antd"
import clsx from "clsx"
import {getDefaultStore} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import {useAppId} from "@/oss/hooks/useAppId"
import useFocusInput from "@/oss/hooks/useFocusInput"
import useURL from "@/oss/hooks/useURL"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {redirectIfNoLLMKeys} from "@/oss/lib/helpers/utils"
import useAppVariantRevisions from "@/oss/lib/hooks/useAppVariantRevisions"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {extractInputKeysFromSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {createEvaluation} from "@/oss/services/evaluations/api"
import {fetchTestset} from "@/oss/services/testsets/api"
import {useAppsData} from "@/oss/state/app/hooks"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {useTestsetsData} from "@/oss/state/testset"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {buildEvaluationNavigationUrl} from "../../utils"
import {DEFAULT_ADVANCE_SETTINGS} from "../assets/constants"
import {useStyles} from "../assets/styles"
import TabLabel from "../assets/TabLabel"
import type {
    LLMRunRateLimitWithCorrectAnswer,
    NewEvaluationModalContentProps,
    NewEvaluationAppOption,
} from "../types"

import usePreviewEvaluations from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations"

const SelectAppSection = dynamic(() => import("./SelectAppSection"), {ssr: false})
const SelectEvaluatorSection = dynamic(
    () => import("./SelectEvaluatorSection/SelectEvaluatorSection"),
    {ssr: false},
)
const SelectTestsetSection = dynamic(() => import("./SelectTestsetSection"), {
    ssr: false,
})
const SelectVariantSection = dynamic(() => import("./SelectVariantSection"), {
    ssr: false,
})
const AdvancedSettings = dynamic(() => import("./AdvancedSettings"), {
    ssr: false,
})
const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const noopSubmit = async () => {}

const NewEvaluationModalContent: FC<NewEvaluationModalContentProps> = ({
    preview = false,
    evaluationType,
    open,
    onSuccess,
    onRegisterSubmit,
    onLoadingChange,
    onReset,
    className,
    ...rest
}) => {
    console.log("NewEvaluationModalContent")
    const classes = useStyles()
    const router = useRouter()
    const {inputRef} = useFocusInput({isOpen: open})
    const {baseAppURL, projectURL, redirectUrl} = useURL()
    const appId = useAppId()
    const isAppScoped = Boolean(appId)
    const {apps: availableApps = []} = useAppsData()
    const {secrets} = useVaultSecret()

    const [selectedAppId, setSelectedAppId] = useState<string>(appId || "")
    const [activePanel, setActivePanel] = useState<string | null>(
        isAppScoped ? "variantPanel" : "appPanel",
    )
    const [selectedTestsetId, setSelectedTestsetId] = useState("")
    const [selectedVariantRevisionIds, setSelectedVariantRevisionIds] = useState<string[]>([])
    const [selectedEvalConfigs, setSelectedEvalConfigs] = useState<string[]>([])
    const [evaluationName, setEvaluationName] = useState("")
    const [nameFocused, setNameFocused] = useState(false)
    const [advanceSettings, setAdvanceSettings] =
        useState<LLMRunRateLimitWithCorrectAnswer>(DEFAULT_ADVANCE_SETTINGS)
    const [submitLoading, setSubmitLoading] = useState(false)

    useEffect(() => {
        onLoadingChange(submitLoading)
    }, [submitLoading, onLoadingChange])

    const resetState = useCallback(() => {
        setSelectedTestsetId("")
        setSelectedVariantRevisionIds([])
        setSelectedEvalConfigs([])
        setEvaluationName("")
        setAdvanceSettings(DEFAULT_ADVANCE_SETTINGS)
        setActivePanel(isAppScoped ? "variantPanel" : "appPanel")
        if (!isAppScoped) {
            setSelectedAppId("")
        }
        setSubmitLoading(false)
        onLoadingChange(false)
        onReset?.()
    }, [isAppScoped, onLoadingChange, onReset])

    useEffect(() => {
        if (!open) {
            resetState()
            return
        }
        if (isAppScoped) {
            setSelectedAppId(appId || "")
            setActivePanel("variantPanel")
        }
    }, [open, isAppScoped, appId, resetState])

    const appOptions = useMemo<NewEvaluationAppOption[]>(() => {
        const options = availableApps.map((app) => ({
            label: app.app_name,
            value: app.app_id,
            type: app.app_type ?? null,
            createdAt: app.created_at ?? null,
            updatedAt: app.updated_at ?? null,
        }))
        if (selectedAppId && !options.some((opt) => opt.value === selectedAppId)) {
            options.push({
                label: selectedAppId,
                value: selectedAppId,
                type: null,
                createdAt: null,
                updatedAt: null,
            })
        }
        return options
    }, [availableApps, selectedAppId])

    const evaluationData = useFetchEvaluatorsData({
        preview,
        queries: {is_human: evaluationType === "human"},
        appId: selectedAppId || "",
    })

    const {evaluators, evaluatorConfigs, loadingEvaluators, loadingEvaluatorConfigs} =
        useMemo(() => {
            if (preview) {
                return {
                    evaluators: evaluationData.evaluatorsSwr?.data || [],
                    evaluatorConfigs: [],
                    loadingEvaluators: evaluationData.evaluatorsSwr?.isLoading ?? false,
                    loadingEvaluatorConfigs: false,
                }
            }
            return {
                evaluators: [],
                evaluatorConfigs: evaluationData.evaluatorConfigsSwr?.data || [],
                loadingEvaluators: false,
                loadingEvaluatorConfigs: evaluationData.evaluatorConfigsSwr?.isLoading ?? false,
            }
        }, [preview, evaluationData])

    const {variants: appVariantRevisions, isLoading: variantsLoading} = useAppVariantRevisions(
        selectedAppId || null,
    )
    const filteredVariants = useMemo(() => {
        if (!selectedAppId) return []
        return appVariantRevisions || []
    }, [appVariantRevisions, selectedAppId])

    const {testsets} = useTestsetsData()

    const {createNewRun: createPreviewEvaluationRun} = usePreviewEvaluations({
        skip: !open,
        appId: selectedAppId || appId,
    })

    const handlePanelChange = useCallback((key: string | string[]) => {
        setActivePanel(key as string)
    }, [])

    const handleAppSelection = useCallback(
        (value: string) => {
            if (value === selectedAppId) return
            setSelectedAppId(value)
            setSelectedTestsetId("")
            setSelectedVariantRevisionIds([])
            setSelectedEvalConfigs([])
            setEvaluationName("")
            setActivePanel("variantPanel")
            setAdvanceSettings(DEFAULT_ADVANCE_SETTINGS)
        },
        [selectedAppId],
    )

    useEffect(() => {
        if (!open) return
        if (!isAppScoped) {
            setSelectedAppId("")
        }
    }, [open, isAppScoped])

    useEffect(() => {
        if (!open) return
        if (!isAppScoped) return
        if (!selectedAppId) return
        if (activePanel !== "appPanel") return
        setActivePanel("variantPanel")
    }, [open, isAppScoped, selectedAppId, activePanel])

    const generatedNameBase = useMemo(() => {
        if (!selectedVariantRevisionIds.length || !selectedTestsetId) return ""
        const variant = filteredVariants?.find((v) => selectedVariantRevisionIds.includes(v.id))
        const testset = testsets?.find((ts) => ts._id === selectedTestsetId)
        if (!variant || !testset) return ""
        return `${variant.variantName}-v${variant.revision}-${testset.name}`
    }, [selectedVariantRevisionIds, selectedTestsetId, filteredVariants, testsets])

    const lastAutoNameRef = useRef<string>("")
    const lastBaseRef = useRef<string>("")
    const randomWordRef = useRef<string>("")

    const genRandomWord = useCallback(() => {
        const n = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] ?? 0
        if (n) return n.toString(36).slice(0, 5)
        return Math.random().toString(36).slice(2, 7)
    }, [])

    useEffect(() => {
        if (!open) return
        randomWordRef.current = genRandomWord()
        lastAutoNameRef.current = ""
        lastBaseRef.current = ""
        return () => {
            randomWordRef.current = ""
        }
    }, [open, genRandomWord])

    useEffect(() => {
        if (!generatedNameBase) return
        if (nameFocused) return
        if (generatedNameBase !== lastBaseRef.current) {
            if (!randomWordRef.current) randomWordRef.current = genRandomWord()
            const randomWord = randomWordRef.current
            const newName = `${generatedNameBase}-${randomWord}`
            const shouldUpdate = !evaluationName || evaluationName === lastAutoNameRef.current
            lastBaseRef.current = generatedNameBase
            lastAutoNameRef.current = newName
            if (shouldUpdate) {
                setEvaluationName(newName)
            }
            return
        }
        if (!evaluationName) {
            setEvaluationName(lastAutoNameRef.current)
        }
    }, [generatedNameBase, evaluationName, nameFocused, genRandomWord])

    useEffect(() => {
        const handleFocusIn = (event: FocusEvent) => {
            if ((event.target as HTMLElement)?.tagName === "INPUT") {
                setNameFocused(true)
            }
        }
        const handleFocusOut = (event: FocusEvent) => {
            if ((event.target as HTMLElement)?.tagName === "INPUT") {
                setNameFocused(false)
            }
        }
        document.addEventListener("focusin", handleFocusIn)
        document.addEventListener("focusout", handleFocusOut)
        return () => {
            document.removeEventListener("focusin", handleFocusIn)
            document.removeEventListener("focusout", handleFocusOut)
        }
    }, [])

    const filteredTestsets = useMemo(() => {
        return selectedAppId ? testsets || [] : []
    }, [selectedAppId, testsets])

    const validateSubmission = useCallback(async () => {
        if (!evaluationName) {
            message.error("Please enter evaluation name")
            return false
        }
        if (!selectedTestsetId) {
            message.error("Please select a testset")
            return false
        }
        if (selectedVariantRevisionIds.length === 0) {
            message.error("Please select app variant")
            return false
        }
        if (selectedEvalConfigs.length === 0) {
            message.error("Please select evaluator configuration")
            return false
        }
        if (
            !preview &&
            selectedEvalConfigs.some(
                (id) =>
                    evaluatorConfigs.find((config) => config.id === id)?.evaluator_key ===
                    "auto_ai_critique",
            ) &&
            (await redirectIfNoLLMKeys({secrets}))
        ) {
            message.error("LLM keys are required for AI Critique configuration")
            return false
        }

        if (selectedVariantRevisionIds.length > 0) {
            const revisions = filteredVariants?.filter((rev) =>
                selectedVariantRevisionIds.includes(rev.id),
            )
            if (!revisions?.length) {
                message.error("Please select variant")
                return false
            }

            const variantInputs = revisions
                .map((rev) => {
                    const store = getDefaultStore()
                    const flags = store.get(variantFlagsAtomFamily({revisionId: rev.id})) as any
                    const spec = store.get(appSchemaAtom) as any
                    const routePath = store.get(appUriInfoAtom)?.routePath || ""
                    const schemaKeys = spec
                        ? extractInputKeysFromSchema(spec as any, routePath)
                        : []
                    if (flags?.isCustom) {
                        return schemaKeys
                    }
                    const stableVars = store.get(stablePromptVariablesAtomFamily(rev.id)) || []
                    return Array.from(new Set(stableVars))
                })
                .flat()

            const testset = await fetchTestset(selectedTestsetId)
            if (!testset) {
                message.error("Please select a testset")
                return false
            }
            const testsetColumns = Object.keys(testset?.csvdata[0] || {})

            if (!testsetColumns.length) {
                message.error("Please select a correct testset which has testcases")
                return false
            }

            const missingColumnConfigs = selectedEvalConfigs
                .map((configId) => evaluatorConfigs.find((config) => config.id === configId))
                .filter((config) => {
                    if (!config?.settings_values?.correct_answer_key) return false
                    const expectedColumn = config.settings_values.correct_answer_key
                    return !testsetColumns.includes(expectedColumn)
                })

            if (missingColumnConfigs.length > 0) {
                const missingColumns = missingColumnConfigs
                    .map((config) => config?.settings_values?.correct_answer_key)
                    .filter(Boolean)
                    .join(", ")
                message.error(
                    `Please select a testset that has the required expected answer columns: ${missingColumns}`,
                )
                return false
            }

            if (variantInputs.length > 0) {
                const isInputParamsAndTestsetColumnsMatch = variantInputs.every((input) => {
                    return testsetColumns.includes(input)
                })
                if (!isInputParamsAndTestsetColumnsMatch) {
                    message.error(
                        "The testset columns do not match the selected variant input parameters",
                    )
                    return false
                }
            }
        }
        return true
    }, [
        selectedTestsetId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        evaluatorConfigs,
        secrets,
        preview,
        evaluationName,
        filteredVariants,
    ])

    const handleSubmit = useCallback(async () => {
        setSubmitLoading(true)
        try {
            if (!(await validateSubmission())) return

            const targetAppId = selectedAppId || appId
            if (!targetAppId) {
                message.error("Please select an application")
                setSubmitLoading(false)
                return
            }

            const revisions = filteredVariants
            const {correct_answer_column, ...rateLimitValues} = advanceSettings

            if (preview) {
                const evalDataSource = evaluators
                const selectionData = {
                    name: evaluationName,
                    revisions: revisions
                        ?.filter((rev) => selectedVariantRevisionIds.includes(rev.id))
                        .filter(Boolean),
                    testset: testsets?.find((testset) => testset._id === selectedTestsetId),
                    evaluators: selectedEvalConfigs
                        .map((id) => (evalDataSource || []).find((config) => config.id === id))
                        .filter(Boolean),
                    rate_limit: rateLimitValues,
                    correctAnswerColumn: correct_answer_column,
                }

                if (
                    !selectionData.revisions?.length ||
                    !selectionData.testset ||
                    !selectionData.evaluators?.length ||
                    (evaluationType === "human" && !evaluationName)
                ) {
                    message.error(
                        `Please select a testset, app variant, ${
                            evaluationType === "human" ? "evaluation name, and" : " and"
                        } evaluator configuration.`,
                    )
                    setSubmitLoading(false)
                    return
                }

                const data = await createPreviewEvaluationRun(structuredClone(selectionData))
                const runId = data.run.runs[0].id
                const scope = isAppScoped ? "app" : "project"
                const targetPath = buildEvaluationNavigationUrl({
                    scope,
                    baseAppURL,
                    projectURL,
                    appId: targetAppId,
                    path: `/evaluations/single_model_test/${runId}`,
                })

                if (scope === "project") {
                    router.push({
                        pathname: targetPath,
                        query: targetAppId ? {app_id: targetAppId} : undefined,
                    })
                } else {
                    router.push(targetPath)
                }
            } else {
                await createEvaluation(targetAppId, {
                    testset_id: selectedTestsetId,
                    revisions_ids: selectedVariantRevisionIds,
                    evaluators_configs: selectedEvalConfigs,
                    rate_limit: rateLimitValues,
                    correct_answer_column: correct_answer_column,
                    name: evaluationName,
                })
                onSuccess?.()
            }
        } catch (error) {
            console.error(error)
        } finally {
            setSubmitLoading(false)
        }
    }, [
        validateSubmission,
        selectedAppId,
        appId,
        filteredVariants,
        advanceSettings,
        preview,
        evaluators,
        evaluationName,
        selectedVariantRevisionIds,
        testsets,
        selectedTestsetId,
        selectedEvalConfigs,
        evaluationType,
        createPreviewEvaluationRun,
        isAppScoped,
        baseAppURL,
        projectURL,
        router,
        onSuccess,
    ])

    useEffect(() => {
        if (!open) {
            onRegisterSubmit(noopSubmit)
            return
        }
        onRegisterSubmit(handleSubmit)
        return () => {
            onRegisterSubmit(noopSubmit)
        }
    }, [open, handleSubmit, onRegisterSubmit])

    const appSelectionComplete = Boolean(selectedAppId)
    const hasAppOptions = appOptions.length > 0

    const handleCreateApp = useCallback(() => {
        redirectUrl()
    }, [redirectUrl])

    const selectedTestset = useMemo(
        () => filteredTestsets.find((ts) => ts._id === selectedTestsetId) || null,
        [filteredTestsets, selectedTestsetId],
    )

    const selectedVariants = useMemo(
        () => filteredVariants?.filter((v) => selectedVariantRevisionIds.includes(v.id)) || [],
        [filteredVariants, selectedVariantRevisionIds],
    )

    const selectedEvalConfig = useMemo(() => {
        const source = preview ? (evaluators as any[]) : (evaluatorConfigs as any[])
        return source.filter((cfg) => selectedEvalConfigs.includes(cfg.id))
    }, [preview, evaluators, evaluatorConfigs, selectedEvalConfigs])

    const tabs = useMemo(() => {
        const requireAppMessage = (
            <Typography.Text type="secondary">
                Select an application first to load this section.
            </Typography.Text>
        )

        return [
            {
                key: "appPanel",
                label: (
                    <TabLabel tabTitle="Application" completed={appSelectionComplete}>
                        {appSelectionComplete && (
                            <Tag
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    if (!isAppScoped) handleAppSelection("")
                                }}
                            >
                                {appOptions.find((opt) => opt.value === selectedAppId)?.label ??
                                    selectedAppId}
                            </Tag>
                        )}
                    </TabLabel>
                ),
                children: (
                    <div className="flex flex-col gap-2">
                        {hasAppOptions ? (
                            <>
                                <SelectAppSection
                                    apps={appOptions}
                                    selectedAppId={selectedAppId}
                                    onSelectApp={handleAppSelection}
                                    disabled={isAppScoped}
                                />
                                {!appSelectionComplete && !isAppScoped ? (
                                    <Typography.Text type="secondary">
                                        Please select an application to continue configuring the
                                        evaluation.
                                    </Typography.Text>
                                ) : null}
                            </>
                        ) : (
                            <NoResultsFound
                                title="No applications found"
                                description="You need at least one application to configure an evaluation. Head to App Management to create one."
                                primaryActionLabel="Create an app"
                                onPrimaryAction={handleCreateApp}
                            />
                        )}
                    </div>
                ),
            },
            {
                key: "variantPanel",
                label: (
                    <TabLabel tabTitle="Variant" completed={selectedVariants.length > 0}>
                        {selectedVariants.map((v) => (
                            <Tag
                                key={v.id}
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    setSelectedVariantRevisionIds((prev) =>
                                        prev.filter((id) => id !== v.id),
                                    )
                                }}
                            >
                                {`${v.variantName} - v${v.revision}`}
                            </Tag>
                        ))}
                    </TabLabel>
                ),
                children: appSelectionComplete ? (
                    <SelectVariantSection
                        handlePanelChange={handlePanelChange}
                        selectedVariantRevisionIds={selectedVariantRevisionIds}
                        setSelectedVariantRevisionIds={setSelectedVariantRevisionIds}
                        evaluationType={evaluationType}
                        variants={filteredVariants}
                        isVariantLoading={variantsLoading}
                        className="pt-2"
                        selectedTestsetId={selectedTestsetId}
                    />
                ) : (
                    requireAppMessage
                ),
            },
            {
                key: "testsetPanel",
                label: (
                    <TabLabel tabTitle="Testset" completed={selectedTestset !== null}>
                        {selectedTestset ? (
                            <Tag
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    setSelectedTestsetId("")
                                }}
                            >
                                {selectedTestset.name}
                            </Tag>
                        ) : null}
                    </TabLabel>
                ),
                children: appSelectionComplete ? (
                    <SelectTestsetSection
                        handlePanelChange={handlePanelChange}
                        selectedTestsetId={selectedTestsetId}
                        setSelectedTestsetId={setSelectedTestsetId}
                        testsets={filteredTestsets}
                        selectedVariantRevisionIds={selectedVariantRevisionIds}
                        className="pt-2"
                    />
                ) : (
                    requireAppMessage
                ),
            },
            {
                key: "evaluatorPanel",
                label: (
                    <TabLabel tabTitle="Evaluators" completed={selectedEvalConfig.length > 0}>
                        {selectedEvalConfig.map((config) => (
                            <Tag
                                key={config.id}
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    setSelectedEvalConfigs((prev) =>
                                        prev.filter((id) => id !== config.id),
                                    )
                                }}
                            >
                                {config.name}
                            </Tag>
                        ))}
                    </TabLabel>
                ),
                children: appSelectionComplete ? (
                    <SelectEvaluatorSection
                        handlePanelChange={handlePanelChange}
                        selectedEvalConfigs={selectedEvalConfigs}
                        setSelectedEvalConfigs={setSelectedEvalConfigs}
                        preview={preview}
                        evaluators={evaluators as any}
                        evaluatorConfigs={evaluatorConfigs}
                        selectedAppId={selectedAppId}
                        className="pt-2"
                    />
                ) : (
                    requireAppMessage
                ),
            },
            {
                key: "advancedSettingsPanel",
                label: <TabLabel tabTitle="Advanced" completed={false} />, // completion not required
                children: (
                    <AdvancedSettings
                        advanceSettings={advanceSettings}
                        setAdvanceSettings={setAdvanceSettings}
                        preview={preview}
                        className="pt-2"
                    />
                ),
            },
        ]
    }, [
        appSelectionComplete,
        appOptions,
        selectedAppId,
        handleAppSelection,
        hasAppOptions,
        handleCreateApp,
        selectedVariants,
        selectedVariantRevisionIds,
        evaluationType,
        filteredVariants,
        variantsLoading,
        selectedTestsetId,
        filteredTestsets,
        selectedEvalConfig,
        selectedEvalConfigs,
        evaluators,
        evaluatorConfigs,
        preview,
        advanceSettings,
    ])

    return (
        <div className={clsx("flex min-h-[540px] flex-col gap-4", className)} {...rest}>
            <div className="flex flex-col gap-2">
                <Input
                    placeholder="Evaluation name"
                    ref={inputRef}
                    value={evaluationName}
                    onChange={(event) => setEvaluationName(event.target.value)}
                />
                <Typography.Text type="secondary">
                    Give your evaluation a meaningful name to find it later.
                </Typography.Text>
            </div>
            <Tabs
                className={clsx("flex-1 min-h-0", classes.tabs)}
                items={tabs}
                activeKey={activePanel ?? undefined}
                onChange={handlePanelChange}
                destroyInactiveTabPane={false}
            />
        </div>
    )
}

export default memo(NewEvaluationModalContent)
