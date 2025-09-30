export interface useCustomWorkflowConfigProps {
    configureWorkflow?: boolean
    afterConfigSave?: (appConfig: {
        appName: string
        appUrl: string
        appDesc: string
    }) => Promise<any>
    setFetchingTemplate?: (value: SetStateAction<boolean>) => void
    setStatusModalOpen?: (value: SetStateAction<boolean>) => void
}
