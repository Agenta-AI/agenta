import {useCallback} from "react"

import {
    AutomationBackLink,
    AutomationCreateBody,
    AutomationTriggerDrawers,
    useAutomationCreate,
} from "@agenta/automation-ui"
import {LoaderCircle} from "lucide-react"
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
                            autoEditName
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
                                    {/* Always pressable. A press with something missing does
                                        not create; it turns the missing fields red, which is
                                        how the reader learns what to do. */}
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="text-xs font-normal"
                                        disabled={state.saving}
                                        onClick={() => void onCreate()}
                                    >
                                        {/* Creating writes a trigger and, for a schedule,
                                                its first run — long enough that a button which
                                                only greys out reads as broken. Sized by class:
                                                lucide's `size` prop leaves the svg em-scaled. */}
                                        {state.saving ? (
                                            <LoaderCircle className="size-3 animate-spin" />
                                        ) : null}
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
