import {atom} from "jotai"

export const webworkerAtom = atom<Worker | null>(null)

webworkerAtom.onMount = (setAtom) => {
    const worker = new Worker(new URL("../assets/playground.worker.ts", import.meta.url))
    setAtom(worker)
    return () => {
        worker.terminate()
    }
}
