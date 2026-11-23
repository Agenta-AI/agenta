import React, {useCallback, useMemo, useRef, useState} from "react"

import {
    toolActionsSearchAtom,
    toolExecutionDrawerAtom,
    useToolActionDetail,
    useToolCatalogActions,
    useToolExecution,
    useToolIntegrationDetail,
    type ToolCatalogAction,
    type ToolCatalogActionDetails,
} from "@agenta/entities/gatewayTool"
import {createT, useT, type CatalogKey} from "@agenta/i18n"
import toolExecutionCatalog from "@agenta/i18n/catalogs/entityUi.toolExecution"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {ScrollSentinel, ScrollToTopButton, message} from "@agenta/ui"
import {Tag} from "@agenta/ui/components/presentational"
import {
    Button,
    InputAffix,
    LoadingButton,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {ArrowLeft, CaretRight, MagnifyingGlass, Play, Wrench} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"
import Image from "next/image"

import {ToolsEmpty} from "../../shared/ToolsEmpty"
import ResultViewer from "../components/ResultViewer"
import type {SchemaFormHandle} from "../components/SchemaForm"
import SchemaForm from "../components/SchemaForm"

type CatalogActionItem = ToolCatalogAction | ToolCatalogActionDetails

const DEFAULT_PROVIDER = "composio"

// ---------------------------------------------------------------------------
// ToolExecutionDrawer (root)
// ---------------------------------------------------------------------------

export default function ToolExecutionDrawer() {
    const [state, setState] = useAtom(toolExecutionDrawerAtom)
    const open = !!state
    const [selectedAction, setSelectedAction] = useState<CatalogActionItem | null>(null)
    const setActionsSearch = useSetAtom(toolActionsSearchAtom)

    // Fetch integration info as fallback when name/logo not in state
    const {integration} = useToolIntegrationDetail(state?.integrationKey ?? "")
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

    const handleSelectAction = useCallback((action: CatalogActionItem) => {
        setSelectedAction(action)
    }, [])

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) handleClose()
            }}
        >
            <SheetContent
                side="right"
                style={{width: 640, maxWidth: "calc(100% - 1rem)"}}
            >
                <SheetHeader>
                    {/* The integration's mark heads the drawer, as in the connect dialog. */}
                    <SheetTitle className="min-w-0">
                        <span className="flex min-w-0 items-center gap-3">
                            <LogoTile logo={integrationLogo ?? undefined} name={integrationName || ""} />
                            <span className="truncate text-body font-medium">{integrationName}</span>
                        </span>
                    </SheetTitle>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit] text-field-md text-foreground">
                    {state &&
                        (step === 1 ? (
                            <ActionPickerStep
                                integrationKey={state.integrationKey || ""}
                                integrationName={integrationName || ""}
                                integrationLogo={integrationLogo ?? undefined}
                                connectionSlug={state.connectionSlug || ""}
                                onSelectAction={handleSelectAction}
                            />
                        ) : (
                            <ActionDetailStep
                                integrationKey={state.integrationKey || ""}
                                integrationName={integrationName || ""}
                                integrationLogo={integrationLogo ?? undefined}
                                connectionSlug={state.connectionSlug || ""}
                                actionKey={activeActionKey}
                                actionName={selectedAction?.name}
                                canGoBack={!state.actionKey}
                                onBack={handleBack}
                            />
                        ))}
                </div>
            </SheetContent>
        </Sheet>
    )
}

// The execute handler's toast fires outside render.
const tNow = createT(toolExecutionCatalog)

/** Composio's MCP-style hints, said as what the action does. Catalog keys, translated at render. */
const HINT_LABELS: Record<string, CatalogKey<typeof toolExecutionCatalog>> = {
    readOnlyHint: "entityUi.toolExecution.readOnly",
    createHint: "entityUi.toolExecution.creates",
    updateHint: "entityUi.toolExecution.updates",
    destructiveHint: "entityUi.toolExecution.deletes",
    deleteHint: "entityUi.toolExecution.deletes",
}

function ActionRow({
    action,
    onSelect,
}: {
    action: CatalogActionItem
    onSelect: (action: CatalogActionItem) => void
}) {
    const t = useT(toolExecutionCatalog)
    const categories = action.categories ?? []
    const hint = categories.map((c) => HINT_LABELS[c]).find(Boolean)
    const topic = categories.find((c) => !c.endsWith("Hint"))
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(action)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelect(action)
                }
            }}
            className="-mx-3 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-accent/60 focus-visible:bg-accent/60"
        >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-label font-medium text-foreground">
                        {action.name}
                    </span>
                    {hint ? (
                        <Tag
                            tone={hint === "entityUi.toolExecution.deletes" ? "destructive" : "default"}
                            className="shrink-0 text-meta"
                        >
                            {t(hint)}
                        </Tag>
                    ) : null}
                </div>
                {action.description ? (
                    <span className="line-clamp-2 text-meta text-muted-foreground">
                        {topic ? <span className="font-mono">{topic} · </span> : null}
                        {action.description}
                    </span>
                ) : null}
            </div>
            <CaretRight size={14} className="shrink-0 text-muted-foreground" />
        </div>
    )
}

function ActionRowsSkeleton({rows = 6}: {rows?: number}) {
    return (
        <div className="flex flex-col" aria-hidden>
            {Array.from({length: rows}, (_, index) => (
                <div key={index} className="flex flex-col gap-1.5 py-3">
                    <SkeletonBlock active className="h-4 w-1/3 rounded" />
                    <SkeletonBlock active className="h-3.5 w-5/6 rounded" />
                </div>
            ))}
        </div>
    )
}

/** The integration's logo in a bordered tile; its initial when it has none. */
function LogoTile({logo, name}: {logo?: string; name: string}) {
    return (
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-solid border-border bg-background">
            {logo ? (
                <Image
                    src={logo}
                    alt={name}
                    width={16}
                    height={16}
                    className="size-4 object-contain"
                    unoptimized
                />
            ) : (
                <span className="text-label font-semibold text-muted-foreground">
                    {name.charAt(0).toUpperCase()}
                </span>
            )}
        </span>
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
    onSelectAction: (action: CatalogActionItem) => void
}) {
    const t = useT(toolExecutionCatalog)
    const setAtom = useSetAtom(toolActionsSearchAtom)
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
    } = useToolCatalogActions(integrationKey)

    const sentinelIndex = useMemo(
        () => Math.max(0, actions.length - prefetchThreshold),
        [actions.length, prefetchThreshold],
    )

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Sticky header */}
            <div className="flex flex-col gap-3 px-4 pt-4 pb-3 shrink-0">
                <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-body font-medium leading-snug text-foreground">
                        {t("entityUi.toolExecution.chooseAction")}
                    </span>
                </div>

                <InputAffix
                    placeholder={t("entityUi.toolExecution.searchActions")}
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onValueChange={(value) => search.onChange(value)}
                    allowClear
                />

                {total > 0 ? (
                    <span className="text-meta text-muted-foreground">
                        {t("entityUi.toolExecution.actionsCount", {count: total})}
                    </span>
                ) : null}
            </div>

            {/* Scrollable content */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 relative"
            >
                {isLoading && actions.length === 0 ? (
                    <ActionRowsSkeleton />
                ) : actions.length === 0 ? (
                    search.value.trim() ? (
                        <ToolsEmpty
                            icon={<MagnifyingGlass size={18} />}
                            title={t("entityUi.toolExecution.noActionsMatch", {
                                query: search.value.trim(),
                            })}
                            description={t("entityUi.toolExecution.noActionsMatchHint")}
                            action={
                                <Button variant="outline" onClick={() => search.onChange("")}>
                                    {t("entityUi.toolExecution.clearSearch")}
                                </Button>
                            }
                        />
                    ) : (
                        <ToolsEmpty
                            icon={<Wrench size={18} />}
                            title={t("entityUi.toolExecution.noActionsAvailable")}
                            description={t("entityUi.toolExecution.exposesNoActions", {
                                name: integrationName || integrationKey,
                            })}
                        />
                    )
                ) : (
                    <div className="flex flex-col">
                        {actions.map((action, i) => (
                            <React.Fragment key={action.key}>
                                {i === sentinelIndex && (
                                    <ScrollSentinel
                                        onVisible={requestMore}
                                        hasMore={hasNextPage}
                                        isFetching={isFetchingNextPage}
                                    />
                                )}
                                <ActionRow action={action} onSelect={onSelectAction} />
                            </React.Fragment>
                        ))}

                        <ScrollSentinel
                            onVisible={requestMore}
                            hasMore={hasNextPage}
                            isFetching={isFetchingNextPage}
                        />

                        {isFetchingNextPage && <ActionRowsSkeleton rows={3} />}
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
    const t = useT(toolExecutionCatalog)
    const schemaFormRef = useRef<SchemaFormHandle>(null)
    const {action, isLoading: detailLoading} = useToolActionDetail(integrationKey, actionKey)
    const {execute, isExecuting, result, error} = useToolExecution()

    // The fetch endpoint always returns the detailed variant; narrow so we
    // can reach `schemas`. The wider union exists because Fern reuses the
    // response wrapper between list/detail endpoints.
    const detailedAction =
        action && "schemas" in action ? (action as ToolCatalogActionDetails) : null
    const inputSchema = detailedAction?.schemas?.inputs ?? null
    const outputSchema = detailedAction?.schemas?.outputs ?? null
    const displayName = action?.name ?? actionName ?? actionKey

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
                message.error(tNow("entityUi.toolExecution.invalidJsonInput"))
            }
            // form validation failed
        }
    }, [execute, integrationKey, actionKey, connectionSlug])

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex shrink-0 flex-col gap-1.5 px-4 pb-3 pt-3">
                {canGoBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="-ml-1 mb-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-meta text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft size={12} />
                        {t("entityUi.toolExecution.allActions")}
                    </button>
                )}
                <span className="truncate text-body font-medium text-foreground">
                    {detailLoading ? t("entityUi.toolExecution.loading") : displayName}
                </span>
                {action?.description && (
                    <p className="m-0 line-clamp-3 text-label leading-5 text-muted-foreground">
                        {action.description}
                    </p>
                )}
                <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
                    {t("entityUi.toolExecution.connection")}
                    <span className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-caption text-foreground">
                        {connectionSlug}
                    </span>
                </span>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 relative">
                {detailLoading ? (
                    <ActionRowsSkeleton rows={3} />
                ) : (
                    <div className="flex flex-col gap-6">
                        {/* Inputs section */}
                        <div className="flex flex-col gap-2">
                            <span className="text-label font-medium text-muted-foreground">
                                {t("entityUi.toolExecution.inputs")}
                            </span>
                            <SchemaForm
                                ref={schemaFormRef}
                                schema={inputSchema as Record<string, unknown> | null}
                                disabled={isExecuting}
                            />
                        </div>

                        {/* Outputs section */}
                        <div className="flex flex-col gap-2">
                            <span className="text-label font-medium text-muted-foreground">
                                {t("entityUi.toolExecution.output")}
                            </span>
                            {result || error ? (
                                <ResultViewer
                                    result={result}
                                    error={error}
                                    outputSchema={outputSchema as Record<string, unknown> | null}
                                />
                            ) : (
                                <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center">
                                    <Play size={18} className="text-muted-foreground" />
                                    <span className="text-label text-foreground">
                                        {t("entityUi.toolExecution.noOutputYet")}
                                    </span>
                                    <span className="text-meta text-muted-foreground">
                                        {t("entityUi.toolExecution.fillInputsHint")}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Run sits in a footer so it stays in reach on a long form. */}
            {!detailLoading && (
                <div className="flex shrink-0 justify-end border-0 border-t border-solid border-border px-4 py-3">
                    <LoadingButton loading={isExecuting} onClick={handleExecute}>
                        {!isExecuting && <Play size={14} />}
                        {t("entityUi.toolExecution.runAction")}
                    </LoadingButton>
                </div>
            )}
        </div>
    )
}
