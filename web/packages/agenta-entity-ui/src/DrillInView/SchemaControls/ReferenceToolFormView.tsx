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
import {AutosizeTextarea, Button, IconTile, SkeletonBlock} from "@agenta/ui/ui"
import {CaretDown, Cube, FileText, Robot} from "@phosphor-icons/react"
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
    <span className="text-label text-muted-foreground">{children}</span>
)

/** The agent's instruction file, clamped behind a fade and scrolled inside a fixed well. */
function Instructions({file}: {file: NonNullable<SubagentDetail["instructions"]>}) {
    const t = useT(toolFormCatalog)
    const [open, setOpen] = useState(false)
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <FileText size={14} className="shrink-0 text-muted-foreground" />
                <span className="text-label">{file.fileName}</span>
                <span className="text-meta text-muted-foreground">
                    {t("entityUi.toolForm.wordCount", {
                        count: file.wordCount,
                        formatted: formatNumber(file.wordCount),
                    })}
                </span>
            </div>
            <div className="relative">
                <div
                    className={cn(
                        "whitespace-pre-line rounded-md bg-secondary p-3 text-label leading-relaxed text-muted-foreground",
                        open ? "max-h-80 overflow-y-auto" : "line-clamp-4 overflow-hidden",
                    )}
                >
                    {file.text}
                </div>
                {/* The fade says "there is more" without a second control competing with the link. */}
                {open ? null : (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-md bg-gradient-to-t from-secondary to-transparent" />
                )}
            </div>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-fit cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent p-0 text-label text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground focus-ring"
            >
                {open
                    ? t("entityUi.toolForm.hideInstructions")
                    : t("entityUi.toolForm.showFullInstructions")}
                <CaretDown
                    size={12}
                    className={cn(
                        "transition-transform duration-[var(--duration-fast)]",
                        open && "rotate-180",
                    )}
                />
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
                <div className="flex items-center gap-3">
                    <IconTile size={32}>
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
                <div className="overflow-hidden rounded-lg border border-solid border-border-muted">
                    {failed && !detail ? (
                        <div className="flex items-center gap-3 p-4 text-label">
                            <span className="min-w-0 flex-1 text-muted-foreground">
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
                                        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm bg-secondary">
                                            {ProviderIcon ? (
                                                <ProviderIcon className="size-3" />
                                            ) : (
                                                <Cube size={11} />
                                            )}
                                        </span>
                                        {modelName &&
                                        modelName.toLowerCase() !== detail.model.toLowerCase() ? (
                                            // The readable name, the id under it (canvas F03 f2).
                                            <span className="flex min-w-0 flex-col">
                                                <span className="truncate text-label leading-5">
                                                    {modelName}
                                                </span>
                                                <span className="truncate font-mono text-caption leading-5 text-muted-foreground">
                                                    {detail.model}
                                                </span>
                                            </span>
                                        ) : (
                                            <span className="truncate text-label leading-5 tabular-nums">
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
                                    <div className="flex flex-col gap-2">
                                        {detail.integrations.map((app) => {
                                            const catalog = appByKey.get(app.key)
                                            return (
                                                <span
                                                    key={app.key}
                                                    className="flex items-center gap-2 text-label"
                                                >
                                                    <ProviderLogo
                                                        logo={catalog?.logo ?? null}
                                                        size={18}
                                                    />
                                                    <span className="min-w-0 flex-1 truncate">
                                                        {catalog?.name ?? app.key}
                                                    </span>
                                                    {app.permission ? (
                                                        <span className="shrink-0 text-label text-muted-foreground">
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
                                                className="rounded-md bg-secondary px-2 py-1 text-label text-muted-foreground"
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
