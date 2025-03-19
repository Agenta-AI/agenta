import {SetStateAction} from "react"

export type useCustomWorkflowConfigProps = {
    configureWorkflow?: boolean
    setStatusData?: (
        value: SetStateAction<{
            status: string
            details?: any
            appId?: string
        }>,
    ) => void
    afterConfigSave?: (appConfig: {
        appName: string
        appUrl: string
        appDesc: string
    }) => Promise<any>
    setFetchingTemplate?: (value: SetStateAction<boolean>) => void
    setStatusModalOpen?: (value: SetStateAction<boolean>) => void
}
