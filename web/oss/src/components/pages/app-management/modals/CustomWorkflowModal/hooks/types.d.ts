export interface useCustomWorkflowConfigProps {
    folderId?: string | null
    appId?: string | null
    afterConfigSave?: () => Promise<any>
    setFetchingTemplate?: (value: SetStateAction<boolean>) => void
    setStatusModalOpen?: (value: SetStateAction<boolean>) => void
}
