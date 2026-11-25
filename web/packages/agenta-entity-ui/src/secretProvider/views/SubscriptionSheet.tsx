import {useState, type ReactNode} from "react"

import {subscriptionProviderName} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import {BottomSheet, useIsPhone} from "@agenta/ui/phone"
import {Sheet, SheetContent, SheetHeader, SheetTitle} from "@agenta/ui/ui"

import {BuiltinModelsPanel} from "./BuiltinModelsPanel"
import {SubscriptionSignInPanel} from "./SubscriptionSignInPanel"
import {SubscriptionTokenPanel} from "./SubscriptionTokenPanel"
import {subscriptionTokenView, subscriptionViewFor, type SubscriptionViewParams} from "./subscriptionViews"
import {useSubscriptionViewConnection} from "./useSubscriptionViewConnection"

/** The kit sheet, or a bottom sheet on a phone; the host drops it once it has closed. */
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
                onCloseAutoFocus={onClosed}
            >
                <div className="px-4 pb-4">{children}</div>
            </BottomSheet>
        )
    return (
        <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <SheetContent side="right" onCloseAutoFocus={onClosed}>
                <SheetHeader>
                    <SheetTitle className="min-w-0 truncate">{title}</SheetTitle>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">{children}</div>
            </SheetContent>
        </Sheet>
    )
}

/** A ChatGPT sign-in or a Claude token in the kit sheet, for hosts without a view stack. */
export const SubscriptionSheet = ({
    params,
    onClosed,
}: {
    params: SubscriptionViewParams
    onClosed: () => void
}) => {
    const [open, setOpen] = useState(true)
    const close = () => setOpen(false)
    const {connection} = useSubscriptionViewConnection(params)
    const title = connection?.name || subscriptionProviderName(params.provider)
    const token = subscriptionViewFor(params.provider) === subscriptionTokenView
    return (
        <SheetFrame title={title} open={open} onClose={close} onClosed={onClosed}>
            {token ? (
                <SubscriptionTokenPanel params={params} onDone={close} onCancel={close} />
            ) : (
                <SubscriptionSignInPanel params={params} onDone={close} onCancel={close} />
            )}
        </SheetFrame>
    )
}

/** The built-in models in the kit sheet. */
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
