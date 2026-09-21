import {useCallback} from "react"

import {
    AutomationCreateBody,
    AutomationTriggerDrawers,
    useAutomationCreate,
} from "@agenta/automation-ui"
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
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`

    const state = useAutomationCreate()

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
                        <AutomationScreenHeader
                            workspaceId={workspaceId}
                            projectId={projectId}
                            title="New automation"
                            backHref={`${base}/automations`}
                        />
                    }
                >
                    {/* pt-1: the name field's focus ring would otherwise be clipped by the scroller's edge. */}
                    <div className="mx-auto flex w-full max-w-[760px] flex-col px-8 pb-[70px] pt-1">
                        <AutomationCreateBody
                            state={state}
                            autoEditName
                            footer={
                                <div className="mt-[30px] flex items-center justify-end gap-2.5 border-0 border-t border-solid border-border pt-5">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => void router.push(`${base}/automations`)}
                                    >
                                        Cancel
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
                                        Create automation
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
