import {PropsWithChildren} from "react"

import {Toaster} from "@agenta/primitive-ui/components/sonner"
import {TooltipProvider} from "@agenta/primitive-ui/components/tooltip"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

/** Host-side providers for @agenta/primitive-ui (shadcn): tooltips + toasts, themed by the app. */
const PrimitiveUIProviders = ({children}: PropsWithChildren) => {
    const {appTheme} = useAppTheme()

    return (
        <TooltipProvider>
            {children}
            <Toaster theme={appTheme} richColors closeButton />
        </TooltipProvider>
    )
}

export default PrimitiveUIProviders
