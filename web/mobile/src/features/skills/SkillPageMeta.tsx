import {AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import type {SkillOriginInfo, SkillUsageItem} from "@agenta/skills"
import {cn} from "@agenta/ui/styles"
import {MENU_ITEM, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
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
    onApplyUpdate,
}: {
    base: string
    origin: SkillOriginInfo | null
    usedBy: SkillUsageItem[]
    /** "3d ago", or empty. */
    edited: string
    updateAvailable: boolean
    onApplyUpdate: () => void
}) => {
    const t = useT(skillsPageCatalog)
    const usedText = usedBy.length
        ? t("skills.page.usedBy", {count: usedBy.length})
        : t("skills.page.notUsed")
    return (
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-muted-foreground">
            {origin?.repository ? (
                <>
                    <SkillSourcePopover origin={origin} />
                    <Dot />
                </>
            ) : null}
            {usedBy.length ? (
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-[inherit] text-body text-muted-foreground hover:text-foreground hover:underline"
                        >
                            {usedText}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="flex w-64 flex-col p-1">
                        {usedBy.map((agent) => {
                            const id = agent.agent_workflow_id ?? ""
                            const name = agent.agent_name ?? agent.agent_slug ?? ""
                            return (
                                <Link
                                    key={id || name}
                                    href={id ? agentEntryHref(base, id) : "#"}
                                    className={cn(
                                        MENU_ITEM,
                                        "text-foreground no-underline hover:bg-accent focus-visible:bg-accent",
                                    )}
                                >
                                    <AgentChip workflowId={id || null} size={16} />
                                    <span className="min-w-0 truncate">{name}</span>
                                </Link>
                            )
                        })}
                    </PopoverContent>
                </Popover>
            ) : (
                <span>{usedText}</span>
            )}
            {edited ? (
                <>
                    <Dot />
                    <span>{t("skills.page.edited", {age: edited})}</span>
                </>
            ) : null}
            {updateAvailable ? (
                <>
                    <Dot />
                    <button
                        type="button"
                        onClick={onApplyUpdate}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 font-[inherit] text-body text-warning hover:underline"
                    >
                        <span aria-hidden className="size-1.5 rounded-round bg-warning" />
                        {t("skills.page.updateAvailable")}
                    </button>
                </>
            ) : null}
        </div>
    )
}
