import {atom} from "jotai"

import {TestResult} from "@/oss/lib/shared/variant/transformer/types"

export interface TraceDrawerState {
    open: boolean
    result: TestResult | null
}

export const traceDrawerAtom = atom<TraceDrawerState>({open: false, result: null})
