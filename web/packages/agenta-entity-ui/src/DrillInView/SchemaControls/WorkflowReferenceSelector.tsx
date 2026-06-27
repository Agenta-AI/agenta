/**
 * WorkflowReferenceSelector
 *
 * A right-hand drawer for referencing a workflow as an agent tool (`type:"reference"`, #4860).
 * Opened from the "Reference a workflow" section's `+` in the tool selector. The author:
 *   1. picks a workflow from a searchable list (the `slug`),
 *   2. picks an axis — by variant (the workflow's latest revision or a pinned version) or by
 *      environment (whatever is deployed in a named environment),
 *   3. confirms, which emits a {@link WorkflowReferencePayload} the caller turns into a
 *      `ReferenceToolConfig`.
 * Built on the shared `EnhancedDrawer`.
 */
import {useEffect, useMemo, useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import type {
    WorkflowReferenceBridge,
    WorkflowReferencePayload,
    WorkflowReferenceUI,
} from "@agenta/ui/drill-in"
import {ArrowLeft, GraphIcon, MagnifyingGlass} from "@phosphor-icons/react"
import {Button, Empty, Input, Segmented, Select, Spin} from "antd"

export interface WorkflowReferenceSelectorProps {
    open: boolean
    onClose: () => void
    /** Workflows available to reference (the caller filters out already-referenced ones). */
    workflows: WorkflowReferenceUI[]
    /** Supplies the per-workflow revision and environment lookups. */
    bridge: WorkflowReferenceBridge
    /** Emit the chosen reference (axis + slug + version/environment). */
    onSelect: (payload: WorkflowReferencePayload) => void
}

const LATEST_VALUE = "__latest__"

export function WorkflowReferenceSelector({
    open,
    onClose,
    workflows,
    bridge,
    onSelect,
}: WorkflowReferenceSelectorProps) {
    const [search, setSearch] = useState("")
    const [selected, setSelected] = useState<WorkflowReferenceUI | null>(null)
    const [refBy, setRefBy] = useState<"variant" | "environment">("variant")
    const [version, setVersion] = useState<string | undefined>(undefined)
    const [environment, setEnvironment] = useState<string | undefined>(undefined)

    // Reset to the workflow list whenever the drawer is (re)opened.
    useEffect(() => {
        if (!open) return
        setSearch("")
        setSelected(null)
    }, [open])

    // Reset the axis selection when the chosen workflow changes (or is cleared), so a previous
    // workflow's version/environment pick doesn't bleed into the new reference.
    useEffect(() => {
        setRefBy("variant")
        setVersion(undefined)
        setEnvironment(undefined)
    }, [selected?.id])

    const {revisions, isLoading: revisionsLoading} = bridge.useWorkflowRevisions(selected)
    const {environments, isLoading: environmentsLoading} = bridge.useWorkflowEnvironments(selected)

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return workflows
        return workflows.filter((w) =>
            `${w.slug} ${w.name ?? ""} ${w.description ?? ""}`.toLowerCase().includes(q),
        )
    }, [workflows, search])

    const canConfirm = Boolean(selected) && (refBy === "variant" || Boolean(environment))

    const handleConfirm = () => {
        if (!selected) return
        if (refBy === "environment" && !environment) return
        onSelect({
            slug: selected.slug,
            refBy,
            version: refBy === "variant" ? version : undefined,
            environment: refBy === "environment" ? environment : undefined,
        })
        onClose()
    }

    return (
        <EnhancedDrawer
            open={open}
            onClose={onClose}
            placement="right"
            width={480}
            destroyOnClose
            title={
                <div className="flex items-center gap-2">
                    <GraphIcon size={16} />
                    <span className="text-sm font-medium">Reference a workflow</span>
                </div>
            }
            styles={{body: {padding: 16}}}
        >
            {!selected ? (
                <div className="flex flex-col gap-3">
                    <Input
                        prefix={<MagnifyingGlass size={14} className="text-zinc-400" />}
                        placeholder="Search workflows"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        allowClear
                    />
                    <p className="m-0 text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        The agent calls the chosen workflow as a tool; it runs server-side and
                        returns its output.
                    </p>
                    {bridge.workflowsLoading ? (
                        <div className="flex justify-center py-6">
                            <Spin size="small" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                                <span className="text-xs text-zinc-400">
                                    No workflows to reference
                                </span>
                            }
                        />
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {filtered.map((wf) => (
                                <button
                                    type="button"
                                    key={wf.id}
                                    onClick={() => setSelected(wf)}
                                    className="flex w-full flex-col items-start gap-0.5 rounded-md border-none bg-transparent px-2 py-2 text-left cursor-pointer hover:bg-zinc-50 dark:hover:bg-[var(--ag-rgba-051729-04)]"
                                >
                                    <div className="flex w-full items-center gap-2">
                                        <GraphIcon size={14} className="shrink-0 text-teal-600" />
                                        <span className="truncate text-xs font-medium">
                                            {wf.name || wf.slug}
                                        </span>
                                    </div>
                                    <span className="truncate pl-6 text-[11px] text-zinc-400">
                                        {wf.description || wf.slug}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <button
                        type="button"
                        onClick={() => setSelected(null)}
                        className="flex w-fit items-center gap-1 border-none bg-transparent p-0 text-xs text-zinc-500 cursor-pointer hover:text-zinc-700"
                    >
                        <ArrowLeft size={12} />
                        Back to workflows
                    </button>

                    <div className="flex items-center gap-2">
                        <GraphIcon size={16} className="shrink-0 text-teal-600" />
                        <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm font-medium">
                                {selected.name || selected.slug}
                            </span>
                            <span className="truncate text-[11px] text-zinc-400">
                                {selected.slug}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-zinc-500">Reference by</span>
                        <Segmented
                            size="small"
                            value={refBy}
                            onChange={(val) => setRefBy(val as "variant" | "environment")}
                            options={[
                                {label: "Variant", value: "variant"},
                                {label: "Environment", value: "environment"},
                            ]}
                        />
                    </div>

                    {refBy === "variant" ? (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-zinc-500">Version</span>
                            <Select
                                size="small"
                                value={version ?? LATEST_VALUE}
                                onChange={(val) =>
                                    setVersion(val === LATEST_VALUE ? undefined : val)
                                }
                                loading={revisionsLoading}
                                options={[
                                    {label: "Latest", value: LATEST_VALUE},
                                    ...revisions.map((r) => ({
                                        label: r.label
                                            ? `v${r.version} — ${r.label}`
                                            : `v${r.version}`,
                                        value: r.version,
                                    })),
                                ]}
                            />
                            <span className="text-[11px] text-zinc-400">
                                Latest follows the workflow&apos;s newest revision; a pinned version
                                always calls that revision.
                            </span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-zinc-500">Environment</span>
                            <Select
                                size="small"
                                placeholder="Select an environment"
                                value={environment}
                                onChange={(val) => setEnvironment(val)}
                                loading={environmentsLoading}
                                notFoundContent={
                                    environmentsLoading ? (
                                        <Spin size="small" />
                                    ) : (
                                        <span className="text-xs text-zinc-400">
                                            No environments deployed
                                        </span>
                                    )
                                }
                                options={environments.map((env) => ({
                                    label: env.name || env.slug,
                                    value: env.slug,
                                }))}
                            />
                            <span className="text-[11px] text-zinc-400">
                                Calls whatever revision is deployed in the chosen environment.
                            </span>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                        <Button size="small" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            disabled={!canConfirm}
                            onClick={handleConfirm}
                        >
                            Add reference
                        </Button>
                    </div>
                </div>
            )}
        </EnhancedDrawer>
    )
}
