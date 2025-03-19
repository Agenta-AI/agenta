import {Variant} from "@/oss/lib/Types"
import {Dispatch, SetStateAction} from "react"
import {KeyedMutator} from "swr"
import {Modal} from "antd"

export type CustomWorkflowModalProps = {
    customWorkflowAppValues: {
        appName: string
        appUrl: string
        appDesc: string
    }
    setCustomWorkflowAppValues: Dispatch<
        SetStateAction<{
            appName: string
            appUrl: string
            appDesc: string
        }>
    >
    handleCreateApp: () => void
    configureWorkflow?: boolean
    variants?: any[]
    allVariantsDataMutate?: KeyedMutator<Variant[]>
    mutate: () => Promise<any>
    appNameExist?: boolean
} & React.ComponentProps<typeof Modal>
