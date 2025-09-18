/**
 * Test Recording Types
 *
 * Shared interfaces and types for test recording and analysis
 * Used across multiple test files for consistency
 */

// Basic test event structure
export interface TestEvent {
    ts: number
    type: string
    payload: any
}

// Comprehensive analysis result structure
export interface AnalysisResult {
    summary: {
        totalDuration: number
        totalEvents: number
        networkRequests: number
        atomSubscriptions: number
        dataFetches: number
        derivedComputations: number
    }
    timeline: {
        phase: string
        startTime: number
        endTime: number
        duration: number
        events: TestEvent[]
        keyActions: string[]
    }[]
    performance: {
        networkLatency: number
        atomResponseTime: number
        derivedAtomPerformance: {
            deploymentAtoms: number
            parentAtoms: number
        }
    }
    insights: string[]
}

// API call tracking structure
export interface ApiCall {
    endpoint: string
    method: string
    timestamp: number
    phase: string
    purpose?: string
}

// Test phase configuration
export interface TestPhase {
    name: string
    description: string
    startTime?: number
    endTime?: number
}
