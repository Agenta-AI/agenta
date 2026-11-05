import {useState} from "react"

import {createLocalDraftFromWorkflowRevision} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDown, Plus} from "@phosphor-icons/react"
import {useStore} from "jotai"

import {RevisionTree} from "./RevisionTree"

/**
 * "+ Compare" in the playground bar. The button copies the last revision on screen into a local
 * draft and shows it beside the others; the chevron lists the app's revisions to add one.
 * Nothing is saved: a local draft lives in the browser until it is committed.
 */
export const CompareButton = ({appId}: {appId: string}) => {
    const store = useStore()
    const [open, setOpen] = useState(false)

    const add = (revisionId: string) =>
        store.set(playgroundController.actions.setEntityIds, (ids) => [...ids, revisionId])

    const copyLast = () => {
        const last = store.get(playgroundController.selectors.entityIds()).at(-1)
        const draftId = last ? createLocalDraftFromWorkflowRevision(last) : null
        if (draftId) add(draftId)
    }

    return (
        <span className="inline-flex shrink-0">
            <Button variant="outline" size="sm" className="rounded-r-none" onClick={copyLast}>
                <Plus aria-hidden />
                <span className="max-sm:sr-only">Compare</span>
            </Button>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Compare options"
                        className="-ml-px rounded-l-none"
                    >
                        <CaretDown aria-hidden size={12} />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[296px] p-0">
                    {open ? (
                        <RevisionTree
                            appId={appId}
                            onSelect={(revisionId) => {
                                setOpen(false)
                                add(revisionId)
                            }}
                        />
                    ) : null}
                </PopoverContent>
            </Popover>
        </span>
    )
}
