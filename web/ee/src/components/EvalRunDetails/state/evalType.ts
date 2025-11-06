import {atom} from "jotai"

// This atom is used to store the evaluation type (auto or human) for the current evaluation run.
// It is used to determine which evaluation page to render.
export const evalTypeAtom = atom<"auto" | "human" | "online" | null>(null)

// This atom is used to set the evaluation type (auto or human) for the current evaluation run.
export const setEvalTypeAtom = atom(
    null,
    (get, set, update: "auto" | "human" | "online" | null) => {
        set(evalTypeAtom, update)
    },
)
