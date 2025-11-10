import {atom} from "jotai"

// This atom is used to store the evaluation type for the current evaluation run.
// It is used to determine which evaluation page to render.
export const evalTypeAtom = atom<"auto" | "human" | "online" | "custom" | null>(null)

export const setEvalTypeAtom = atom(
    null,
    (get, set, update: "auto" | "human" | "online" | "custom" | null) => {
        set(evalTypeAtom, update)
    },
)
