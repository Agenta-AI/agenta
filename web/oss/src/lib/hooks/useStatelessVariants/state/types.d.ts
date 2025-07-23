import {Common, Enhanced, Merge} from "@/oss/lib/shared/variant/genericTransformer/types"
import {Message, TestResult} from "@/oss/lib/shared/variant/transformer/types"
import {CamelCaseEnvironment} from "@/oss/lib/Types"
import type {UserProfile} from "@/oss/types/user"

import type {OpenAPISpec} from "../assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "../assets/utilities/transformer/types"

export type MessageWithId = Merge<Common, Message>
export interface LightweightRevision {
    id: string
    name: string
    variantId: string
    variantName: string
    createdAt: string
    isLatestRevision: boolean
    isLatestVariantRevision: boolean
    commitMessage: string | null
    userProfile?: UserProfile
    deployedIn?: CamelCaseEnvironment[]
    revisionNumber: number
    createdAtTimestamp: number
}

export interface WithRuns {
    __runs?: Record<
        string,
        | {
              __isRunning?: string
              __result?: TestResult | string | null
              __id?: string
              message?: Enhanced<MessageWithId> | Enhanced<MessageWithId>[]
          }
        | undefined
    >
    message?: MessageWithId
    __result?: TestResult | string | null
    __isRunning?: string
}

export type MessageWithRuns = Merge<WithRuns, MessageWithId>

// State Types
export interface InitialStateType {
    variants: EnhancedVariant[]
    selected: string[]
    availableRevisions?: LightweightRevision[]
    fetching: boolean
    spec?: OpenAPISpec
    dirtyStates: Record<string, boolean>
    error?: Error
    appStatus: boolean
    appType: string
    uri?: {
        routePath: string
        runtimePrefix: string
    }
    generationData: {
        inputs: Enhanced<WithRuns[]>
        messages: Enhanced<
            {
                history: MessageWithRuns[]
            }[]
        >
    }
}
