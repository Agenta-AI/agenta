/** The schedule drawer's agent picker — settings only; the playground already knows the agent. */
import {useMemo} from "react"

import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

// ---------------------------------------------------------------------------
// AgentField — picks the application a schedule runs. Sources the same
// `appWorkflowsListQueryStateAtom` the workflow-revision cascader used at its root, so the
// pickable set is unchanged; the version tier moved to VersionField under Advanced.
// ---------------------------------------------------------------------------

export function AgentField({
    workflowId,
    onChange,
    disabled,
}: {
    workflowId: string | null
    onChange: (workflowId: string) => void
    disabled?: boolean
}) {
    const workflows = useAtomValue(appWorkflowsListQueryStateAtom)

    const options = useMemo(
        () =>
            workflows.data.map((w) => ({
                id: w.id as string,
                label: w.name?.trim() || w.slug?.trim() || "Untitled agent",
            })),
        [workflows.data],
    )

    return (
        <Select value={workflowId ?? undefined} onValueChange={onChange} disabled={disabled}>
            {/* Derive the height from padding + line-height like Input does, so this lines up
                with the Name field. SelectTrigger's own `h-control` is 2px shorter. */}
            <SelectTrigger className="h-auto py-input-y">
                <span className="flex min-w-0 items-center gap-2">
                    {/* A selection carries its own icon over from the item; this covers the
                        placeholder state, which has no item to render. */}
                    {workflowId ? null : (
                        <Robot size={14} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
                    )}
                    <SelectValue placeholder="Select an agent" />
                </span>
            </SelectTrigger>
            <SelectContent className="max-h-[280px]">
                {workflows.isPending ? (
                    <div className="flex justify-center py-3">
                        <Spinner size="small" />
                    </div>
                ) : null}
                {!workflows.isPending && options.length === 0 ? (
                    <span className="block px-3 py-2 text-field-md text-[var(--ag-colorTextDescription)]">
                        No agents found.
                    </span>
                ) : null}
                {options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                        <span className="flex min-w-0 items-center gap-2">
                            <Robot
                                size={14}
                                className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                            />
                            <span className="min-w-0 truncate">{o.label}</span>
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
