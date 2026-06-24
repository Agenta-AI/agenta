import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    countMatchingTraces,
    createSimpleQuery,
    invalidateQueryCache,
    queryMolecule,
    type QueryRevision,
    type SimpleQueryCreate,
} from "@agenta/entities/query"
import {EntityCommitModal, type EntityReference} from "@agenta/entity-ui/modals"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {Button, Form, Input, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {
    fromFilteringPayload,
    parseSamplingRate,
    toFilteringPayload,
    toWindowingPayload,
} from "@/oss/components/pages/evaluations/onlineEvaluation/assets/helpers"
import QueryEditor from "@/oss/components/pages/evaluations/onlineEvaluation/components/QueryEditor"
import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"
import type {Filter} from "@/oss/lib/Types"
import type {
    QueryFilteringPayload,
    QueryRevisionDataPayload,
} from "@/oss/services/onlineEvaluations/api"

import {queryRegistryActiveRowAtom} from "../store/queryRegistryFilterAtoms"
import {invalidateQueryRegistryStore} from "../store/queryRegistryStore"

import QueryTracePreview from "./QueryTracePreview"

const {Text} = Typography

type MatchState =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "done"; count: number}
    | {status: "error"}

const MATCH_DEBOUNCE_MS = 400

/**
 * Manage drawer for a single query. Reuses the shared QueryEditor (filter +
 * sampling) inside its own Form context, hydrating from the SimpleQuery row the
 * registry already loaded (no re-fetch). Edit commits a new head revision;
 * create makes a new query. A live debounced match-count (D3) executes the
 * in-progress filter against the trace store so an empty filter is caught at
 * edit time.
 */
const QueryRegistryDrawer = () => {
    const projectId = useAtomValue(projectIdAtom)
    const [activeRow, setActiveRow] = useAtom(queryRegistryActiveRowAtom)
    const [form] = Form.useForm()
    const filterColumns = useMemo(() => getFilterColumns(), [])
    const [filters, setFilters] = useState<Filter[]>([])
    const [saving, setSaving] = useState(false)
    const [matchState, setMatchState] = useState<MatchState>({status: "idle"})
    const [showPreview, setShowPreview] = useState(false)
    // Edits commit through the shared EntityCommitModal (version diff + message).
    const [commitOpen, setCommitOpen] = useState(false)

    const watchedName = Form.useWatch("name", form)
    const watchedRate = Form.useWatch("sampling_rate", form)

    const open = activeRow !== null
    const queryId = activeRow?.queryId ?? ""
    const isCreate = !activeRow?.queryId

    // Edit mode is backed by the query molecule (committed head revision + draft).
    // It owns the real, semantic dirty diff and the commit; create stays on the
    // one-shot createSimpleQuery path.
    const [editState] = queryMolecule.useController(queryId)
    const syncDraft = useSetAtom(queryMolecule.reducers.update)
    const discardDraft = useSetAtom(queryMolecule.reducers.discard)

    // Stable reference the shared commit modal resolves through the query adapter.
    const commitEntity = useMemo<EntityReference>(() => ({type: "query", id: queryId}), [queryId])

    // Stable filtering payload for the preview — recomputed only when the filter
    // conditions change, so the preview table doesn't refetch on every render.
    const previewFiltering = useMemo(() => toFilteringPayload(filters), [filters])

    // Create: enabled once a name is typed. Edit: the molecule's semantic isDirty.
    const isDirty = isCreate ? Boolean((watchedName ?? "").trim()) : editState.isDirty

    useEffect(() => {
        if (!open || !activeRow) return
        const hydratedFilters = fromFilteringPayload(
            (activeRow.filtering ?? null) as QueryFilteringPayload | null,
        )
        setFilters(hydratedFilters)
        const rawRate = (activeRow.windowing as {rate?: number} | null)?.rate
        const rate = typeof rawRate === "number" ? Math.round(rawRate * 100) : 100
        form.setFieldsValue({name: activeRow.name, sampling_rate: rate, historical: false})
    }, [open, activeRow, form])

    // Mirror the live form state into the molecule draft (edit only). The molecule
    // derives the semantic dirty diff against the committed head revision, so we
    // only sync once the server data is loaded, and skip no-op writes via a key
    // guard to avoid a render loop.
    const lastSyncedRef = useRef<string>("")
    useEffect(() => {
        if (isCreate || !open || !editState.serverData) return
        const draft = {
            name: watchedName ?? "",
            data: {
                filtering: toFilteringPayload(filters) ?? undefined,
                windowing:
                    toWindowingPayload({
                        samplingRate: parseSamplingRate(watchedRate),
                        historicalRange: undefined,
                    }) ?? undefined,
            },
        }
        const key = JSON.stringify(draft)
        if (key === lastSyncedRef.current) return
        lastSyncedRef.current = key
        // OSS filtering/windowing payloads are structurally the entity's revision
        // data; the cast bridges the two nominal package types.
        syncDraft(queryId, draft as unknown as Partial<QueryRevision>)
    }, [
        isCreate,
        open,
        editState.serverData,
        watchedName,
        watchedRate,
        filters,
        queryId,
        syncDraft,
    ])

    // D3: live debounced match-count. Executes the in-progress filter against the
    // trace store so a filter that matches nothing is caught at edit time. Cancels
    // the in-flight request on every keystroke via AbortController.
    useEffect(() => {
        if (!open || !projectId) {
            setMatchState({status: "idle"})
            return
        }
        // No conditions = no filter (would count every trace), so show nothing
        // until the user actually builds a filter.
        const filtering = toFilteringPayload(filters)
        if (!filtering) {
            setMatchState({status: "idle"})
            return
        }
        const controller = new AbortController()
        setMatchState({status: "loading"})
        const timer = setTimeout(() => {
            countMatchingTraces({projectId, filtering, abortSignal: controller.signal})
                .then((count) => setMatchState({status: "done", count: count ?? 0}))
                .catch(() => {
                    if (controller.signal.aborted) return
                    setMatchState({status: "error"})
                })
        }, MATCH_DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [open, projectId, filters])

    const close = useCallback(() => {
        if (queryId) discardDraft(queryId)
        lastSyncedRef.current = ""
        setActiveRow(null)
        setFilters([])
        setMatchState({status: "idle"})
        setShowPreview(false)
        setCommitOpen(false)
        form.resetFields()
    }, [setActiveRow, form, queryId, discardDraft])

    let matchLabel: string | null = null
    let matchIsEmpty = false
    if (matchState.status === "loading") {
        matchLabel = "Matching…"
    } else if (matchState.status === "error") {
        matchLabel = "Couldn't check matches"
    } else if (matchState.status === "done") {
        matchIsEmpty = matchState.count === 0
        matchLabel = matchIsEmpty
            ? "0 traces match — this filter is empty"
            : `~${matchState.count} trace${matchState.count === 1 ? "" : "s"} match`
    }

    const handleSave = useCallback(async () => {
        if (!projectId || !activeRow) return

        let values: {name: string; sampling_rate?: unknown}
        try {
            values = await form.validateFields()
        } catch {
            return // antd surfaces field errors inline
        }

        const filtering = toFilteringPayload(filters)
        const windowing = toWindowingPayload({
            samplingRate: parseSamplingRate(values.sampling_rate),
            historicalRange: undefined,
        })

        if (isCreate) {
            const data: QueryRevisionDataPayload = {}
            if (filtering) data.filtering = filtering
            if (windowing) data.windowing = windowing
            const dataField = Object.keys(data).length ? data : undefined
            setSaving(true)
            try {
                await createSimpleQuery({
                    projectId,
                    query: {
                        name: values.name,
                        ...(dataField ? {data: dataField as SimpleQueryCreate["data"]} : {}),
                    },
                })
                message.success("Query created")
                invalidateQueryRegistryStore()
                invalidateQueryCache()
                close()
            } catch {
                message.error("Could not create query")
            } finally {
                setSaving(false)
            }
            return
        }

        // Edit: flush the validated values into the molecule draft, then open the
        // shared commit modal (it reads the draft via the query adapter and lets
        // the user attach a commit message before committing).
        syncDraft(queryId, {
            name: values.name,
            data: {filtering: filtering ?? undefined, windowing: windowing ?? undefined},
        } as unknown as Partial<QueryRevision>)
        setCommitOpen(true)
    }, [projectId, activeRow, form, filters, isCreate, close, queryId, syncDraft])

    // After the shared modal commits (it already cleared the molecule draft and
    // entity cache), refresh the registry list and close the drawer.
    const onCommitSuccess = useCallback(() => {
        invalidateQueryRegistryStore()
        invalidateQueryCache()
        setCommitOpen(false)
        close()
    }, [close])

    return (
        <>
            <EnhancedDrawer
                title={<span>{isCreate ? "New query" : "Edit query"}</span>}
                open={open}
                onClose={close}
                width={showPreview ? 960 : 520}
                destroyOnHidden
                closeOnLayoutClick={false}
                styles={{body: {padding: 0}, footer: {padding: 8}}}
                footer={
                    <div className="flex w-full items-center justify-end gap-2">
                        <Button onClick={close}>Cancel</Button>
                        <Button
                            type="primary"
                            onClick={handleSave}
                            loading={saving}
                            disabled={!isDirty}
                        >
                            {isCreate ? "Create" : "Save"}
                        </Button>
                    </div>
                }
            >
                <Form
                    form={form}
                    layout="vertical"
                    requiredMark={false}
                    className="p-4"
                    initialValues={{historical: false, sampling_rate: 100}}
                >
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[{required: true, message: "Enter a name"}]}
                    >
                        <Input placeholder="Query name" />
                    </Form.Item>
                    <QueryEditor
                        inlineFilters
                        filters={filters}
                        onFiltersChange={setFilters}
                        filterColumns={filterColumns}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                        {matchLabel ? (
                            <div aria-live="polite">
                                <Text
                                    type={matchIsEmpty ? "warning" : "secondary"}
                                    className="text-xs"
                                >
                                    {matchLabel}
                                </Text>
                            </div>
                        ) : (
                            <span />
                        )}
                        <Button
                            type="link"
                            size="small"
                            className="px-0 text-xs"
                            onClick={() => setShowPreview((v) => !v)}
                        >
                            {showPreview ? "Hide matching traces" : "Show matching traces"}
                        </Button>
                    </div>
                </Form>
                {showPreview ? (
                    <div className="flex h-[360px] flex-col border-t border-solid border-[var(--ant-color-border-secondary)]">
                        <QueryTracePreview projectId={projectId} filtering={previewFiltering} />
                    </div>
                ) : null}
            </EnhancedDrawer>
            {/* Shared entity commit modal — version transition + filtering/windowing
                diff + message. Name editing and the save-mode/new-variant flow are
                intentionally omitted (the drawer owns the name; queries are
                single-variant). */}
            <EntityCommitModal
                open={commitOpen}
                entity={commitEntity}
                onClose={() => setCommitOpen(false)}
                onSuccess={onCommitSuccess}
                successMessage="Query updated"
            />
        </>
    )
}

export default QueryRegistryDrawer
