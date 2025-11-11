import {Dispatch, SetStateAction} from "react"

import {Modal} from "antd"
import {KeyedMutator} from "swr"

import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Variant} from "@/oss/lib/Types"

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
    variants?: EnhancedVariant[]
    allVariantsDataMutate?: KeyedMutator<Variant[]>
    mutate: () => Promise<any>
    appNameExist?: boolean
} & React.ComponentProps<typeof Modal>
