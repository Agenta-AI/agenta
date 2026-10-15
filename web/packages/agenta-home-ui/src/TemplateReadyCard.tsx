import type {ReactNode} from "react"

import {IconTile} from "@agenta/ui/ui"
import {ChatCircleDotsIcon, CheckIcon, FileZipIcon, PlusIcon} from "@phosphor-icons/react"

/** "chief-of-staff-1.0.0.zip" or "owner/repo/pkg/1.0.0" → "Chief of staff". */
export const templateDisplayName = (label: string, version: string) => {
    const segment =
        label
            .split("/")
            .filter((part) => part && part !== version)
            .pop() ?? label
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const slug = segment.replace(/\.zip$/i, "").replace(new RegExp(`[-_]v?${escaped}$`), "")
    const words = slug.replace(/[-_]+/g, " ").trim()
    return words ? words[0].toUpperCase() + words.slice(1) : label
}

const STEPS: {key: string; icon: ReactNode; kicker: string; text: string}[] = [
    {key: "checked", icon: <CheckIcon />, kicker: "Checked", text: "The package is valid."},
    {
        key: "create",
        icon: <PlusIcon />,
        kicker: "Create",
        text: "A new agent is made from it. Its automations stay off.",
    },
    {
        key: "session",
        icon: <ChatCircleDotsIcon />,
        kicker: "First session",
        text: "The agent asks for any connections it needs.",
    },
]

/** The checked package and what Create does with it, drawn like a template's "How it works". */
export const TemplateReadyCard = ({label, version}: {label: string; version: string}) => (
    <div className="flex flex-col gap-5">
        <div className="flex min-w-0 items-center gap-3">
            <IconTile size={28} tone="muted">
                <FileZipIcon />
            </IconTile>
            <span
                className="min-w-0 flex-1 truncate text-base font-semibold text-foreground"
                title={label}
            >
                {templateDisplayName(label, version)}
            </span>
        </div>
        <ol className="m-0 flex list-none flex-col p-0">
            {STEPS.map((step, index) => (
                <li key={step.key} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                    <div className="flex flex-col items-center">
                        <IconTile size={28} tone={index === 0 ? "info" : "muted"}>
                            {step.icon}
                        </IconTile>
                        {index < STEPS.length - 1 ? (
                            <span
                                aria-hidden
                                className="my-1 min-h-2 w-0 flex-1 border-y-0 border-l border-r-0 border-dashed border-border"
                            />
                        ) : null}
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5 pb-3">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {step.kicker}
                        </span>
                        <span className="text-sm text-foreground">{step.text}</span>
                    </div>
                </li>
            ))}
        </ol>
    </div>
)
