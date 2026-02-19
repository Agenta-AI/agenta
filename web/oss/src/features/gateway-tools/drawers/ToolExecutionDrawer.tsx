import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    ArrowLeft,
    ArrowUp,
    BracketsRound,
    CopySimple,
    ListDashes,
    MagnifyingGlass,
    Play,
} from "@phosphor-icons/react"
import {
    Button,
    Card,
    Divider,
    Drawer,
    Empty,
    Form,
    Input,
    message,
    Spin,
    Segmented,
    Tag,
    Typography,
} from "antd"
import {useAtom, useSetAtom} from "jotai"
import Image from "next/image"

import type {ActionItem} from "@/oss/services/tools/api/types"

import ResultViewer from "../components/ResultViewer"
import SchemaForm from "../components/SchemaForm"
import type {SchemaFormHandle} from "../components/SchemaForm"
import {useActionDetail} from "../hooks/useActionDetail"
import {useCatalogActions, actionsSearchAtom} from "../hooks/useCatalogActions"
import {useIntegrationInfo} from "../hooks/useIntegrationInfo"
import {useToolExecution} from "../hooks/useToolExecution"
import {executionDrawerAtom} from "../state/atoms"

const DEFAULT_PROVIDER = "composio"

// ---------------------------------------------------------------------------
// Debounce helper (same pattern as CatalogDrawer)
// ---------------------------------------------------------------------------

function useDebouncedAtomSearch(setAtom: (v: string) => void, delay = 300) {
    const [local, setLocal] = useState("")
    const timerRef = useRef<ReturnType<typeof setTimeout>>()

    const onChange = useCallback(
        (v: string) => {
            setLocal(v)
            clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setAtom(v), delay)
        },
        [setAtom, delay],
    )

    const reset = useCallback(() => {
        clearTimeout(timerRef.current)
        setLocal("")
        setAtom("")
    }, [setAtom])

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return {value: local, onChange, reset}
}

// ---------------------------------------------------------------------------
// ScrollSentinel (same pattern as CatalogDrawer)
// ---------------------------------------------------------------------------

function ScrollSentinel({
    onVisible,
    hasMore,
    isFetching,
}: {
    onVisible: () => void
    hasMore: boolean
    isFetching: boolean
}) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = ref.current
        if (!el || !hasMore) return

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !isFetching) {
                    onVisible()
                }
            },
            {rootMargin: "200px"},
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [onVisible, hasMore, isFetching])

    if (!hasMore) return null

    return <div ref={ref} className="h-0 w-0" />
}

// ---------------------------------------------------------------------------
// ScrollToTopButton
// ---------------------------------------------------------------------------

function ScrollToTopButton({scrollRef}: {scrollRef: React.RefObject<HTMLDivElement | null>}) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        const onScroll = () => {
            setVisible(el.scrollTop > 300)
        }
        el.addEventListener("scroll", onScroll, {passive: true})
        return () => el.removeEventListener("scroll", onScroll)
    }, [scrollRef])

    if (!visible) return null

    return (
        <div className="sticky bottom-4 flex justify-end pointer-events-none">
            <Button
                type="default"
                shape="circle"
                icon={<ArrowUp size={16} />}
                className="pointer-events-auto shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
                onClick={() => scrollRef.current?.scrollTo({top: 0, behavior: "smooth"})}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// ToolExecutionDrawer (root)
// ---------------------------------------------------------------------------

export default function ToolExecutionDrawer() {
    const [state, setState] = useAtom(executionDrawerAtom)
    const open = !!state
    const [selectedAction, setSelectedAction] = useState<ActionItem | null>(null)
    const setActionsSearch = useSetAtom(actionsSearchAtom)

    // Fetch integration info as fallback when name/logo not in state
    const {integration} = useIntegrationInfo(state?.integrationKey ?? "")
    const integrationName = state?.integrationName ?? integration?.name
    const integrationLogo = state?.integrationLogo ?? integration?.logo

    // If actionKey is pre-set in state, start at step 2
    const step = state?.actionKey || selectedAction ? 2 : 1
    const activeActionKey = state?.actionKey ?? selectedAction?.key ?? ""

    const handleClose = useCallback(() => {
        setState(null)
        setSelectedAction(null)
        setActionsSearch("")
    }, [setState, setActionsSearch])

    const handleBack = useCallback(() => {
        setSelectedAction(null)
        setActionsSearch("")
    }, [setActionsSearch])

    const handleSelectAction = useCallback((action: ActionItem) => {
        setSelectedAction(action)
    }, [])

    const drawerTitle = step === 2 ? "Test Action" : "Select Action"

    return (
        <Drawer
            open={open}
            onClose={handleClose}
            title={drawerTitle}
            width={640}
            destroyOnClose
            styles={{
                body: {
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                },
            }}
        >
            {state &&
                (step === 1 ? (
                    <ActionPickerStep
                        integrationKey={state.integrationKey}
                        integrationName={integrationName}
                        integrationLogo={integrationLogo}
                        connectionSlug={state.connectionSlug}
                        onSelectAction={handleSelectAction}
                    />
                ) : (
                    <ActionDetailStep
                        integrationKey={state.integrationKey}
                        integrationName={integrationName}
                        integrationLogo={integrationLogo}
                        connectionSlug={state.connectionSlug}
                        actionKey={activeActionKey}
                        actionName={selectedAction?.name}
                        canGoBack={!state.actionKey}
                        onBack={handleBack}
                    />
                ))}
        </Drawer>
    )
}

// ---------------------------------------------------------------------------
// Step 1: Action Picker (infinite scroll)
// ---------------------------------------------------------------------------

function ActionPickerStep({
    integrationKey,
    integrationName,
    integrationLogo,
    connectionSlug,
    onSelectAction,
}: {
    integrationKey: string
    integrationName?: string
    integrationLogo?: string
    connectionSlug: string
    onSelectAction: (action: ActionItem) => void
}) {
    const setAtom = useSetAtom(actionsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)

    const {
        actions,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useCatalogActions(integrationKey)

    const sentinelIndex = useMemo(
        () => Math.max(0, actions.length - prefetchThreshold),
        [actions.length, prefetchThreshold],
    )

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Sticky header */}
            <div className="flex flex-col gap-3 px-6 pt-4 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                    {integrationLogo && (
                        <Image
                            src={integrationLogo}
                            alt={integrationName}
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded object-contain shrink-0"
                            unoptimized
                        />
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                        <Typography.Text strong className="truncate">
                            {integrationName || integrationKey}
                        </Typography.Text>
                        <Typography.Text type="secondary" className="text-xs truncate">
                            Connection: {connectionSlug}
                        </Typography.Text>
                    </div>
                </div>

                <Input
                    placeholder="Search actions..."
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onChange={(e) => search.onChange(e.target.value)}
                    allowClear
                    onClear={() => search.onChange("")}
                />

                <Typography.Text type="secondary" className="text-xs">
                    {total} action{total !== 1 ? "s" : ""}
                </Typography.Text>
            </div>

            <Divider className="!m-0" />

            {/* Scrollable content */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-3 relative">
                {isLoading && actions.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <Spin />
                    </div>
                ) : actions.length === 0 ? (
                    <Empty description="No actions found" />
                ) : (
                    <div className="flex flex-col gap-2">
                        {actions.map((action, i) => (
                            <React.Fragment key={action.key}>
                                {i === sentinelIndex && (
                                    <ScrollSentinel
                                        onVisible={requestMore}
                                        hasMore={hasNextPage}
                                        isFetching={isFetchingNextPage}
                                    />
                                )}
                                <Card
                                    hoverable
                                    className="cursor-pointer"
                                    size="small"
                                    onClick={() => onSelectAction(action)}
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <Typography.Text strong className="truncate">
                                                {action.name}
                                            </Typography.Text>
                                            {action.categories?.slice(0, 2).map((c) => (
                                                <Tag key={c} className="text-xs">
                                                    {c}
                                                </Tag>
                                            ))}
                                        </div>
                                        {action.description && (
                                            <Typography.Text
                                                type="secondary"
                                                className="text-xs line-clamp-2"
                                            >
                                                {action.description}
                                            </Typography.Text>
                                        )}
                                    </div>
                                </Card>
                            </React.Fragment>
                        ))}

                        <ScrollSentinel
                            onVisible={requestMore}
                            hasMore={hasNextPage}
                            isFetching={isFetchingNextPage}
                        />

                        {isFetchingNextPage && (
                            <div className="flex items-center justify-center py-4">
                                <Spin size="small" />
                            </div>
                        )}
                    </div>
                )}

                <ScrollToTopButton scrollRef={scrollRef} />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Step 2: Action Detail (inputs + execute + outputs)
// ---------------------------------------------------------------------------

function ActionDetailStep({
    integrationKey,
    integrationName,
    integrationLogo,
    connectionSlug,
    actionKey,
    actionName,
    canGoBack,
    onBack,
}: {
    integrationKey: string
    integrationName?: string
    integrationLogo?: string
    connectionSlug: string
    actionKey: string
    actionName?: string
    canGoBack: boolean
    onBack: () => void
}) {
    const [form] = Form.useForm()
    const schemaFormRef = useRef<SchemaFormHandle>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const {action, isLoading: detailLoading} = useActionDetail(integrationKey, actionKey)
    const {execute, isExecuting, result, error} = useToolExecution()
    const [viewMode, setViewMode] = useState<"form" | "json">("form")

    const inputSchema = action?.schemas?.inputs ?? null
    const outputSchema = action?.schemas?.outputs ?? null
    const displayName = action?.name ?? actionName ?? actionKey
    const jsonMode = viewMode === "json"

    const handleCopyInputs = useCallback(() => {
        try {
            const values = form.getFieldsValue(true)
            navigator.clipboard.writeText(JSON.stringify(values, null, 2))
            message.success("Copied to clipboard")
        } catch {
            message.error("Failed to copy")
        }
    }, [form])

    const handleExecute = useCallback(async () => {
        try {
            const values = await schemaFormRef.current?.getValues()
            if (!values) return

            await execute({
                provider: DEFAULT_PROVIDER,
                integrationKey,
                actionKey,
                connectionSlug,
                arguments: values,
            })
        } catch (e) {
            if (e instanceof SyntaxError) {
                message.error("Invalid JSON input")
            }
            // form validation failed
        }
    }, [execute, integrationKey, actionKey, connectionSlug])

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Sticky header */}
            <div className="flex flex-col gap-2 px-6 pt-4 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                    {canGoBack && (
                        <Button
                            type="text"
                            icon={<ArrowLeft size={16} />}
                            onClick={onBack}
                            className="shrink-0"
                        />
                    )}
                    {integrationLogo && (
                        <Image
                            src={integrationLogo}
                            alt={integrationName}
                            width={24}
                            height={24}
                            className="w-6 h-6 rounded object-contain shrink-0"
                            unoptimized
                        />
                    )}
                    {integrationName && (
                        <Typography.Text type="secondary" className="shrink-0">
                            {integrationName}
                        </Typography.Text>
                    )}
                    {integrationName && (
                        <Typography.Text type="secondary" className="shrink-0">
                            /
                        </Typography.Text>
                    )}
                    <Typography.Text strong className="truncate flex-1">
                        {detailLoading ? "Loading..." : displayName}
                    </Typography.Text>
                    <Segmented
                        size="small"
                        value={viewMode}
                        onChange={(v) => setViewMode(v as "form" | "json")}
                        options={[
                            {value: "form", icon: <ListDashes size={14} />},
                            {value: "json", icon: <BracketsRound size={14} />},
                        ]}
                    />
                </div>
                {action?.description && (
                    <Typography.Text type="secondary" className="text-xs">
                        {action.description}
                    </Typography.Text>
                )}
                <Typography.Text type="secondary" className="text-xs">
                    Connection: {connectionSlug}
                </Typography.Text>
            </div>

            <Divider className="!m-0" />

            {/* Scrollable content */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-3 relative">
                {detailLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Spin />
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {/* Inputs section */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <Typography.Text strong className="text-sm">
                                    Inputs
                                </Typography.Text>
                                {!jsonMode && (
                                    <Button
                                        type="text"
                                        icon={<CopySimple size={14} />}
                                        size="small"
                                        onClick={handleCopyInputs}
                                        className="opacity-60 hover:opacity-100"
                                    />
                                )}
                            </div>
                            <SchemaForm
                                ref={schemaFormRef}
                                schema={inputSchema as Record<string, unknown> | null}
                                form={form}
                                disabled={isExecuting}
                                jsonMode={jsonMode}
                            />
                            <Button
                                type="primary"
                                icon={<Play size={14} />}
                                loading={isExecuting}
                                onClick={handleExecute}
                                className="self-start"
                                size="small"
                            >
                                Run
                            </Button>
                        </div>

                        <Divider className="!my-1" />

                        {/* Outputs section */}
                        <div className="flex flex-col gap-2">
                            <Typography.Text strong className="text-sm">
                                Outputs
                            </Typography.Text>
                            {result || error ? (
                                <ResultViewer
                                    result={result}
                                    error={error}
                                    outputSchema={outputSchema as Record<string, unknown> | null}
                                    jsonMode={jsonMode}
                                />
                            ) : (
                                <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center">
                                    <Typography.Text type="secondary" className="text-xs">
                                        Run the action to see results
                                    </Typography.Text>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <ScrollToTopButton scrollRef={scrollRef} />
            </div>
        </div>
    )
}
