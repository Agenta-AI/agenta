import {useMemo, useRef, useState, type ReactNode} from "react"

import {subscriptionProviderName} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import {BottomSheet, useIsPhone} from "@agenta/ui/phone"
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@agenta/ui/ui"
import type {ViewForm} from "@agenta/ui/view-stack"

import {OwnerField} from "../../accounts/OwnerField"

import {BuiltinModelsPanel} from "./BuiltinModelsPanel"
import {SubscriptionSignInPanel} from "./SubscriptionSignInPanel"
import {SubscriptionTokenPanel} from "./SubscriptionTokenPanel"
import {
    SubscriptionOwnerContext,
    subscriptionTokenView,
    subscriptionViewFor,
    type SubscriptionOwner,
    type SubscriptionViewParams,
} from "./subscriptionViews"

/** The kit dialog, or a bottom sheet on a phone; the host drops it once it has closed. */
const SheetFrame = ({
    title,
    open,
    onClose,
    onClosed,
    children,
}: {
    title: string
    open: boolean
    onClose: () => void
    onClosed: () => void
    children: ReactNode
}) => {
    const phone = useIsPhone()
    if (phone)
        return (
            <BottomSheet
                open={open}
                onOpenChange={(next) => (next ? undefined : onClose())}
                title={title}
                showTitle
                // The sign-in panels draw their own Cancel; the model list needs none.
                hideClose
                onCloseAutoFocus={onClosed}
            >
                <div className="px-4 pb-4">{children}</div>
            </BottomSheet>
        )
    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent onCloseAutoFocus={onClosed}>
                <DialogHeader>
                    <DialogTitle className="min-w-0 truncate">{title}</DialogTitle>
                </DialogHeader>
                {children}
            </DialogContent>
        </Dialog>
    )
}

/** One owner the dialog may sign in: the project (no context) or the organization. */
export interface SubscriptionSheetOwner {
    kind: "project" | "organization"
    context: SubscriptionOwner | null
}

/**
 * A ChatGPT sign-in or a Claude token in the kit dialog, for hosts without a view stack. With
 * two owners it asks for the Owner first, as the other connect dialogs do.
 */
export const SubscriptionSheet = ({
    params,
    owners,
    onClosed,
}: {
    params: SubscriptionViewParams
    owners: SubscriptionSheetOwner[]
    onClosed: () => void
}) => {
    const [open, setOpen] = useState(true)
    const close = () => setOpen(false)
    const [ownerKind, setOwnerKind] = useState(owners[0]?.kind ?? "project")
    const owner = owners.find((candidate) => candidate.kind === ownerKind) ?? owners[0]
    // A typed token or a changed project choice keeps the dialog open on Escape or an outside click.
    const dirtyRef = useRef(false)
    const trackForm = useMemo(
        () => (form: ViewForm) => {
            dirtyRef.current = form.dirty
        },
        [],
    )
    const dismiss = () => {
        if (!dirtyRef.current) close()
    }
    const token = subscriptionViewFor(params.provider) === subscriptionTokenView
    return (
        <SheetFrame
            title={subscriptionProviderName(params.provider)}
            open={open}
            onClose={dismiss}
            onClosed={onClosed}
        >
            <div className="flex flex-col gap-4">
                {owners.length > 1 ? (
                    <OwnerField
                        value={ownerKind}
                        owners={owners.map((candidate) => candidate.kind)}
                        onChange={(next) => {
                            dirtyRef.current = false
                            setOwnerKind(next)
                        }}
                    />
                ) : null}
                <SubscriptionOwnerContext.Provider value={owner?.context ?? null}>
                    {token ? (
                        <SubscriptionTokenPanel
                            key={ownerKind}
                            params={params}
                            onDone={close}
                            onCancel={close}
                            useForm={trackForm}
                            actionsPlacement="footer"
                        />
                    ) : (
                        <SubscriptionSignInPanel
                            key={ownerKind}
                            params={params}
                            onDone={close}
                            onCancel={close}
                            actionsPlacement="footer"
                        />
                    )}
                </SubscriptionOwnerContext.Provider>
            </div>
        </SheetFrame>
    )
}

/** The built-in models in the kit dialog. */
export const BuiltinModelsSheet = ({onClosed}: {onClosed: () => void}) => {
    const t = useT(providerListCatalog)
    const [open, setOpen] = useState(true)
    return (
        <SheetFrame
            title={t("entityUi.providerList.agenta")}
            open={open}
            onClose={() => setOpen(false)}
            onClosed={onClosed}
        >
            <BuiltinModelsPanel />
        </SheetFrame>
    )
}
