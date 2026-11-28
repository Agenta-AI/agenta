import {Fragment} from "react"

import {AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import type {SkillOriginInfo, SkillUsageItem} from "@agenta/skills"
import {SimpleTooltip} from "@agenta/ui/composed"
import {cn} from "@agenta/ui/styles"
import {MENU_ITEM, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {ArrowCircleUp} from "@phosphor-icons/react"
import Link from "next/link"

import {agentEntryHref} from "../agents/agentEntry"

import {SkillSourcePopover} from "./SkillSourcePopover"

const Dot = () => <span aria-hidden>·</span>

/** The line under the skill's name: repo · Used by · Edited · Update available. */
export const SkillPageMeta = ({
    base,
    origin,
    usedBy,
    edited,
    updateAvailable,
    updateBlocked,
    onApplyUpdate,
}: {
    base: string
    origin: SkillOriginInfo | null
    /** Null while unknown (loading or failed): the item is left out. */
    usedBy: SkillUsageItem[] | null
    /** "3d ago", or empty. */
    edited: string
    updateAvailable: boolean
    /** Unsaved edits: the update waits for Save or Discard. */
    updateBlocked?: boolean
    onApplyUpdate: () => void
}) => {
    const t = useT(skillsPageCatalog)
    const usedText = usedBy?.length
        ? t("skills.page.usedBy", {count: usedBy?.length ?? 0})
        : t("skills.page.notUsed")
    const usage =
        usedBy === null ? null : usedBy.length ? (
            <Popover key="usage">
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-[inherit] text-label text-muted-foreground hover:text-foreground hover:underline focus-ring"
                    >
                        {usedText}
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="flex w-popover-sm flex-col p-1">
                    {usedBy.map((agent) => {
                        const id = agent.agent_workflow_id ?? ""
                        const name = agent.agent_name ?? agent.agent_slug ?? ""
                        const row = (
                            <>
                                <AgentChip workflowId={id || null} size={16} />
                                <span className="min-w-0 truncate">{name}</span>
                            </>
                        )
                        // An agent without an id cannot be opened: a plain row, not a dead link.
                        return id ? (
                            <Link
                                key={id}
                                href={agentEntryHref(base, id)}
                                className={cn(
                                    MENU_ITEM,
                                    "text-foreground no-underline hover:bg-accent focus-visible:bg-accent",
                                )}
                            >
                                {row}
                            </Link>
                        ) : (
                            <div
                                key={name}
                                className={cn(MENU_ITEM, "cursor-default text-foreground")}
                            >
                                {row}
                            </div>
                        )
                    })}
                </PopoverContent>
            </Popover>
        ) : (
            <span key="usage">{usedText}</span>
        )
    const update = updateAvailable ? (
        <SimpleTooltip key="update" title={updateBlocked ? t("skills.page.saveFirst") : undefined}>
            <button
                type="button"
                onClick={onApplyUpdate}
                disabled={updateBlocked}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 font-[inherit] text-label text-warning hover:underline focus-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
            >
                <ArrowCircleUp aria-hidden size={14} />
                {t("skills.page.updateAvailable")}
            </button>
        </SimpleTooltip>
    ) : null
    const parts = [
        origin?.repository ? <SkillSourcePopover key="source" origin={origin} /> : null,
        usage,
        edited ? <span key="edited">{t("skills.page.edited", {age: edited})}</span> : null,
        update,
    ].filter(Boolean)
    return (
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-muted-foreground">
            {parts.map((part, index) => (
                <Fragment key={index}>
                    {index ? <Dot /> : null}
                    {part}
                </Fragment>
            ))}
        </div>
    )
}
