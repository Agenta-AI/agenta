import type {Dispatch, SetStateAction} from "react"
import type {Environment, Variant} from "@/lib/Types"

export interface DeploymentDrawerProps {
    selectedEnvironment: Environment
    variants: Variant[]
    loadEnvironments: () => Promise<void>
    setQueryEnv: (val: string) => void
    setOpenChangeVariantModal: Dispatch<SetStateAction<boolean>>
}

export interface LanguageCodeBlockProps {
    selectedLang: string
    fetchConfigCodeSnippet: Record<string, string>
    invokeLlmAppCodeSnippet: Record<string, string>
}
