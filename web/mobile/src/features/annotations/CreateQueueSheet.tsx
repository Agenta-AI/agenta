import type {CSSProperties} from "react"

import {createQueueDrawerDefaultKindAtom, createQueueDrawerOpenAtom} from "@agenta/annotation"
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {CreateQueueForm} from "./CreateQueueForm"
import {useCreateQueue} from "./useCreateQueue"

const SHEET_WIDTH = {"--ag-sheet-responsive-width": "560px"} as CSSProperties

/**
 * The create queue sheet. The three `@agenta/annotation` atoms drive it, so the queue list and the
 * add-to-queue picker share it. The form mounts only while the sheet is open.
 */
export const CreateQueueSheet = () => {
    const open = useAtomValue(createQueueDrawerOpenAtom)
    const defaultKind = useAtomValue(createQueueDrawerDefaultKindAtom)
    const {submit, close, isSubmitting, selection} = useCreateQueue()

    return (
        <Sheet open={open} onOpenChange={(next) => !next && close()}>
            <SheetContent
                side="right"
                style={SHEET_WIDTH}
                className="overflow-hidden"
                // Close, Escape and a click on the overlay do nothing while the request runs.
                onEscapeKeyDown={(event) => isSubmitting && event.preventDefault()}
                onPointerDownOutside={(event) => isSubmitting && event.preventDefault()}
                onInteractOutside={(event) => isSubmitting && event.preventDefault()}
            >
                <SheetHeader showCloseButton={!isSubmitting}>
                    <SheetTitle>Create annotation queue</SheetTitle>
                    <SheetDescription className="sr-only">
                        Name the queue, choose its type and pick the evaluators that review it.
                    </SheetDescription>
                </SheetHeader>
                {open ? (
                    <CreateQueueForm
                        defaultKind={selection?.itemType ?? defaultKind}
                        kindLocked={Boolean(selection)}
                        isSubmitting={isSubmitting}
                        onSubmit={(values) => void submit(values)}
                        onCancel={close}
                    />
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
