/** One saved subagent: the calling agent's own description, over a read-only summary of the agent
 *  it calls. A subagent always runs that agent's LATEST revision, and this offers no way to pin. */
import {useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {harnessCapabilitiesAtomFamily, type HarnessCapabilitiesMap} from "@agenta/entities/workflow"
import {formatNumber, useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import toolFormCatalog from "@agenta/i18n/catalogs/entityUi.toolForm"
import type {SubagentDetail, WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Alert, AutosizeTextarea, Button, IconTile, SkeletonBlock} from "@agenta/ui/ui"
import {CaretDown, Compass, Cpu, FileText, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {FieldHeading} from "./agentTemplate/accounts/FieldHeading"
import {normalizeSubagentReference} from "./agentTemplate/subagentReference"
import {modelLabel} from "./connectionUtils"
import {useIntegrationLogos} from "./hooks/useIntegrationLogos"
import {ProviderLogo} from "./sectionGroups"

export interface ReferenceToolFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
    /** The called agent's name, over the form beside its Mark. */
    name?: string
    /** Shown in the title of the read-only Configuration, next to the data it opens ("Open agent"). */
    configurationAction?: ReactNode
}

interface DetailState {
    detail: SubagentDetail | null
    loading: boolean
    failed: boolean
    retry?: () => void
}

/** The key the harness catalog query is read under here (the data is global). */
const HARNESS_CATALOG_KEY = "agenta:subagent-detail"

/**
 * The catalog's name for a subagent's model id (canvas F03 f2: "GPT-5.5 mini" over the id). The
 * detail names no harness, so each harness catalog is asked; null when none knows the id.
 */
const readableModelName = (
    capabilities: HarnessCapabilitiesMap | null,
    modelId: string,
): string | null => {
    for (const harness of Object.keys(capabilities ?? {})) {
        const label = modelLabel(capabilities, harness, modelId)
        if (label && label !== modelId) return label
    }
    return null
}

/** One row of the configuration card: a muted label column, then the value. */
function DetailRow({label, children}: {label: string; children: React.ReactNode}) {
    return (
        <div className="flex items-start gap-4 border-0 border-t border-solid border-border-muted px-3 py-2 first:border-t-0">
            {/* Canvas F03 f2: 12/16 in the secondary color. */}
            <span className="w-[84px] shrink-0 pt-0.5 text-meta text-muted-foreground">
                {label}
            </span>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    )
}

/** Muted text for a row with nothing in it, worded like the picker's own empty line. */
const Empty = ({children}: {children: React.ReactNode}) => (
    <span className="text-body-sm text-muted-foreground">{children}</span>
)

/** One value line of the card: a 20px Mark (or logo), 8px to its name. */
const MarkLine = ({mark, children}: {mark: ReactNode; children: ReactNode}) => (
    <span className="flex items-center gap-2 text-body-sm">
        {mark}
        {children}
    </span>
)

/** A loading line in the shape of a {@link MarkLine}. */
const SkeletonMarkLine = ({width}: {width: string}) => (
    <div className="flex h-5 items-center gap-2">
        <SkeletonBlock shape="mark" className="size-5" />
        <SkeletonBlock className={cn("h-3", width)} />
    </div>
)

/** The agent's instruction file, clamped to four lines until opened; the pane scrolls it. */
function Instructions({file}: {file: NonNullable<SubagentDetail["instructions"]>}) {
    const t = useT(toolFormCatalog)
    const [open, setOpen] = useState(false)
    const [clamped, setClamped] = useState(false)
    const textRef = useRef<HTMLDivElement>(null)
    // The toggle shows only when the clamp hides text.
    useLayoutEffect(() => {
        const el = textRef.current
        if (!el || open) return
        const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
    }, [file.text, open])
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <FileText size={14} className="shrink-0 text-muted-foreground" />
                <span className="text-body-sm">{file.fileName}</span>
                <span className="text-meta text-muted-foreground">
                    {t("entityUi.toolForm.wordCount", {
                        count: file.wordCount,
                        formatted: formatNumber(file.wordCount),
                    })}
                </span>
            </div>
            <div
                ref={textRef}
                className={cn(
                    "whitespace-pre-line rounded-md bg-secondary p-3 text-body-sm text-muted-foreground",
                    open ? null : "line-clamp-4",
                )}
            >
                {file.text}
            </div>
            {open || clamped ? (
                <Button
                    variant="ghost"
                    size="compact"
                    className="-ml-2 w-fit"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                >
                    {open
                        ? t("entityUi.toolForm.hideInstructions")
                        : t("entityUi.toolForm.showFullInstructions")}
                    <CaretDown data-icon="inline-end" className="ag-caret" />
                </Button>
            ) : null}
        </div>
    )
}

export function ReferenceToolFormView(props: ReferenceToolFormViewProps) {
    const {workflowReference} = useDrillInUI()
    // Split so the bridge's hook is never called through an optional member: each branch is its
    // own component, so React remounts rather than shifting hook order.
    return workflowReference ? (
        <ConnectedReferenceToolFormView bridge={workflowReference} {...props} />
    ) : (
        <SubagentDetailPanel {...props} detail={null} loading={false} failed={false} />
    )
}

function ConnectedReferenceToolFormView({
    bridge,
    ...props
}: ReferenceToolFormViewProps & {bridge: WorkflowReferenceBridge}) {
    const slug = typeof props.value?.slug === "string" ? props.value.slug : ""
    const state = bridge.useSubagentDetail(slug)
    return <SubagentDetailPanel {...props} {...state} />
}

function SubagentDetailPanel({
    value,
    onChange,
    disabled,
    name,
    configurationAction,
    detail,
    loading,
    failed,
    retry,
}: ReferenceToolFormViewProps & DetailState) {
    const t = useT(toolFormCatalog, subagentViewsCatalog, integrationViewsCatalog)
    const tool = value ?? {}

    // The bridge knows WHICH apps connect; their logos come from the catalog, which needs a component.
    const appKeys = useMemo(
        () => (detail?.integrations ?? []).map((a) => a.key),
        [detail?.integrations],
    )
    const appByKey = useIntegrationLogos(appKeys)

    const description = typeof tool.description === "string" ? tool.description : ""
    const ProviderIcon = detail?.provider ? getProviderIcon(detail.provider) : null
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const modelName = detail?.model ? readableModelName(capabilities, detail.model) : null

    return (
        <div className="flex flex-col gap-6 p-4">
            {name ? (
                // The sibling item views' title: a 24px Mark, 8px to the name (CONS-02).
                <div className="flex items-center gap-2">
                    <IconTile size={24} aria-hidden>
                        <Robot />
                    </IconTile>
                    <span className="min-w-0 flex-1 truncate text-label font-semibold leading-5">
                        {name}
                    </span>
                    {configurationAction}
                </div>
            ) : null}
            <div className="flex flex-col gap-2">
                <FieldHeading
                    label={t("entityUi.toolForm.description")}
                    note={t("entityUi.toolForm.subagentDescriptionHint")}
                />
                <AutosizeTextarea
                    autoSize={{minRows: 2}}
                    value={description}
                    disabled={disabled}
                    onChange={(e) =>
                        onChange(normalizeSubagentReference({...tool, description: e.target.value}))
                    }
                    aria-label={t("entityUi.toolForm.subagentDescription")}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <FieldHeading
                        label={t("entityUi.toolForm.configuration")}
                        note={t("entityUi.toolForm.managedOnAgent")}
                    />
                    {!name && configurationAction ? (
                        <span className="ml-auto">{configurationAction}</span>
                    ) : null}
                </div>
                {failed && !detail ? (
                    <Alert
                        type="error"
                        showIcon
                        message={t("entityUi.subagentViews.configLoadError")}
                        action={
                            retry ? (
                                <Button variant="outline" size="compact" onClick={retry}>
                                    {t("entityUi.integrationViews.tryAgain")}
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <div className="overflow-hidden rounded-lg border border-solid border-border-muted">
                        {loading && !detail ? (
                            // The loaded card's rows, with bars for their values (STATE-02).
                            <>
                                <DetailRow label={t("entityUi.toolForm.model")}>
                                    <SkeletonMarkLine width="w-28" />
                                </DetailRow>
                                <DetailRow label={t("entityUi.toolForm.instructions")}>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex h-5 items-center">
                                            <SkeletonBlock className="h-3 w-36" />
                                        </div>
                                        <SkeletonBlock className="h-26 rounded-md" />
                                    </div>
                                </DetailRow>
                                <DetailRow label={t("entityUi.toolForm.integrations")}>
                                    <SkeletonMarkLine width="w-32" />
                                </DetailRow>
                                <DetailRow label={t("entityUi.toolForm.skills")}>
                                    <SkeletonMarkLine width="w-24" />
                                </DetailRow>
                            </>
                        ) : (
                            <>
                                <DetailRow label={t("entityUi.toolForm.model")}>
                                    {detail?.model ? (
                                        <span className="flex items-start gap-2">
                                            <IconTile size={20} aria-hidden>
                                                {ProviderIcon ? <ProviderIcon /> : <Cpu />}
                                            </IconTile>
                                            {modelName &&
                                            modelName.toLowerCase() !== detail.model.toLowerCase() ? (
                                                // The readable name, the id under it (canvas F03 f2).
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate text-body-sm">
                                                        {modelName}
                                                    </span>
                                                    <span className="truncate text-code-sm text-muted-foreground">
                                                        {detail.model}
                                                    </span>
                                                </span>
                                            ) : (
                                                <span className="truncate text-body-sm">
                                                    {modelName ?? detail.model}
                                                </span>
                                            )}
                                        </span>
                                    ) : (
                                        <Empty>{t("entityUi.toolForm.noModel")}</Empty>
                                    )}
                                </DetailRow>
                                <DetailRow label={t("entityUi.toolForm.instructions")}>
                                    {detail?.instructions ? (
                                        <Instructions file={detail.instructions} />
                                    ) : (
                                        <Empty>{t("entityUi.toolForm.noInstructions")}</Empty>
                                    )}
                                </DetailRow>
                                <DetailRow label={t("entityUi.toolForm.integrations")}>
                                    {detail?.integrations.length ? (
                                        <div className="flex flex-col gap-1">
                                            {detail.integrations.map((app) => {
                                                const catalog = appByKey.get(app.key)
                                                return (
                                                    <MarkLine
                                                        key={app.key}
                                                        mark={
                                                            <ProviderLogo
                                                                logo={catalog?.logo ?? null}
                                                                size={20}
                                                            />
                                                        }
                                                    >
                                                        <span className="min-w-0 flex-1 truncate">
                                                            {catalog?.name ?? app.key}
                                                        </span>
                                                        {app.permission ? (
                                                            <span className="shrink-0 text-muted-foreground">
                                                                {app.permission}
                                                            </span>
                                                        ) : null}
                                                    </MarkLine>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <Empty>{t("entityUi.toolForm.noConnectedApps")}</Empty>
                                    )}
                                </DetailRow>
                                <DetailRow label={t("entityUi.toolForm.skills")}>
                                    {detail?.skills.length ? (
                                        // Drawn as the apps above: a Mark and the name (CONS-02).
                                        <div className="flex flex-col gap-1">
                                            {detail.skills.map((skill) => (
                                                <MarkLine
                                                    key={skill}
                                                    mark={
                                                        <IconTile size={20} aria-hidden>
                                                            <Compass />
                                                        </IconTile>
                                                    }
                                                >
                                                    <span className="min-w-0 flex-1 truncate">
                                                        {skill}
                                                    </span>
                                                </MarkLine>
                                            ))}
                                        </div>
                                    ) : (
                                        <Empty>{t("entityUi.toolForm.noSkills")}</Empty>
                                    )}
                                </DetailRow>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
