import {createContext, useContext, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import chatPhoneDetailCatalog from "@agenta/i18n/catalogs/chat.phoneDetail"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {Sheet, SheetContent, SheetTitle} from "@agenta/ui/ui"

const InPhoneDetail = createContext(false)

/** True inside a phone detail screen: a detail there shows whole, with no "View full diff". */
export const useInPhoneDetail = () => useContext(InPhoneDetail)

/**
 * A detail of a change card on a phone (M05): it covers the screen, with a back arrow to the
 * chat and the detail's name as the title. The desktop card opens the same detail in place.
 */
export const PhoneDetailScreen = ({
    open,
    onOpenChange,
    title,
    children,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    children: ReactNode
}) => {
    const t = useT(chatPhoneDetailCatalog)
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                data-testid="change-phone-detail"
                // The whole screen, not the floating side panel: no inset, no corners.
                className="inset-0 w-full max-w-none gap-0 rounded-none sm:max-w-none"
                aria-describedby={undefined}
            >
                <PhoneScreenHeader
                    title={
                        <SheetTitle asChild className="font-semibold">
                            <span>{title}</span>
                        </SheetTitle>
                    }
                    onBack={() => onOpenChange(false)}
                    backTitle={t("chat.phoneDetail.chat")}
                />
                <div className="ag-scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <InPhoneDetail.Provider value>{children}</InPhoneDetail.Provider>
                </div>
            </SheetContent>
        </Sheet>
    )
}
