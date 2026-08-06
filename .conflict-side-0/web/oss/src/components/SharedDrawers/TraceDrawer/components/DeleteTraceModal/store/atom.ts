import {atom} from "jotai"

interface DeleteTraceModalState {
    isOpen: boolean
    traceIds: string[]
    onClose?: () => void
}

export const deleteTraceModalAtom = atom<DeleteTraceModalState>({
    isOpen: false,
    traceIds: [],
})
