import {useCallback, useMemo} from "react"

import {
    AUTOMATION_TEMPLATES,
    AutomationBackLink,
    AutomationCreateBody,
    AutomationTriggerDrawers,
    useAutomationCreate,
} from "@agenta/automation-ui"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {Button} from "@/components/ui/button"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

export const AutomationDraftScreen = ({
    workspaceId,
    projectId,
    templateId,
}: {
    workspaceId: string
    projectId: string
    /** `?template=` from the empty state's cards — seeds the name and description only. */
    templateId?: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`

    const template = useMemo(
        () => AUTOMATION_TEMPLATES.find((candidate) => candidate.id === templateId) ?? null,
        [templateId],
    )

    const state = useAutomationCreate({template})

    const onCreate = useCallback(async () => {
        const created = await state.create()
        if (created?.id) await router.push(`${base}/automations/${created.id}`)
    }, [base, router, state])

    return (
        <>
            <PageTitle title="Automations" context="New automation" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="mx-auto w-full max-w-[760px] shrink-0 px-8 pb-3.5 pt-[30px]">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <AutomationBackLink href={`${base}/automations`} />
                            </div>
                        </div>
                    }
                >
                    <div className="mx-auto flex w-full max-w-[760px] flex-col px-8 pb-[70px]">
                        <AutomationCreateBody
                            state={state}
                            autoEditName={!template}
                            footer={
                                <div className="mt-[30px] flex items-center justify-end gap-2.5 border-0 border-t border-solid border-border pt-5">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="text-xs font-normal"
                                        onClick={() => void router.push(`${base}/automations`)}
                                    >
                                        Cancel
                                    </Button>
                                    {/* A disabled button takes no pointer events, so the reason
                                        has to hang off something that does. */}
                                    <span title={state.blockedReason || undefined}>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="text-xs font-normal"
                                            disabled={!!state.blockedReason || state.saving}
                                            title={state.blockedReason || undefined}
                                            onClick={() => void onCreate()}
                                        >
                                            Create automation
                                        </Button>
                                    </span>
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
