/**
 * The blast-radius panel of the skill save dialog (5b): who this save reaches, per-agent
 * effect, and the running-sessions note. The dialog SHELL is EntityCommitModal (adapter or
 * onSubmit override, wired in W4); this replaces silent auto-commit for skills.
 */
import type {SkillUsageRef} from "./types"

export interface SkillSaveBlastRadiusProps {
    /** Every agent that embeds this skill. Empty = safe note instead of a list. */
    usedBy: SkillUsageRef[]
}

function effectLabel(agent: SkillUsageRef): string {
    if (agent.mode === "pinned") return "stays pinned — not affected"
    return "picks this up on its next session"
}

export function SkillSaveBlastRadius({usedBy}: SkillSaveBlastRadiusProps) {
    const following = usedBy.filter((agent) => agent.mode === "latest").length

    return (
        <div className="flex flex-col gap-3">
            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                {following
                    ? `${following} ${following === 1 ? "agent follows" : "agents follow"} the latest and will pick this up.`
                    : "No agent follows the latest — this save affects only the registry."}
            </span>

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
                                {effectLabel(agent)}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}

            <p className="m-0 text-xs text-[var(--ag-colorTextTertiary)]">
                Running sessions finish with the skill they started with.
            </p>
        </div>
    )
}
