/** One saved subagent: the calling agent's own description, over a read-only summary of the agent
 *  it calls. A subagent always runs that agent's LATEST revision, and this offers no way to pin. */
import {useMemo, useState, type ReactNode} from "react"

import {harnessCapabilitiesAtomFamily, type HarnessCapabilitiesMap} from "@agenta/entities/workflow"
import {formatNumber, useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import toolFormCatalog from "@agenta/i18n/catalogs/entityUi.toolForm"
import type {SubagentDetail, WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {AutosizeTextarea, Badge, Button, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowUp, CaretDown, Cube, FileText, Lock} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {normalizeSubagentReference} from "./agentTemplate/subagentReference"
import {modelLabel} from "./connectionUtils"
import {useIntegrationLogos} from "./hooks/useIntegrationLogos"
import {ProviderLogo} from "./sectionGroups"

export interface ReferenceToolFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
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
        <div className="flex items-start gap-4 border-0 border-t border-solid border-[var(--ag-colorSplit)] px-3 py-2 first:border-t-0">
            {/* Canvas F03 f2: 12/16 in the secondary color. */}
            <span className="w-[84px] shrink-0 pt-0.5 text-[12px] leading-4 text-[var(--ag-colorTextSecondary)]">
                {label}
            </span>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    )
}

/** Muted text for a row with nothing in it, worded like the picker's own empty line. */
const Empty = ({children}: {children: React.ReactNode}) => (
    <span className="text-[13px] text-[var(--ag-colorTextQuaternary)]">{children}</span>
)

/** The agent's instruction file, clamped behind a fade and scrolled inside a fixed well. */
function Instructions({file}: {file: NonNullable<SubagentDetail["instructions"]>}) {
    const t = useT(toolFormCatalog)
    const [open, setOpen] = useState(false)
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <FileText size={14} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                <span className="text-[13px]">{file.fileName}</span>
                <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                    {t("entityUi.toolForm.wordCount", {
                        count: file.wordCount,
                        formatted: formatNumber(file.wordCount),
                    })}
                </span>
            </div>
            <div className="relative">
                <div
                    className={cn(
                        "whitespace-pre-line rounded-md bg-[var(--ag-colorFillQuaternary)] p-3 text-[13px] leading-relaxed text-[var(--ag-colorTextSecondary)]",
                        open ? "max-h-80 overflow-y-auto" : "line-clamp-4 overflow-hidden",
                    )}
                >
                    {file.text}
                </div>
                {/* The fade says "there is more" without a second control competing with the link. */}
                {open ? null : (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-md bg-gradient-to-t from-[var(--ag-colorFillQuaternary)] to-transparent" />
                )}
            </div>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] text-colorInfo"
            >
                {open
                    ? t("entityUi.toolForm.hideInstructions")
                    : t("entityUi.toolForm.showFullInstructions")}
                {open ? <ArrowUp size={12} /> : <CaretDown size={12} />}
            </button>
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
            <div className="flex flex-col gap-2">
                {/* Canvas F03 f2: the label 12/16/500 in the secondary color. */}
                <span className="text-[12px] font-medium leading-4 text-colorTextSecondary">
                    {t("entityUi.toolForm.description")}
                </span>
                <AutosizeTextarea
                    autoSize={{minRows: 5}}
                    value={description}
                    disabled={disabled}
                    onChange={(e) =>
                        onChange(normalizeSubagentReference({...tool, description: e.target.value}))
                    }
                    aria-label={t("entityUi.toolForm.subagentDescription")}
                />
                <span className="text-[12px] leading-4 text-[var(--ag-colorTextTertiary)]">
                    {t("entityUi.toolForm.subagentDescriptionHint")}
                </span>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium leading-5">
                        {t("entityUi.toolForm.configuration")}
                    </span>
                    {/* Canvas F03 f2: a bordered 12 px tag with a 12 px lock. */}
                    <Badge
                        variant="outlined"
                        className="m-0 gap-1 bg-colorBgContainer px-1.5 text-[12px] font-normal leading-4 text-colorTextSecondary"
                    >
                        <Lock size={12} />
                        {t("entityUi.toolForm.readOnly")}
                    </Badge>
                    {configurationAction ? (
                        <span className="ml-auto">{configurationAction}</span>
                    ) : (
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                            {t("entityUi.toolForm.managedOnAgent")}
                        </span>
                    )}
                </div>
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)]">
                    {failed && !detail ? (
                        <div className="flex items-center gap-3 p-4 text-[13px]">
                            <span className="min-w-0 flex-1 text-[var(--ag-colorTextSecondary)]">
                                {t("entityUi.subagentViews.configLoadError")}
                            </span>
                            {retry ? (
                                <Button variant="outline" size="sm" onClick={retry}>
                                    {t("entityUi.integrationViews.tryAgain")}
                                </Button>
                            ) : null}
                        </div>
                    ) : loading && !detail ? (
                        <div className="flex flex-col gap-2 p-4">
                            <SkeletonBlock className="h-3 w-40" />
                            <SkeletonBlock className="h-3 w-full" />
                            <SkeletonBlock className="h-3 w-3/5" />
                        </div>
                    ) : (
                        <>
                            <DetailRow label={t("entityUi.toolForm.model")}>
                                {detail?.model ? (
                                    <span className="flex items-start gap-2">
                                        <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillTertiary)]">
                                            {ProviderIcon ? (
                                                <ProviderIcon className="size-3" />
                                            ) : (
                                                <Cube size={11} />
                                            )}
                                        </span>
                                        {modelName ? (
                                            // The readable name, the id under it (canvas F03 f2).
                                            <span className="flex min-w-0 flex-col">
                                                <span className="truncate text-[13px] leading-5">
                                                    {modelName}
                                                </span>
                                                <span className="truncate font-mono text-[11px] leading-5 text-[var(--ag-colorTextTertiary)]">
                                                    {detail.model}
                                                </span>
                                            </span>
                                        ) : (
                                            <span className="truncate text-[13px] leading-5 tabular-nums">
                                                {detail.model}
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
                                    <div className="flex flex-col gap-2">
                                        {detail.integrations.map((app) => {
                                            const catalog = appByKey.get(app.key)
                                            return (
                                                <span
                                                    key={app.key}
                                                    className="flex items-center gap-2 text-[13px]"
                                                >
                                                    <ProviderLogo
                                                        logo={catalog?.logo ?? null}
                                                        size={18}
                                                    />
                                                    <span className="min-w-0 flex-1 truncate">
                                                        {catalog?.name ?? app.key}
                                                    </span>
                                                    {app.permission ? (
                                                        <span className="shrink-0 text-[13px] text-[var(--ag-colorTextTertiary)]">
                                                            {app.permission}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <Empty>{t("entityUi.toolForm.noConnectedApps")}</Empty>
                                )}
                            </DetailRow>
                            <DetailRow label={t("entityUi.toolForm.skills")}>
                                {detail?.skills.length ? (
                                    <div className="flex flex-wrap gap-1.5">
                                        {detail.skills.map((skill) => (
                                            <span
                                                key={skill}
                                                className="rounded-md bg-[var(--ag-colorFillQuaternary)] px-2 py-1 text-[13px] text-[var(--ag-colorTextSecondary)]"
                                            >
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <Empty>{t("entityUi.toolForm.noSkills")}</Empty>
                                )}
                            </DetailRow>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
