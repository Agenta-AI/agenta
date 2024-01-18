import {IPromptVersioning} from "@/lib/Types"
import {Dispatch, PropsWithChildren, SetStateAction, createContext, useState} from "react"

export const PromptVersioningContext = createContext<{
    promptRevisions: IPromptVersioning | undefined
    setPromptRevisions: Dispatch<SetStateAction<IPromptVersioning | undefined>>
    isDrawerOpen: boolean
    setIsDrawerOpen: Dispatch<SetStateAction<boolean>>
}>({
    promptRevisions: undefined,
    setPromptRevisions: () => {},
    isDrawerOpen: false,
    setIsDrawerOpen: () => {},
})

const PromptVersioningProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [promptRevisions, setPromptRevisions] = useState<IPromptVersioning>()
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)

    return (
        <PromptVersioningContext.Provider
            value={{promptRevisions, setPromptRevisions, isDrawerOpen, setIsDrawerOpen}}
        >
            {children}
        </PromptVersioningContext.Provider>
    )
}

export default PromptVersioningProvider
