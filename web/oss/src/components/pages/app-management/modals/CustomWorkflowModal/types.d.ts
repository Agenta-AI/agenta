import {Dispatch, SetStateAction} from "react"

import {Modal} from "antd"
import {KeyedMutator} from "swr"

import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Variant} from "@/oss/lib/Types"

export type CustomWorkflowModalProps = {
    /** If provided, modal configures the app with this id; otherwise it creates a new app */
    appId?: string
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
    /**
     * Deprecated: use appId instead. If appId is provided, it's configure mode; else create mode
     */
    configureWorkflow?: boolean
    variants?: EnhancedVariant[]
    allVariantsDataMutate?: KeyedMutator<Variant[]>
    mutate: () => Promise<any>
    appNameExist?: boolean
} & React.ComponentProps<typeof Modal>
