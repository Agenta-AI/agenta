import {IconTile} from "@agenta/ui/composed"
import {RobotIcon} from "@phosphor-icons/react"

import type {RuleExample} from "../types"

const agents = [
    ["Weekly report", "Writes one status report for the team."],
    ["Release notes", "Drafts notes for a GitHub release."],
    ["Bug triage", "Rates bug reports and proposes a fix."],
]

/** Three two-line rows; the second and third are hovered and selected, so the gap shows. */
function TwoLineRows({gap}: {gap: string}) {
    return (
        <div className={`flex w-72 flex-col ${gap}`}>
            {agents.map(([name, description], i) => (
                <div
                    key={name}
                    className={`flex h-row-double items-center gap-3 rounded-md px-3 ${i === 1 ? "bg-accent" : i === 2 ? "bg-selected" : ""}`}
                >
                    <IconTile size={32}>
                        <RobotIcon />
                    </IconTile>
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate text-label">{name}</span>
                        <span className="truncate text-meta text-muted-foreground">
                            {description}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    )
}

export const rowGapRules: RuleExample[] = [
    {
        id: "ROW-04",
        do: {
            example: <TwoLineRows gap="gap-2" />,
            caption:
                "Two-line rows 8px apart: the hovered and the selected row each stand on their own.",
            code: `<div className="flex flex-col gap-2">{rows}</div>`,
        },
        avoid: {
            example: <TwoLineRows gap="gap-0" />,
            caption: "Two-line rows that touch: the hover and the selection run into one block.",
        },
    },
]
