import {Dispatch, SetStateAction} from "react"
import {Variant} from "@/oss/lib/Types"

export interface CustomWorkflowBannerProps {
    isNewPlayground: boolean
    setIsCustomWorkflowModalOpen: Dispatch<SetStateAction<boolean>>
    variant: Variant | undefined
}
