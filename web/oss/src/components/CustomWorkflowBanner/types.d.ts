import {Dispatch, SetStateAction} from "react"

import {Variant} from "@/oss/lib/Types"

export interface CustomWorkflowBannerProps {
    setIsCustomWorkflowModalOpen: Dispatch<SetStateAction<boolean>>
    variant: Variant | undefined
}
