import {IPromptVersioning} from "@/lib/Types"
import {Dispatch, PropsWithChildren, SetStateAction, createContext, useState} from "react"

export const PromptVersioningContext = createContext<{
    promptRevisions: IPromptVersioning | undefined
    setPromptRevisions: Dispatch<SetStateAction<IPromptVersioning | undefined>>
    isDrawerOpen: boolean
    setIsDrawerOpen: Dispatch<SetStateAction<boolean>>
    historyStatus: {
        loading: boolean
        error: boolean
    }
    setHistoryStatus: Dispatch<
        SetStateAction<{
            loading: boolean
            error: boolean
        }>
    >
}>({
    promptRevisions: undefined,
    setPromptRevisions: () => {},
    isDrawerOpen: false,
    setIsDrawerOpen: () => {},
    historyStatus: {loading: false, error: false},
    setHistoryStatus: () => {},
})

const PromptVersioningProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [promptRevisions, setPromptRevisions] = useState<IPromptVersioning>()
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)
    const [historyStatus, setHistoryStatus] = useState({loading: false, error: false})

    return (
        <PromptVersioningContext.Provider
            value={{
                promptRevisions,
                setPromptRevisions,
                isDrawerOpen,
                setIsDrawerOpen,
                historyStatus,
                setHistoryStatus,
            }}
        >
            {children}
        </PromptVersioningContext.Provider>
    )
}

export default PromptVersioningProvider
