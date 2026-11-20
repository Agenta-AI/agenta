import {useEffect} from "react"

import {useAutomationEditor} from "@agenta/automation-ui"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useViewStack} from "@agenta/ui/view-stack"

import {automationView} from "../automations/automationView"

import {PaneNotice} from "./PaneNotice"

/** Opens the automation view as soon as the automation's kind is known. */
export const AutomationTabRoot = ({
    automationId,
    workspaceId,
    projectId,
}: {
    automationId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog, automationsScreensCatalog)
    const stack = useViewStack()
    const editor = useAutomationEditor(automationId)
    const kind = editor.automation?.kind
    // The automation view is the tab's only content: it opens once the kind is known, and again
    // when Done, Escape or the root crumb leaves it.
    const atRoot = stack.depth === 0
    useEffect(() => {
        if (kind && atRoot)
            void stack.open(
                automationView,
                {automationId, kind, workspaceId, projectId},
                {kind: "project"},
            )
        // stack is a new object on each change; atRoot is the dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [automationId, kind, atRoot])
    // The list could not load: a load error with retry, not "no access".
    if (editor.loadFailed)
        return (
            <div className="p-4">
                <LoadError
                    framed
                    title={t("automations.screens.loadFailed")}
                    onRetry={editor.retry}
                />
            </div>
        )
    if (editor.missing) return <PaneNotice>{t("builder.page.noAccess")}</PaneNotice>
    if (!kind)
        return (
            <div className="flex flex-col gap-3 p-4" aria-busy>
                <SkeletonBlock active className="h-12 w-full" />
                <SkeletonBlock active className="h-24 w-full" />
            </div>
        )
    return null
}
