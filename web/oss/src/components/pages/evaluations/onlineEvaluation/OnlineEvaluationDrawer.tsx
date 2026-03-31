import {useCallback, useEffect, useMemo, useState} from "react"
import type {ReactNode} from "react"

import {message} from "@agenta/ui/app-message"
import {Button, Collapse, DatePicker, Form, Input, Select, Switch, Tooltip, Typography} from "antd"
import dayjs from "dayjs"
import type {Dayjs} from "dayjs"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {v4 as uuidv4} from "uuid"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"
import {evaluatorConfigsAtom} from "@/oss/lib/atoms/evaluation"
import {getColorPairFromStr} from "@/oss/lib/helpers/colors"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import type {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import type {Evaluator, Filter} from "@/oss/lib/Types"

import {
    createSimpleEvaluation,
    createSimpleQuery,
    retrieveQueryRevision,
    type QueryRevisionDataPayload,
    type SimpleEvaluationCreatePayload,
    type SimpleQueryCreatePayload,
} from "../../../../services/onlineEvaluations/api"

import {
    buildQuerySlug,
    parseSamplingRate,
    toFilteringPayload,
    toWindowingPayload,
} from "./assets/helpers"
import {onlineEvalFiltersAtom, resetOnlineEvalFiltersAtom} from "./assets/state"
import {useDrawerStyles} from "./assets/styles"
import EvaluatorDetailsPreview from "./components/EvaluatorDetailsPreview"
import EvaluatorTypeTag from "./components/EvaluatorTypeTag"
import SamplingRateControl from "./components/SamplingRateControl"
import {useEvaluatorDetails} from "./hooks/useEvaluatorDetails"
import {useEvaluatorSelection} from "./hooks/useEvaluatorSelection"
import {useEvaluatorTypeFromConfigs} from "./hooks/useEvaluatorTypeFromConfigs"
import {capitalize} from "./utils/evaluatorDetails"

interface OnlineEvaluationDrawerProps {
    open: boolean
    onClose: () => void
    onCreate?: (values: any) => void | Promise<void>
}

const {Text, Link: TypographyLink} = Typography
const {RangePicker} = DatePicker
const Filters = dynamic(() => import("@/oss/components/Filters/Filters"), {ssr: false})

const OnlineEvaluationDrawer = ({open, onClose, onCreate}: OnlineEvaluationDrawerProps) => {
    const {evaluatorsSwr: baseEvaluatorsSwr} = useFetchEvaluatorsData({appId: ""})
    const queryClient = useAtomValue(queryClientAtom)
    const classes = useDrawerStyles()
    const [form] = Form.useForm()
    const filterColumns = useMemo(() => getFilterColumns(), [])
    const [filters, setFilters] = useAtom(onlineEvalFiltersAtom)
    const resetFilters = useSetAtom(resetOnlineEvalFiltersAtom)
    // Load preview evaluators (with IDs) to map config URI key -> evaluator.id
    const previewEvaluatorsSwr = useEvaluators({preview: true, queries: {is_human: false}})
    const baseEvaluators = (baseEvaluatorsSwr.data as Evaluator[] | undefined) ?? []
    const evaluators = useAtomValue(evaluatorConfigsAtom)
    const previewEvaluators = (previewEvaluatorsSwr.data as EvaluatorPreviewDto[] | undefined) ?? []
    const selectedEvaluatorId = Form.useWatch("evaluator", form)
    const samplingRate = Form.useWatch("sampling_rate", form)
    const isHistorical = Form.useWatch("historical", form) ?? false
    const [isSubmitting, setIsSubmitting] = useState(false)
    const router = useRouter()

    const {
        evaluatorOptions,
        selectedEvaluatorConfig,
        matchedPreviewEvaluator,
        evaluatorTypeLookup,
    } = useEvaluatorSelection({
        evaluators: evaluators || [],
        selectedEvaluatorId,
        previewEvaluators,
        baseEvaluators,
    })

    // Auto-generate name when evaluator is selected
    useEffect(() => {
        if (!selectedEvaluatorId) return
        const selectedOption = evaluatorOptions.find(
            (option) => option?.value === selectedEvaluatorId,
        )
        const fullEvaluator =
            matchedPreviewEvaluator && matchedPreviewEvaluator.id === selectedEvaluatorId
                ? matchedPreviewEvaluator
                : selectedEvaluatorConfig

        // Generate automatic name if name field is empty
        const currentName = form.getFieldValue("name")
        if (!currentName && selectedOption?.label) {
            const evaluatorName =
                typeof selectedOption.label === "string"
                    ? selectedOption.label
                    : fullEvaluator?.name || "Evaluation"
            const randomSuffix = Math.random().toString(36).substring(2, 6)
            const generatedName = `${evaluatorName}-${randomSuffix}`
            form.setFieldsValue({name: generatedName})
        }

        console.log("[OnlineEvaluationDrawer] Evaluator selected", {
            evaluatorId: selectedEvaluatorId,
            evaluatorLabel: selectedOption?.label,
            evaluatorOption: selectedOption,
            evaluatorConfig: fullEvaluator,
        })
    }, [
        selectedEvaluatorId,
        evaluatorOptions,
        matchedPreviewEvaluator,
        selectedEvaluatorConfig,
        form,
    ])

    const evaluatorDetails = useEvaluatorDetails({
        evaluator: matchedPreviewEvaluator as any,
        config: selectedEvaluatorConfig,
        evaluatorTypeLookup,
    })

    const hasParameters = evaluatorDetails.visibleParameters.length > 0

    // Config-derived label/color with meta fallback
    const evaluatorReferenceForType = matchedPreviewEvaluator ?? selectedEvaluatorConfig
    const {label: cfgLabel, color: cfgColor} = useEvaluatorTypeFromConfigs({
        evaluator: evaluatorReferenceForType,
    })
    const evaluatorTypeColors = useMemo(
        () =>
            !cfgColor && evaluatorDetails.typeSlug
                ? getColorPairFromStr(evaluatorDetails.typeSlug)
                : undefined,
        [cfgColor, evaluatorDetails.typeSlug],
    )
    const finalTypeColor = cfgColor ?? evaluatorDetails.typeColor
    const finalTypeLabel = useMemo(() => {
        if (cfgLabel) return cfgLabel
        if (evaluatorDetails.typeLabel) return evaluatorDetails.typeLabel
        if (evaluatorDetails.typeSlug)
            return capitalize(evaluatorDetails.typeSlug.replace(/_/g, " "))
        return undefined
    }, [cfgLabel, evaluatorDetails.typeLabel, evaluatorDetails.typeSlug])

    const hasEvaluatorType = Boolean(finalTypeLabel)
    const hasModel = Boolean(evaluatorDetails.model)
    const hasPrompt = evaluatorDetails.promptSections.length > 0
    const hasOutputs = (evaluatorDetails.outputs?.length ?? 0) > 0
    const isLoadingEvaluators =
        previewEvaluatorsSwr.isLoading ||
        previewEvaluatorsSwr.isPending ||
        baseEvaluatorsSwr.isLoading ||
        baseEvaluatorsSwr.isPending
    const hasEvaluatorOptions = evaluatorOptions.length > 0
    const workspaceId = useMemo(() => {
        const value = router.query.workspace_id
        if (Array.isArray(value)) return value[0]
        return typeof value === "string" ? value : undefined
    }, [router.query.workspace_id])
    const projectId = useMemo(() => {
        const value = router.query.project_id
        if (Array.isArray(value)) return value[0]
        return typeof value === "string" ? value : undefined
    }, [router.query.project_id])

    const invalidateUseEvaluatorsQueries = useCallback(async () => {
        if (!queryClient) return
        try {
            await queryClient.invalidateQueries({queryKey: ["evaluators"] as const})
            if (process.env.NODE_ENV !== "production") {
                console.debug("[OnlineEvaluationDrawer] invalidated useEvaluators queries")
            }
        } catch (err) {
            if (process.env.NODE_ENV !== "production") {
                console.warn(
                    "[OnlineEvaluationDrawer] failed to invalidate useEvaluators queries",
                    err,
                )
            }
        }
    }, [queryClient])
    const evaluatorRegistryHref = useMemo(() => {
        if (!workspaceId || !projectId) return undefined
        return `/w/${workspaceId}/p/${projectId}/evaluators`
    }, [workspaceId, projectId])

    useEffect(() => {
        if (isHistorical) {
            const currentRange: Dayjs[] | undefined = form.getFieldValue("historical_range")
            if (!currentRange || currentRange.length !== 2) {
                const end = dayjs()
                const start = end.subtract(7, "day")
                form.setFieldsValue({historical_range: [start, end]})
            }
        } else {
            form.setFieldsValue({historical_range: undefined})
        }
    }, [form, isHistorical])

    useEffect(() => {
        if (!open) {
            form.resetFields()
            resetFilters()
        }
    }, [open, form, resetFilters])

    const handleSubmit = async () => {
        if (!hasEvaluatorOptions) {
            message.info(
                "Add a supported evaluator (LLM-as-a-judge, Code, Regex test, or Webhook test) in the Evaluator Registry before creating a live evaluation.",
            )
            return
        }
        setIsSubmitting(true)
        try {
            const values = await form.validateFields()
            const samplingRateValue = parseSamplingRate(values.sampling_rate)
            const payload: Record<string, any> = {
                ...values,
                filters,
            }
            if (hasEvaluatorType) {
                payload.evaluator_type =
                    evaluatorDetails.typeSlug ?? evaluatorDetails.typeLabel ?? undefined
            }
            if (hasParameters && Object.keys(evaluatorDetails.parameterPayload).length > 0) {
                payload.parameters = evaluatorDetails.parameterPayload
            }
            if (hasModel) {
                payload.model = evaluatorDetails.model
            }
            if (hasPrompt) {
                payload.prompt = evaluatorDetails.promptSections
                    .map((section, idx) => {
                        const title = section.label || section.role || `Message ${idx + 1}`
                        const lines = [title]
                        if (
                            section.role &&
                            section.label &&
                            section.role.toLowerCase() !== section.label.toLowerCase()
                        ) {
                            lines[0] = `${section.label} (${section.role})`
                        }
                        if (section.content) {
                            lines.push(section.content)
                        }
                        if (section.attachments.length) {
                            section.attachments.forEach((attachment, attachmentIdx) => {
                                lines.push(`Attachment ${attachmentIdx + 1}: ${attachment.url}`)
                            })
                        }
                        return lines.filter(Boolean).join("\n")
                    })
                    .join("\n\n")
            }
            if (hasOutputs) {
                payload.outputs = evaluatorDetails.outputs.map((metric) => ({
                    name: metric.name,
                    type: metric.type,
                    required: metric.required,
                    description: metric.description,
                }))
            }

            let historicalRangeIso: string[] | undefined
            if (isHistorical) {
                const range: Dayjs[] | undefined = form.getFieldValue("historical_range")
                if (range && range.length === 2) {
                    historicalRangeIso = range.map((date) => date?.toISOString())
                    payload.historical_range = historicalRangeIso
                }
            }

            const filteringPayload = toFilteringPayload(filters)
            const windowingPayload = toWindowingPayload({
                samplingRate: samplingRateValue,
                historicalRange: historicalRangeIso,
            })

            const querySlug = `${buildQuerySlug(values.name)}-${uuidv4().slice(0, 8)}`
            const queryPayload: SimpleQueryCreatePayload = {
                slug: querySlug,
                name: values.name,
                description: values.description,
            }

            const queryData: QueryRevisionDataPayload = {}
            if (filteringPayload) {
                queryData.filtering = filteringPayload
            }
            if (windowingPayload) {
                queryData.windowing = windowingPayload
            }
            if (Object.keys(queryData).length) {
                queryPayload.data = queryData
            }

            const queryResponse = await createSimpleQuery({query: queryPayload})
            const queryId = queryResponse.query?.id
            if (!queryId) {
                throw new Error("Unable to create query for online evaluation.")
            }

            const revisionResponse = await retrieveQueryRevision({
                query_ref: {id: queryId},
            })
            const queryRevisionId = revisionResponse.query_revision?.id
            if (!queryRevisionId) {
                throw new Error("Unable to resolve query revision for online evaluation.")
            }

            // Prefer preview evaluator artifact id; fall back to selected config id if preview not available
            const evaluatorStepId =
                selectedEvaluatorId ??
                (selectedEvaluatorConfig as any)?.id ??
                matchedPreviewEvaluator?.id

            if (!evaluatorStepId) {
                throw new Error("Please select an evaluator.")
            }

            const evaluationPayload: SimpleEvaluationCreatePayload = {
                name: values.name,
                description: values.description,
                flags: {
                    is_live: true,
                    is_closed: false,
                    is_active: false,
                },
                data: {
                    status: "pending",
                    // Per API docs, use arrays of IDs for steps
                    query_steps: {[queryRevisionId]: "auto"},
                    evaluator_steps: {[evaluatorStepId]: "auto"},
                    repeats: 1,
                },
            }

            if (process.env.NODE_ENV !== "production") {
                console.debug("[OnlineEvaluationDrawer] submission payload", {
                    queryPayload,
                    queryRevisionId,
                    evaluatorStepId,
                    evaluationPayload,
                    selectedEvaluatorConfig,
                    matchedPreviewEvaluator,
                })
            }

            const evaluationResponse = await createSimpleEvaluation({
                evaluation: evaluationPayload,
            })
            const evaluation = evaluationResponse.evaluation
            if (!evaluation?.id) {
                throw new Error("Failed to create online evaluation.")
            }

            if (process.env.NODE_ENV !== "production") {
                console.debug("[OnlineEvaluationDrawer] evaluation created", {
                    evaluation,
                })
            }
            message.success("Online evaluation created")
            await onCreate?.(evaluation)
            await invalidateUseEvaluatorsQueries()
            onClose()
        } catch (error) {
            const err = error as Error & {errorFields?: unknown}
            if (err && "errorFields" in err) {
                return
            }
            message.error(err?.message || "Failed to create online evaluation")
        } finally {
            setIsSubmitting(false)
        }
    }

    const evaluatorSummary = useMemo<ReactNode>(() => {
        if (!selectedEvaluatorConfig) return undefined
        const displayName =
            selectedEvaluatorConfig.name || selectedEvaluatorConfig?.slug || "Evaluator"
        return (
            <div className="flex items-center gap-2">
                <span className="text-xs text-[#1D2939] font-medium">{displayName}</span>
                <EvaluatorTypeTag
                    label={finalTypeLabel}
                    color={finalTypeColor}
                    fallback={evaluatorTypeColors}
                />
            </div>
        )
    }, [selectedEvaluatorConfig, finalTypeLabel, finalTypeColor, evaluatorTypeColors])

    const querySummary = useMemo<ReactNode>(() => {
        const summaryParts: string[] = []
        summaryParts.push(
            filters.length
                ? `${filters.length} filter${filters.length === 1 ? "" : "s"}`
                : "No filters",
        )
        const rateValue =
            typeof samplingRate === "number"
                ? samplingRate
                : typeof samplingRate === "string" && samplingRate.trim() !== ""
                  ? samplingRate
                  : undefined
        if (rateValue !== undefined) {
            summaryParts.push(`Sampling ${rateValue}%`)
        }
        summaryParts.push("Live traffic")
        return <span className="text-xs text-[#475467]">{summaryParts.join(" • ")}</span>
    }, [filters.length, samplingRate])

    const buildPanelHeader = (title: string, summary?: ReactNode) => (
        <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[#101828] font-normal">{title}</span>
            {summary ? <div className="flex items-center gap-2">{summary}</div> : null}
        </div>
    )

    return (
        <EnhancedDrawer
            title={<span>Online evaluation configuration</span>}
            open={open}
            onClose={onClose}
            width={520}
            destroyOnHidden
            closeOnLayoutClick={false}
            styles={{body: {padding: 0}, footer: {padding: 8}}}
            footer={
                <div className="w-full flex items-center justify-end gap-2">
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>Cancel</Button>
                        <Button
                            type="primary"
                            onClick={handleSubmit}
                            loading={isSubmitting}
                            disabled={!hasEvaluatorOptions}
                        >
                            Create online evaluation
                        </Button>
                    </div>
                </div>
            }
        >
            <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                initialValues={{historical: false, tags: [], sampling_rate: 100}}
            >
                <Collapse
                    defaultActiveKey={["general", "query", "evaluator"]}
                    bordered={false}
                    className={classes.collapse}
                    items={[
                        {
                            key: "general",
                            label: buildPanelHeader("General"),
                            style: {marginBottom: 4},
                            children: (
                                <>
                                    <Form.Item
                                        name="name"
                                        label="Name"
                                        rules={[{required: true, message: "Enter a name"}]}
                                        style={{marginBottom: 12}}
                                    >
                                        <Input
                                            className="w-full"
                                            placeholder="Testing evaluator"
                                            allowClear
                                        />
                                    </Form.Item>

                                    <Form.Item
                                        name="description"
                                        label="Description"
                                        style={{marginBottom: 12}}
                                    >
                                        <Input.TextArea
                                            rows={3}
                                            placeholder="Describe this evaluation"
                                            autoSize={{minRows: 3, maxRows: 5}}
                                        />
                                    </Form.Item>

                                    <Form.Item
                                        name="tags"
                                        label={
                                            <div className="flex items-center justify-between">
                                                <Text>
                                                    Add tags <Text type="secondary">Optional</Text>
                                                </Text>
                                            </div>
                                        }
                                        style={{marginBottom: 0}}
                                    >
                                        <Tooltip title="Feature coming soon">
                                            <Select
                                                mode="tags"
                                                className="w-full"
                                                placeholder="Coming soon"
                                                tokenSeparators={[","]}
                                                allowClear
                                                disabled
                                            />
                                        </Tooltip>
                                    </Form.Item>
                                </>
                            ),
                        },
                        {
                            key: "query",
                            label: buildPanelHeader("Query", querySummary),
                            style: {marginBottom: 4},
                            children: (
                                <>
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <Form.Item
                                            label="Run for filters"
                                            style={{marginBottom: 0}}
                                        >
                                            <Filters
                                                filterData={filters}
                                                columns={filterColumns}
                                                onApplyFilter={(newFilters: Filter[]) =>
                                                    setFilters(newFilters)
                                                }
                                                onClearFilter={(newFilters: Filter[]) =>
                                                    setFilters(newFilters)
                                                }
                                                buttonProps={{
                                                    size: "middle",
                                                    className: "!flex !items-center !gap-2",
                                                }}
                                            />
                                        </Form.Item>
                                        <Form.Item
                                            name="sampling_rate"
                                            label="Sampling rate"
                                            style={{marginBottom: 0}}
                                        >
                                            <SamplingRateControl />
                                        </Form.Item>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <Form.Item
                                                name="historical"
                                                valuePropName="checked"
                                                className="mb-0"
                                            >
                                                <Switch size="small" disabled />
                                            </Form.Item>
                                            <Tooltip title="Not available yet">
                                                <Text type="secondary">Run on historical data</Text>
                                            </Tooltip>
                                        </div>
                                        <Form.Item name="historical_range" className="mb-0">
                                            <RangePicker
                                                allowClear
                                                allowEmpty
                                                disabled
                                                className="w-[200px]"
                                                placeholder={["Start date", "End date"]}
                                            />
                                        </Form.Item>
                                    </div>
                                </>
                            ),
                        },
                        {
                            key: "evaluator",
                            label: buildPanelHeader("Evaluator", evaluatorSummary),
                            style: {marginBottom: 4},
                            children: (
                                <>
                                    <Form.Item
                                        name="evaluator"
                                        label="Evaluator"
                                        style={{marginBottom: 12}}
                                        rules={[{required: true, message: "Select an evaluator"}]}
                                    >
                                        <Select
                                            className="w-full"
                                            placeholder="Select"
                                            options={evaluatorOptions}
                                            optionLabelProp="label"
                                            disabled={!hasEvaluatorOptions}
                                            loading={isLoadingEvaluators}
                                            notFoundContent={
                                                isLoadingEvaluators
                                                    ? "Loading evaluators..."
                                                    : "No supported evaluators available"
                                            }
                                            showSearch
                                            filterOption={(input, option) => {
                                                if (!option) return false
                                                const query = input.toLowerCase()
                                                if (!query.length) return true
                                                const searchableTexts: string[] = []

                                                const searchText =
                                                    typeof (option as any)?.searchText === "string"
                                                        ? (option as any).searchText
                                                        : undefined
                                                if (searchText) {
                                                    searchableTexts.push(searchText)
                                                }
                                                if (typeof option.title === "string") {
                                                    searchableTexts.push(option.title)
                                                }
                                                if (typeof option.label === "string") {
                                                    searchableTexts.push(option.label)
                                                }
                                                if (
                                                    typeof option.value === "string" ||
                                                    typeof option.value === "number"
                                                ) {
                                                    searchableTexts.push(String(option.value))
                                                }

                                                return searchableTexts
                                                    .map((text) => text.toLowerCase())
                                                    .some((text) => text.includes(query))
                                            }}
                                            allowClear
                                        />
                                        {!isLoadingEvaluators && !hasEvaluatorOptions ? (
                                            <Text type="secondary" className="block mt-2">
                                                No supported evaluators are available. Add an
                                                evaluator configured as LLM-as-a-judge, Code, Regex
                                                test, or Webhook test to continue.
                                                {evaluatorRegistryHref ? (
                                                    <>
                                                        {" "}
                                                        <TypographyLink
                                                            href={evaluatorRegistryHref}
                                                        >
                                                            Open evaluator registry
                                                        </TypographyLink>
                                                        .
                                                    </>
                                                ) : null}
                                            </Text>
                                        ) : null}
                                    </Form.Item>

                                    <EvaluatorDetailsPreview
                                        details={evaluatorDetails}
                                        typeLabel={finalTypeLabel}
                                        typeColor={
                                            typeof finalTypeColor === "string"
                                                ? finalTypeColor
                                                : undefined
                                        }
                                        key={evaluatorDetails?.evaluator?.id}
                                        fallbackColors={evaluatorTypeColors}
                                        showType={hasEvaluatorType}
                                    />
                                </>
                            ),
                        },
                    ]}
                />
            </Form>
        </EnhancedDrawer>
    )
}

export default OnlineEvaluationDrawer
