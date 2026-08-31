/** One saved subagent: the calling agent's own description, over a read-only summary of the agent
 *  it calls. A subagent always runs that agent's LATEST revision, and this offers no way to pin. */
import {useMemo, useState} from "react"

import type {SubagentDetail, WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {AutosizeTextarea, Badge, SkeletonBlock} from "@agenta/ui/ui"
import {CaretDown, CaretUp, Cube, FileText, Info, Lock} from "@phosphor-icons/react"

import {normalizeSubagentReference} from "./agentTemplate/subagentReference"
import {useIntegrationLogos} from "./hooks/useIntegrationLogos"
import {ProviderLogo} from "./sectionGroups"

export interface ReferenceToolFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

/** One row of the configuration card: a muted label column, then the value. */
function DetailRow({label, children}: {label: string; children: React.ReactNode}) {
    return (
        <div className="flex items-start gap-4 border-0 border-t border-solid border-[var(--ag-colorSplit)] px-4 py-3 first:border-t-0">
            <span className="w-24 shrink-0 pt-px text-[13px] text-[var(--ag-colorTextTertiary)]">
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
    const [open, setOpen] = useState(false)
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <FileText size={14} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                <span className="text-[13px]">{file.fileName}</span>
                <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                    Markdown · {file.wordCount.toLocaleString()} words
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
                className="flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] text-[var(--ag-colorLink)]"
            >
                {open ? "Hide instructions" : "Show full instructions"}
                {open ? <CaretUp size={12} /> : <CaretDown size={12} />}
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
        <SubagentDetailPanel {...props} detail={null} loading={false} />
    )
}

function ConnectedReferenceToolFormView({
    bridge,
    ...props
}: ReferenceToolFormViewProps & {bridge: WorkflowReferenceBridge}) {
    const slug = typeof props.value?.slug === "string" ? props.value.slug : ""
    const {detail, loading} = bridge.useSubagentDetail(slug)
    return <SubagentDetailPanel {...props} detail={detail} loading={loading} />
}

function SubagentDetailPanel({
    value,
    onChange,
    disabled,
    detail,
    loading,
}: ReferenceToolFormViewProps & {detail: SubagentDetail | null; loading: boolean}) {
    const tool = value ?? {}

    // The bridge knows WHICH apps connect; their logos come from the catalog, which needs a component.
    const appKeys = useMemo(
        () => (detail?.integrations ?? []).map((a) => a.key),
        [detail?.integrations],
    )
    const appByKey = useIntegrationLogos(appKeys)

    const description = typeof tool.description === "string" ? tool.description : ""
    const ProviderIcon = detail?.provider ? getProviderIcon(detail.provider) : null

    return (
        <div className="flex flex-col gap-6 p-4">
            <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium">Description</span>
                <AutosizeTextarea
                    value={description}
                    disabled={disabled}
                    onChange={(e) =>
                        onChange(normalizeSubagentReference({...tool, description: e.target.value}))
                    }
                    aria-label="Subagent description"
                />
                <span className="flex items-start gap-1.5 text-xs text-[var(--ag-colorTextTertiary)]">
                    <Info size={13} className="mt-px shrink-0" />
                    The agent reads this description to decide when to call this subagent. Edit it
                    to change when it is used.
                </span>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">Configuration</span>
                    <Badge variant="default" className="m-0 gap-1 px-2 text-xs font-normal">
                        <Lock size={11} />
                        Read-only
                    </Badge>
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        Managed on the agent itself
                    </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)]">
                    {loading && !detail ? (
                        <div className="flex flex-col gap-2 p-4">
                            <SkeletonBlock className="h-3 w-40" />
                            <SkeletonBlock className="h-3 w-full" />
                            <SkeletonBlock className="h-3 w-3/5" />
                        </div>
                    ) : (
                        <>
                            <DetailRow label="Model">
                                {detail?.model ? (
                                    <span className="flex items-center gap-2">
                                        <span className="flex size-[18px] shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillTertiary)]">
                                            {ProviderIcon ? (
                                                <ProviderIcon className="size-3" />
                                            ) : (
                                                <Cube size={11} />
                                            )}
                                        </span>
                                        <span className="truncate text-[13px] tabular-nums">
                                            {detail.model}
                                        </span>
                                    </span>
                                ) : (
                                    <Empty>No model</Empty>
                                )}
                            </DetailRow>
                            <DetailRow label="Instructions">
                                {detail?.instructions ? (
                                    <Instructions file={detail.instructions} />
                                ) : (
                                    <Empty>No instructions</Empty>
                                )}
                            </DetailRow>
                            <DetailRow label="Integrations">
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
                                    <Empty>No connected apps</Empty>
                                )}
                            </DetailRow>
                            <DetailRow label="Skills">
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
                                    <Empty>No skills</Empty>
                                )}
                            </DetailRow>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
