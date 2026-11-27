import {useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import whatsNewCatalog from "@agenta/i18n/catalogs/education.whatsNew"
import {
    ALL_RELEASES_LINK,
    notInstalledReleasesAtom,
    runningVersionAtom,
    UPGRADE_GUIDE_LINK,
    updateSizeAtom,
    upgradeMethodAtom,
    type UpgradeMethod,
} from "@agenta/navigation"
import {UPDATE_SIZE_COLOR} from "@agenta/navigation-ui"
import {isEE} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {ArrowUpRight, Check, Copy, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {cn} from "@/lib/utils"

import {useProjectPermissionState} from "../context/useProjectPermission"

import {upgradeCommands} from "./upgradeCommands"

const PROMPT_SETUP = {
    compose: "education.whatsNew.promptSetupCompose",
    helm: "education.whatsNew.promptSetupHelm",
    railway: "education.whatsNew.promptSetupRailway",
} as const satisfies Record<UpgradeMethod, string>

/**
 * The top of the What's new dialog when the instance is behind: how far behind, whether a
 * missing release fixes a security issue, and how to upgrade. Owners and admins of an open
 * source install with a known deployment method also get the commands for it and a prompt for a
 * coding agent; members are told to ask the person who runs the server. Never on cloud, where
 * nothing is "not installed".
 */
export const UpgradeBox = () => {
    const t = useT(whatsNewCatalog, commonCatalog)
    const notInstalled = useAtomValue(notInstalledReleasesAtom)
    const running = useAtomValue(runningVersionAtom)
    const size = useAtomValue(updateSizeAtom)
    const detectedMethod = useAtomValue(upgradeMethodAtom)
    const projectId = useAtomValue(projectIdAtom)
    const behind = notInstalled.length > 0
    // The same rule as the security bar: the roles that may change roles.
    const permission = useProjectPermissionState(
        behind ? (projectId ?? "") : "",
        "modify_user_roles",
    )
    const [copied, setCopied] = useState<"commands" | "prompt" | null>(null)

    const latest = notInstalled[0]
    if (!latest || !running || !size) return null

    // The commands are for the open source files; Enterprise installs follow the guide.
    const method = isEE() ? null : detectedMethod
    const securityCount = notInstalled.filter((release) => release.securityFix).length
    const extraSteps = notInstalled.filter((release) => release.upgradeNotesLink)
    const commands = method
        ? upgradeCommands(method, latest.id, t("education.whatsNew.commandsCloneFolder"))
        : null
    const copy = async (what: "commands" | "prompt", text: string) => {
        if (await copyToClipboard(text)) setCopied(what)
    }

    return (
        <section
            aria-label={t("education.whatsNew.releasesBehind", {count: notInstalled.length})}
            data-testid="upgrade-box"
            className="flex flex-col gap-3 rounded-xl border border-solid border-border-muted bg-muted p-4 sm:mr-8"
        >
            {/* The count first, readable at a glance, in the color of the update marks. */}
            <span className="flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
                <span
                    aria-hidden
                    data-update-size={size}
                    className={cn("size-2 rounded-round", UPDATE_SIZE_COLOR[size].bg)}
                />
                {t("education.whatsNew.releasesBehind", {count: notInstalled.length})}
            </span>
            <div className="flex flex-col gap-1">
                <p className="m-0 text-title font-semibold text-foreground">
                    {t("education.whatsNew.upgradeVersions", {running, latest: latest.id})}
                </p>
                <p className="m-0 text-body-sm leading-5 text-muted-foreground">
                    {t("education.whatsNew.notInstalledCount", {count: notInstalled.length})}
                    {securityCount > 0 ? (
                        <>
                            {" "}
                            <span className="font-medium text-destructive">
                                {t("education.whatsNew.securityFixCount", {count: securityCount})}
                            </span>
                        </>
                    ) : null}
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                    <a href={UPGRADE_GUIDE_LINK} target="_blank" rel="noreferrer">
                        {t("education.whatsNew.howToUpgrade")}
                        <ArrowUpRight aria-hidden />
                    </a>
                </Button>
            </div>

            {/* Nothing until the permission check answers, so an admin never sees the member line. */}
            {permission.pending ? null : !permission.allowed ? (
                <p className="m-0 text-body-sm text-muted-foreground">
                    {t("education.whatsNew.askAdmin")}
                </p>
            ) : method && commands ? (
                <div className="flex flex-col gap-2">
                    {extraSteps.map((release) => (
                        <p
                            key={release.id}
                            className="m-0 rounded-lg border border-solid border-warning/30 bg-warning/10 px-3 py-2 text-body-sm leading-5 text-warning"
                        >
                            <strong>
                                {t("education.whatsNew.extraSteps", {version: release.id})}
                            </strong>{" "}
                            <a
                                href={release.upgradeNotesLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-inherit underline underline-offset-2"
                            >
                                {t("education.whatsNew.extraStepsLink")}
                            </a>
                        </p>
                    ))}
                    <span className="text-meta font-medium text-muted-foreground">
                        {t("education.whatsNew.commandsTitle")}
                    </span>
                    <pre className="m-0 overflow-x-auto rounded-lg border border-solid border-border-muted bg-background p-3 font-mono text-meta leading-[1.6] text-foreground">
                        <code>{commands}</code>
                    </pre>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copy("commands", commands)}
                        >
                            {copied === "commands" ? <Check aria-hidden /> : <Copy aria-hidden />}
                            {copied === "commands"
                                ? t("common.copied")
                                : t("education.whatsNew.copyCommands")}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                                copy(
                                    "prompt",
                                    t("education.whatsNew.agentPrompt", {
                                        running,
                                        latest: latest.id,
                                        setup: t(PROMPT_SETUP[method]),
                                        guide: UPGRADE_GUIDE_LINK,
                                        changelog: ALL_RELEASES_LINK,
                                    }),
                                )
                            }
                        >
                            {copied === "prompt" ? <Check aria-hidden /> : <Robot aria-hidden />}
                            {copied === "prompt"
                                ? t("common.copied")
                                : t("education.whatsNew.copyPrompt")}
                        </Button>
                    </div>
                    <p className="m-0 text-meta leading-[1.5] text-muted-foreground">
                        {t("education.whatsNew.commandsNote", {latest: latest.id})}
                    </p>
                </div>
            ) : null}
        </section>
    )
}
