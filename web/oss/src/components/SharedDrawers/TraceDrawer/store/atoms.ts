import type {PlaygroundTestResult as TestResult} from "@agenta/playground"
import {atom} from "jotai"

export interface TraceDrawerState {
    open: boolean
    result: TestResult | null
}

export const traceDrawerAtom = atom<TraceDrawerState>({open: false, result: null})
