import {type ElementType, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentActionsCatalog from "@agenta/i18n/catalogs/entityUi.agentActions"
import {RobotIcon} from "@phosphor-icons/react"

import {agentAvatar} from "./AgentCard"
import {useAgentIconChrome} from "./agentIcon"
import {AgentIconPopover} from "./AgentIconPopover"
import {AgentNameInline, agentNameLabelClass, type AgentNameSize} from "./AgentNameInline"
import {AgentChip} from "./AgentPicker"
import {AGENT_CHIP_BOX, AGENT_CHIP_FALLBACK} from "./chrome"

export type AgentIdentitySize = AgentNameSize

const IDENTITY_SIZE: Record<
    AgentIdentitySize,
    {row: string; chip: string; glyph: number; initialsFallback: boolean; label: ElementType}
> = {
    // The gaps AgentPageHeader puts between its own icon and name slots.
    bar: {
        row: "flex min-w-0 items-center gap-2",
        chip: AGENT_CHIP_BOX,
        glyph: 13,
        initialsFallback: false,
        label: "span",
    },
    title: {
        row: "flex min-w-0 items-center gap-3",
        // A 32 px header Mark (CONS-01); the ::after box extends the hit area to 44 px.
        chip: "relative flex size-8 shrink-0 items-center justify-center rounded-md text-caption font-semibold after:absolute after:-inset-1.5 after:content-['']",
        glyph: 16,
        initialsFallback: true,
        label: "h1",
    },
}

export interface AgentIdentityProps {
    /** Workflow (artifact) id. Null = no agent resolved yet, so neither half is editable. */
    workflowId: string | null | undefined
    name: string
    /** `bar` is the playground header's 20px chip + 14/16px name; `title` a page's 28px + 24px. */
    size?: AgentIdentitySize
    /** Off for a surface that only shows the agent — no picker, no rename. */
    editable?: boolean
    /** Shown in place of the name while the agent record is still in flight. */
    namePlaceholder?: ReactNode
    /** Reflect a committed name back to the host (it keeps showing the live name). */
    onRenamed?: (name: string) => void
    /** Commit override. The desktop passes its app-management rename, which refreshes more caches. */
    onRename?: (id: string, name: string) => Promise<boolean>
    /** True when `name` already belongs to a different agent — blocks the commit without a modal. */
    isDuplicateName?: (name: string, selfId?: string) => boolean
    className?: string
}

/**
 * WHO the agent is, as one control: its icon (click to pick a glyph and colour) beside its name
 * (pencil or double-click to rename). Both halves are editable in place, so every surface that
 * shows an agent's identity offers the same two edits instead of hand-assembling one of them.
 *
 * The chip's geometry lives here, not at the call site — a host passes a size, not classes.
 */
export const AgentIdentity = ({
    workflowId,
    name,
    size = "bar",
    editable = true,
    namePlaceholder,
    onRenamed,
    onRename,
    isDuplicateName,
    className,
}: AgentIdentityProps) => {
    const t = useT(agentActionsCatalog)
    const spec = IDENTITY_SIZE[size]
    const Label = spec.label
    const avatar = agentAvatar(name, workflowId ?? "")
    // Never `text-white` AND the icon's colour utility: equal specificity leaves the winner to
    // stylesheet order, so the fallback owns the white and the custom icon owns its own.
    const chrome = useAgentIconChrome(workflowId, {
        size: spec.glyph,
        // The nav rail's Agents glyph, so the chip and the sidebar entry read as one thing.
        fallbackGlyph: spec.initialsFallback ? avatar.initials : <RobotIcon size={15} />,
        fallbackClassName: spec.initialsFallback ? "text-white" : AGENT_CHIP_FALLBACK,
    })

    const chip = (
        <span
            className={`${spec.chip} ${chrome.className}`}
            style={
                chrome.style ??
                (spec.initialsFallback ? {backgroundColor: avatar.color} : undefined)
            }
        >
            {chrome.glyph}
        </span>
    )

    const editing = editable && !!workflowId

    return (
        <div className={`${spec.row} ${className ?? ""}`}>
            {editing ? <AgentIconPopover workflowId={workflowId}>{chip}</AgentIconPopover> : chip}
            {namePlaceholder ??
                (editing ? (
                    <AgentNameInline
                        workflowId={workflowId}
                        name={name}
                        size={size}
                        as={spec.label}
                        onRenamed={onRenamed}
                        onRename={onRename}
                        isDuplicateName={isDuplicateName}
                    />
                ) : (
                    <Label className={agentNameLabelClass(size)}>
                        {name || t("entityUi.agentActions.agent")}
                    </Label>
                ))}
        </div>
    )
}

/**
 * The agent's Mark in a session header: the 24 px `AgentChip` with its 14 px glyph, so the header
 * draws the agent as every list does (CONS-02): its own colour when it has an icon, the neutral
 * fill when not. Editable: a click opens the icon picker, as on `AgentIdentity`.
 */
export const AgentKindBadge = ({
    workflowId,
    editable = true,
}: {
    workflowId: string | null | undefined
    editable?: boolean
}) => {
    const badge = (
        <span data-testid="agent-kind-badge" className="flex shrink-0">
            <AgentChip workflowId={workflowId ?? null} box="size-6" glyph={14} />
        </span>
    )
    return editable && workflowId ? (
        // The trigger is a control-height box (28 px) around the 24 px Mark, so the bar keeps one
        // height (SIZE-01); the hover fill shows it is a button.
        <AgentIconPopover
            workflowId={workflowId}
            triggerClassName="size-control-sm justify-center hover:bg-accent"
        >
            {badge}
        </AgentIconPopover>
    ) : (
        badge
    )
}
