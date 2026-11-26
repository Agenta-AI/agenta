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
import {CaretDown, Compass, Cpu, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useAgentIconChrome} from "../../agent/agentIcon"

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

/** One part of the agent's setup: its heading, a quiet count or file on the right, then the body. */
function Part({label, meta, children}: {label: string; meta?: ReactNode; children: ReactNode}) {
    return (
        <section className="flex flex-col gap-1">
            <div className="flex h-5 items-center gap-2">
                <span className="text-label font-semibold leading-5 text-foreground">{label}</span>
                {meta ? (
                    <span className="ml-auto truncate text-meta tabular-nums text-muted-foreground">
                        {meta}
                    </span>
                ) : null}
            </div>
            {children}
        </section>
    )
}

/** Muted text for a part with nothing in it. */
const Empty = ({children}: {children: ReactNode}) => (
    <span className="text-body-sm text-muted-foreground">{children}</span>
)

/** One item line: a 24px Mark, 8px to its name, an optional value at the end. */
const MarkLine = ({mark, children, end}: {mark: ReactNode; children: ReactNode; end?: ReactNode}) => (
    <div className="flex h-8 items-center gap-2 text-body-sm">
        {mark}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {end ? <span className="shrink-0 text-muted-foreground">{end}</span> : null}
    </div>
)

/** A loading part in the shape of a {@link Part} with one {@link MarkLine}. */
const SkeletonPart = ({width}: {width: string}) => (
    <div className="flex flex-col gap-1">
        <div className="flex h-5 items-center">
            <SkeletonBlock className="h-3 w-20" />
        </div>
        <div className="flex h-8 items-center gap-2">
            <SkeletonBlock shape="mark" className="size-6" />
            <SkeletonBlock className={cn("h-3", width)} />
        </div>
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
        <div className="flex flex-col gap-1">
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
    // The called agent's own icon and tile color, as the agents list draws it.
    const agentChrome = useAgentIconChrome(detail?.workflowId, {
        size: 14,
        fallbackGlyph: <Robot />,
        fallbackClassName: "bg-secondary text-muted-foreground",
    })

    return (
        <div className="flex flex-col gap-4 p-4">
            {name ? (
                // The sibling item views' title: a 24px Mark, 8px to the name (CONS-02).
                <div className="flex items-center gap-2">
                    <span
                        aria-hidden
                        className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5",
                            agentChrome.className,
                        )}
                        style={agentChrome.style}
                    >
                        {agentChrome.glyph}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-label font-semibold leading-5">
                        {name}
                    </span>
                    {configurationAction}
                </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
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

            {!name && configurationAction ? (
                <div className="flex justify-end">{configurationAction}</div>
            ) : null}
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
            ) : loading && !detail ? (
                // The loaded parts, with bars for their values (STATE-02).
                <>
                    <SkeletonPart width="w-28" />
                    <div className="flex flex-col gap-1">
                        <div className="flex h-5 items-center">
                            <SkeletonBlock className="h-3 w-24" />
                        </div>
                        <SkeletonBlock className="h-26 rounded-md" />
                    </div>
                    <SkeletonPart width="w-32" />
                    <SkeletonPart width="w-24" />
                </>
            ) : (
                <>
                    <Part label={t("entityUi.toolForm.model")}>
                        {detail?.model ? (
                            <MarkLine
                                mark={
                                    <IconTile size={24} aria-hidden>
                                        {ProviderIcon ? <ProviderIcon /> : <Cpu />}
                                    </IconTile>
                                }
                            >
                                {modelName ?? detail.model}
                            </MarkLine>
                        ) : (
                            <Empty>{t("entityUi.toolForm.noModel")}</Empty>
                        )}
                    </Part>
                    <Part
                        label={t("entityUi.toolForm.instructions")}
                        meta={
                            detail?.instructions
                                ? t("entityUi.toolForm.wordCount", {
                                      count: detail.instructions.wordCount,
                                      formatted: formatNumber(detail.instructions.wordCount),
                                  })
                                : undefined
                        }
                    >
                        {detail?.instructions ? (
                            <Instructions file={detail.instructions} />
                        ) : (
                            <Empty>{t("entityUi.toolForm.noInstructions")}</Empty>
                        )}
                    </Part>
                    <Part label={t("entityUi.toolForm.integrations")}>
                        {detail?.integrations.length ? (
                            <div className="flex flex-col">
                                {detail.integrations.map((app) => {
                                    const catalog = appByKey.get(app.key)
                                    return (
                                        <MarkLine
                                            key={app.key}
                                            mark={
                                                <IconTile size={24} aria-hidden>
                                                    <ProviderLogo
                                                        logo={catalog?.logo ?? null}
                                                        size={14}
                                                    />
                                                </IconTile>
                                            }
                                            end={app.permission}
                                        >
                                            {catalog?.name ?? app.key}
                                        </MarkLine>
                                    )
                                })}
                            </div>
                        ) : (
                            <Empty>{t("entityUi.toolForm.noConnectedApps")}</Empty>
                        )}
                    </Part>
                    <Part label={t("entityUi.toolForm.skills")}>
                        {detail?.skills.length ? (
                            <div className="flex flex-col">
                                {detail.skills.map((skill) => (
                                    <MarkLine
                                        key={skill}
                                        mark={
                                            <IconTile size={24} aria-hidden>
                                                <Compass />
                                            </IconTile>
                                        }
                                    >
                                        {skill}
                                    </MarkLine>
                                ))}
                            </div>
                        ) : (
                            <Empty>{t("entityUi.toolForm.noSkills")}</Empty>
                        )}
                    </Part>
                </>
            )}
        </div>
    )
}
