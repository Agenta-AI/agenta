import type {ObjectMetadata, StartsWith__} from "../../genericTransformer/types"
import type {TestResult} from "./testRun"

export type InputType<Keys> = {
    [K in Keys[number]]: StartsWith__<K> extends true
        ? K extends "__result"
            ? never
            : unknown
        : string | ObjectMetadata
} & {
    __result?: TestResult
}
