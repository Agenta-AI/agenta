import {useRef} from "react"

import {CustomProviderForm, type CustomProviderFormHandle} from "@agenta/entity-ui/secretProvider"
import type {LlmProvider} from "@agenta/shared/types"

import {Button} from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

/**
 * Add or edit an OpenAI-compatible endpoint. The form itself is the SHARED
 * `CustomProviderForm` the desktop drawer renders — it is already antd-free, so this supplies
 * only the surface and the footer that drives its imperative submit.
 */
export const CustomEndpointSheet = ({
    open,
    provider,
    onClose,
}: {
    open: boolean
    /** The endpoint being edited, or null when adding. */
    provider: LlmProvider | null
    onClose: () => void
}) => {
    const formRef = useRef<CustomProviderFormHandle | null>(null)

    const close = () => {
        formRef.current?.reset()
        onClose()
    }

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) close()
            }}
        >
            <SheetContent side="bottom">
                <SheetHeader>
                    <SheetTitle>{provider ? "Edit endpoint" : "Add endpoint"}</SheetTitle>
                    <SheetDescription>
                        Point Agenta at a self-hosted or proxied model that speaks the OpenAI API.
                    </SheetDescription>
                </SheetHeader>

                {/* Mounted only while open so the shared form re-runs its own reset-on-open. */}
                {open ? (
                    <div className="px-4">
                        <CustomProviderForm
                            formRef={formRef}
                            selectedProvider={provider}
                            onClose={onClose}
                        />
                    </div>
                ) : null}

                <SheetFooter>
                    <Button onClick={() => formRef.current?.submit()}>
                        {provider ? "Save" : "Add endpoint"}
                    </Button>
                    <Button variant="outline" onClick={close}>
                        Cancel
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
