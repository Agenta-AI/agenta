import {useReducer} from "react"

// Define the possible states of the tour lifecycle
// - idle: Initial state, waiting to start
// - checking: Verifying if conditions (like elements) are ready
// - ready: Conditions met, ready to trigger tour
// - active: Tour is currently running
// - completed: Tour finished or skipped
// - error: Something went wrong
export type TourStatus = "idle" | "checking" | "ready" | "active" | "completed" | "error"

export interface TourState {
    status: TourStatus
    error?: string
    retryCount: number
}

// Actions to drive the state machine
type TourAction =
    | {type: "START_CHECK"}
    | {type: "CHECK_SUCCESS"}
    | {type: "CHECK_FAILURE"; error?: string}
    | {type: "START_TOUR"}
    | {type: "COMPLETE_TOUR"}
    | {type: "RESET"}

const initialState: TourState = {
    status: "idle",
    retryCount: 0,
}

// Reducer function to manage state transitions
// This ensures state logic (WHAT) is separated from side effects (HOW)
function tourReducer(state: TourState, action: TourAction): TourState {
    switch (action.type) {
        case "START_CHECK":
            return {
                ...state,
                status: "checking",
                error: undefined,
            }
        case "CHECK_SUCCESS":
            return {
                ...state,
                status: "ready",
                retryCount: 0,
            }
        case "CHECK_FAILURE":
            return {
                ...state,
                // If we failed checking, we might want to retry or just go to error/idle
                // For this simple implementation, if check fails, we go to error
                status: "error",
                error: action.error,
                retryCount: state.retryCount + 1,
            }
        case "START_TOUR":
            return {
                ...state,
                status: "active",
            }
        case "COMPLETE_TOUR":
            return {
                ...state,
                status: "completed",
            }
        case "RESET":
            return initialState
        default:
            return state
    }
}

/**
 * Hook to use the tour reducer
 * Returns the state and dispatch function
 */
export function useTourReducer() {
    return useReducer(tourReducer, initialState)
}
