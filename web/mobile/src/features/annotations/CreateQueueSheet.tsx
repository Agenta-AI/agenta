import {useRef, useState, type CSSProperties} from "react"

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
    const {submit, close, isSubmitting, selection, followUp} = useCreateQueue()
    const contentRef = useRef<HTMLDivElement>(null)
    // With input in the form, only Cancel or the close button discard it.
    const [dirty, setDirty] = useState(false)
    const guarded = isSubmitting || dirty

    return (
        <Sheet open={open} onOpenChange={(next) => !next && close()}>
            <SheetContent
                side="right"
                style={SHEET_WIDTH}
                className="overflow-hidden"
                ref={contentRef}
                // Escape and an overlay click do nothing while the form has input or is submitting.
                onEscapeKeyDown={(event) => {
                    const fromSheet = contentRef.current?.contains(event.target as Node) ?? false
                    if (guarded || !fromSheet) event.preventDefault()
                }}
                onPointerDownOutside={(event) => guarded && event.preventDefault()}
                onInteractOutside={(event) => guarded && event.preventDefault()}
            >
                <SheetHeader showCloseButton={!isSubmitting}>
                    <SheetTitle>Create annotation queue</SheetTitle>
                    <SheetDescription className="sr-only">
                        Name the queue, choose its type and pick the evaluators that review it.
                    </SheetDescription>
                </SheetHeader>
                {open ? (
                    <CreateQueueForm
                        defaultKind={selection?.itemType ?? followUp?.itemType ?? defaultKind}
                        kindLocked={Boolean(selection || followUp)}
                        isSubmitting={isSubmitting}
                        onSubmit={(values) => void submit(values)}
                        onCancel={close}
                        onDirtyChange={setDirty}
                    />
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
