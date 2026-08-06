import type {Dispatch, SetStateAction} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"

import type {Variant} from "@/oss/lib/Types"

export interface DeploymentDrawerProps {
    selectedEnvironment: AppEnvironmentDeployment
    variants: Variant[]
    loadEnvironments: () => Promise<void>
    setQueryEnv: (val: string) => void
    setOpenChangeVariantModal: Dispatch<SetStateAction<boolean>>
}

export interface LanguageCodeBlockProps {
    selectedLang: string
    fetchConfigCodeSnippet: Record<string, string>
    invokeLlmAppCodeSnippet: Record<string, string>
    handleOpenSelectDeployVariantModal: () => void
    invokeLlmUrl: string | undefined
    showDeployOverlay?: boolean
}
