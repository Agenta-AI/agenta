import {cn} from "@agenta/ui/styles"

import {SkillCheckTile} from "./SkillCheckTile"

export interface SkillCandidate {
    key: string
    title: string
    description?: string | null
}

export interface UnavailableSkill {
    key: string
    title: string
    reason: string
}

/** Pickable skills as toggle rows, then the ones that cannot be added. */
export function SkillCandidateList({
    candidates,
    selected,
    onToggle,
    unavailable = [],
    disabled,
}: {
    candidates: SkillCandidate[]
    selected: ReadonlySet<string>
    onToggle: (key: string) => void
    unavailable?: UnavailableSkill[]
    disabled?: boolean
}) {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
                {candidates.map((candidate) => {
                    const on = selected.has(candidate.key)
                    return (
                        <label
                            key={candidate.key}
                            className={cn(
                                "group/check relative box-border flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-2 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
                                on ? "bg-accent" : "hover:bg-accent/50",
                            )}
                        >
                            <input
                                type="checkbox"
                                className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
                                checked={on}
                                disabled={disabled}
                                onChange={() => onToggle(candidate.key)}
                            />
                            <SkillCheckTile checked={on} size={32} />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm font-medium">
                                    {candidate.title}
                                </span>
                                {candidate.description ? (
                                    <span
                                        className="truncate text-[13px] leading-[18px] text-muted-foreground"
                                        title={candidate.description}
                                    >
                                        {candidate.description}
                                    </span>
                                ) : null}
                            </span>
                        </label>
                    )
                })}
            </div>
            {unavailable.length ? (
                <div className="flex flex-col gap-1 px-1 pt-1">
                    <span className="text-xs font-medium text-muted-foreground">Not available</span>
                    {unavailable.map((item) => (
                        <div
                            key={item.key}
                            className="flex items-baseline gap-2 py-1 text-[13px] leading-[18px] text-muted-foreground"
                        >
                            <span className="min-w-0 truncate text-foreground">{item.title}</span>
                            <span className="flex-1" />
                            <span className="shrink-0 text-right">{item.reason}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
