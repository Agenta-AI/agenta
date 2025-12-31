import {atom} from "jotai"

type DeleteTraceModalState = {
    isOpen: boolean
    traceIds: string[]
    onClose?: () => void
}

export const deleteTraceModalAtom = atom<DeleteTraceModalState>({
    isOpen: false,
    traceIds: [],
})
