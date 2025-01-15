import type {ObjectMetadata, StartsWith__} from "../../genericTransformer/types"
import type {TestResult} from "./testRun"

export type InputType<Keys> = {
    [K in Keys[number]]: StartsWith__<K> extends true
        ? K extends "__result" | "__runs" | "__isLoading"
            ? never
            : unknown
        : string | ObjectMetadata
} & {
    __result?: TestResult
    __runs?: Record<
        string,
        {
            __result?: TestResult
            __isRunning: boolean
        }
    >
    __isLoading?: boolean
}
