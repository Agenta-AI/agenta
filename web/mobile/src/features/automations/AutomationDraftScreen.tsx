import {useCallback} from "react"

import {
    AutomationCreateBody,
    AutomationTriggerDrawers,
    useAutomationCreate,
} from "@agenta/automation-ui"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {Button, Spinner} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"

import {AutomationScreenHeader} from "./AutomationScreenHeader"

export const AutomationDraftScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const t = useT(automationsScreensCatalog)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`

    // `?agent=` preselects the agent picked on the empty Automations page.
    const agent = router.query.agent
    const state = useAutomationCreate({defaultAgentId: typeof agent === "string" ? agent : null})

    const onCreate = useCallback(async () => {
        const created = await state.create()
        if (created?.id) await router.push(`${base}/automations/${created.id}`)
    }, [base, router, state])

    return (
        <>
            <PageTitle
                title={t("automations.screens.pageTitle")}
                context={t("automations.screens.newAutomation")}
            />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <AutomationScreenHeader
                            back={{
                                label: t("automations.screens.pageTitle"),
                                href: `${base}/automations`,
                            }}
                            backHref={`${base}/automations`}
                            className="mx-auto box-border w-full max-w-content-sm px-4 md:px-6"
                        />
                    }
                >
                    {/* pt-1: the name field's focus ring would otherwise be clipped by the scroller's edge.
                        A phone takes back the 4px the header gives up, as the detail screen does. */}
                    <div className="mx-auto box-border flex w-full max-w-content-sm flex-col px-4 pb-18 pt-1 max-md:pt-2 md:px-6">
                        <AutomationCreateBody
                            state={state}
                            autoEditName
                            footer={
                                <div className="mt-8 flex items-center justify-end gap-2 border-0 border-t border-solid border-border pt-5">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => void router.push(`${base}/automations`)}
                                    >
                                        {t("automations.screens.cancel")}
                                    </Button>
                                    {/* Always pressable. A press with something missing does
                                        not create; it turns the missing fields red, which is
                                        how the reader learns what to do. */}
                                    <Button
                                        type="button"
                                        disabled={state.saving}
                                        onClick={() => void onCreate()}
                                    >
                                        {/* Creating writes a trigger and, for a schedule,
                                                its first run — long enough that a button which
                                                only greys out reads as broken. */}
                                        {state.saving ? <Spinner data-icon="inline-start" /> : null}
                                        {t("automations.screens.createAutomation")}
                                    </Button>
                                </div>
                            }
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            <AutomationTriggerDrawers />
        </>
    )
}
