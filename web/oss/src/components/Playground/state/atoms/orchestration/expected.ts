import {atom} from "jotai"

export interface ExpectedRound {
    expectedRevIds: string[]
    roundId: string
    origin?: "single" | "fanout" | "rerun"
}

// Map logicalId -> expected round info
export const expectedRoundByLogicalAtom = atom<Record<string, ExpectedRound>>({})
