/**
 * The blast-radius panel of the skill save dialog (5b): vN → vN+1, per-agent effect, and
 * the running-sessions note. The dialog SHELL is EntityCommitModal (adapter or onSubmit
 * override, wired in W4); this is the content that replaces silent auto-commit for skills.
 */
import {ArrowRight} from "@phosphor-icons/react"

import {VersionTag} from "./SkillCard"
import type {SkillUsageRef} from "./types"

export interface SkillSaveBlastRadiusProps {
    /** The version being replaced, e.g. "3". */
    fromVersion: string
    /** The version this save creates, e.g. "4". */
    toVersion: string
    /** Every agent that embeds this skill. Empty = safe note instead of a list. */
    usedBy: SkillUsageRef[]
}

function effectLabel(agent: SkillUsageRef, toVersion: string): string {
    if (agent.mode === "pinned")
        return `stays pinned to v${agent.pinnedVersion ?? "?"} — not affected`
    return `gets v${toVersion} on its next session`
}

export function SkillSaveBlastRadius({fromVersion, toVersion, usedBy}: SkillSaveBlastRadiusProps) {
    const following = usedBy.filter((agent) => agent.mode === "latest").length

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <VersionTag version={fromVersion} />
                <ArrowRight size={12} className="text-[var(--ag-colorTextTertiary)]" />
                <VersionTag version={toVersion} />
                <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                    {following
                        ? `${following} ${following === 1 ? "agent follows" : "agents follow"} latest and will pick this up.`
                        : "No agent follows latest — this save affects only the registry."}
                </span>
            </div>

            {usedBy.length ? (
                <div className="flex flex-col overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)]">
                    {usedBy.map((agent) => (
                        <div
                            key={agent.id}
                            className="flex items-center justify-between gap-2 border-0 border-t border-solid border-[var(--ag-colorSplit)] px-3 py-2 first:border-t-0"
                        >
                            <span className="min-w-0 truncate text-xs font-medium">
                                {agent.name}
                            </span>
                            <span className="shrink-0 text-xs text-[var(--ag-colorTextSecondary)]">
                                {effectLabel(agent, toVersion)}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}

            <p className="m-0 text-xs text-[var(--ag-colorTextTertiary)]">
                Running sessions finish on the version they started with.
            </p>
        </div>
    )
}
