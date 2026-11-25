import {memo, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"
import type {SkillOriginInfo} from "@agenta/skills"
import {IconTile, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretDown, GithubLogo} from "@phosphor-icons/react"

import {skillGithubUrl} from "./skillRoutes"

/** The repo name in the meta line; it opens where the skill came from. */
export const SkillSourcePopover = memo(function SkillSourcePopover({
    origin,
}: {
    origin: SkillOriginInfo
}) {
    const t = useT(skillsPageCatalog)
    const rows: [string, string, ReactNode][] = [
        ["repository", t("skills.page.repository"), origin.repository],
        ["folder", t("skills.page.folder"), origin.path || "/"],
        ["branch", t("skills.page.branch"), origin.ref || t("skills.page.defaultBranch")],
        [
            "version",
            t("skills.page.version"),
            origin.resolved_version ? (
                <code className="font-mono text-meta">{origin.resolved_version.slice(0, 7)}</code>
            ) : (
                t("skills.page.unknown")
            ),
        ],
    ]
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent p-0 font-[inherit] text-body text-foreground hover:underline"
                >
                    <GithubLogo aria-hidden size={14} />
                    {origin.repository}
                    <CaretDown aria-hidden size={12} className="text-muted-foreground" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-[320px] flex-col gap-3 p-3">
                <div className="flex items-center gap-2">
                    <IconTile size={24} aria-hidden>
                        <GithubLogo weight="fill" />
                    </IconTile>
                    <span className="min-w-0 truncate text-label font-medium text-foreground">
                        {origin.repository}
                    </span>
                </div>
                <dl className="m-0 flex flex-col gap-1.5">
                    {rows.map(([id, label, value]) => (
                        <div key={id} className="flex items-center gap-3 text-label">
                            <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
                            <dd className="m-0 min-w-0 truncate text-foreground">{value}</dd>
                        </div>
                    ))}
                </dl>
                <a
                    href={skillGithubUrl(origin)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-label text-link no-underline hover:underline"
                >
                    <ArrowSquareOut aria-hidden size={14} />
                    {t("skills.page.openOnGithub")}
                </a>
            </PopoverContent>
        </Popover>
    )
})
