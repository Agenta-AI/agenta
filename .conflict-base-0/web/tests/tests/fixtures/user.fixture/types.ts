import type {BaseFixture} from "../base.fixture/types"

import type {AuthHelpers} from "./authHelpers/types"

export interface UserState {
    email: string
    password?: string
    isAuthenticated: boolean
    requiresAuth: boolean
}

export interface WorkerFixtures {
    workerState: UserState
}

export interface TestFixtures extends BaseFixture {
    authHelpers: AuthHelpers
    user: UserState
}

// State management types
export type WorkerStateMap = Map<number, UserState>
export type RegisteredGroupsSet = Set<string>
