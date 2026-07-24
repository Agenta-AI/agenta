export interface useCustomWorkflowConfigProps {
    folderId?: string | null
    appId?: string | null
    afterConfigSave?: () => unknown
    setFetchingTemplate?: (value: SetStateAction<boolean>) => void
    setStatusModalOpen?: (value: SetStateAction<boolean>) => void
}
