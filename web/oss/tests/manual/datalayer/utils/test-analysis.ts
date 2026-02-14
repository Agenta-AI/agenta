/**
 * Test Analysis and Reporting Utilities
 *
 * Reusable utilities for enhanced API tracking, timeline analysis, and HTML generation
 * across all atom tests in the project.
 */

import {writeFile} from "fs/promises"

export interface TestEvent {
    ts: number
    type: string
    payload: any
    phase?: string
}

export interface ApiCall {
    endpoint: string
    method: string
    timestamp: number
    phase: string
}

export interface PhaseAnalysis {
    duration: number
    events: number
    apiCalls: number
    startTime: number
    endTime: number
    keyActions: string[]
}

export interface TimelineAnalysis {
    phases: Record<string, PhaseAnalysis>
    totalDuration: number
    totalEvents: number
    totalApiCalls: number
}

export interface SkeletonStateAnalysis {
    hasSkeletonData: boolean
    skeletonItemCount: number
    loadingStage: "initial" | "partial" | "complete" | "unknown"
    skeletonToRealTransitions: number
    immediateRenderTime: number
    progressiveLoadingStages: string[]
}

export interface TestAnalysis {
    timeline: TimelineAnalysis
    summary: {
        totalDuration: number
        totalEvents: number
        networkRequests: number
        atomSubscriptions: number
        dataFetches: number
        derivedComputations: number
    }
    performance: {
        networkLatency: number
        atomResponseTime: number
        derivedAtomPerformance: {
            deploymentAtoms: number
            parentAtoms: number
        }
    }
    skeletonAnalysis: Record<string, SkeletonStateAnalysis>
    insights: string[]
}

/**
 * Enhanced Test Recorder with phase-based tracking and detailed API monitoring
 */
export class EnhancedTestRecorder {
    private events: TestEvent[] = []
    private startTime = Date.now()
    private networkRequestCount = 0
    private apiCalls: ApiCall[] = []
    private apiCallsMap = new Map<string, number>() // endpoint -> index in apiCalls array
    private currentPhase = "initialization"

    setPhase(phase: string) {
        this.currentPhase = phase
        this.record("phase:start", {phase, timestamp: Date.now() - this.startTime})
        console.log(`🔄 Phase: ${phase}`)
    }

    record(type: string, payload: any) {
        this.events.push({
            ts: Date.now() - this.startTime,
            type,
            payload,
            phase: this.currentPhase,
        })
    }

    recordApiCall(endpoint: string, method = "GET", details?: any) {
        const timestamp = Date.now() - this.startTime
        const existingIndex = this.apiCallsMap.get(endpoint)

        if (existingIndex !== undefined) {
            // Update existing API call with new status/details
            this.apiCalls[existingIndex] = {
                ...this.apiCalls[existingIndex],
                timestamp, // Update to latest timestamp
                ...details, // Merge in status, error, duration, etc.
            }
        } else {
            // New API call
            const newCall = {endpoint, method, timestamp, phase: this.currentPhase, ...details}
            this.apiCalls.push(newCall)
            this.apiCallsMap.set(endpoint, this.apiCalls.length - 1)
            this.networkRequestCount++
        }

        this.record("api:call", {
            endpoint,
            method,
            phase: this.currentPhase,
            count: this.networkRequestCount,
            timestamp,
            ...details,
        })

        const status = details?.status || "pending"
        console.log(`🌐 API Call [${this.currentPhase}]: ${method} ${endpoint} (${status})`)
    }

    /**
     * Smart skeleton detection for any atom data
     */
    private detectSkeletonState(data: any): SkeletonStateAnalysis {
        const startTime = performance.now()

        // Check for skeleton metadata
        const hasSkeletonMeta = data?.meta?.isSkeleton === true
        const loadingStage = data?.meta?.loadingStage || "unknown"

        // Check for skeleton markers in array items
        let skeletonItemCount = 0
        let hasSkeletonData = hasSkeletonMeta

        if (Array.isArray(data)) {
            skeletonItemCount = data.filter(
                (item: any) =>
                    item?._skeleton?.isLoading === true ||
                    item?.app_name?.includes?.("Loading") ||
                    item?.displayName?.includes?.("████"),
            ).length
            hasSkeletonData = hasSkeletonData || skeletonItemCount > 0
        } else if (data?.data && Array.isArray(data.data)) {
            // Handle wrapped data
            skeletonItemCount = data.data.filter(
                (item: any) =>
                    item?._skeleton?.isLoading === true ||
                    item?.app_name?.includes?.("Loading") ||
                    item?.displayName?.includes?.("████"),
            ).length
            hasSkeletonData = hasSkeletonData || skeletonItemCount > 0
        }

        // Check for loading state indicators
        const isLoading = data?.isLoading || data?.loading || false
        const hasLoadingStage = ["initial", "partial", "complete"].includes(loadingStage)

        if (isLoading && !hasSkeletonData && !hasLoadingStage) {
            // Likely has skeleton data but not detected by our patterns
            hasSkeletonData = true
        }

        const immediateRenderTime = performance.now() - startTime

        return {
            hasSkeletonData,
            skeletonItemCount,
            loadingStage: hasLoadingStage ? (loadingStage as any) : "unknown",
            skeletonToRealTransitions: 0, // Will be tracked over time
        }
    }

    recordAtomSubscription(atomName: string, status: string, data?: any) {
        // Smart skeleton detection
        const skeletonDetection = this.detectSkeletonState(data)

        this.record("atom:subscription", {
            atom: atomName,
            status,
            phase: this.currentPhase,
            dataCount: data?.length || 0,
            hasSkeletonData: skeletonDetection.hasSkeletonData,
            skeletonCount: skeletonDetection.skeletonItemCount,
        })

        if (skeletonDetection.hasSkeletonData) {
            console.log(
                `🎭 ${atomName}: Skeleton data detected (${skeletonDetection.skeletonItemCount} items)`,
            )
        }

        console.log(`🔗 Atom: ${atomName} (${status}) in ${this.currentPhase}`)
    }

    /**
     * Simple skeleton data detection
     */
    private isSkeletonData(data: any): boolean {
        if (!data) return false

        // Check for skeleton metadata
        if (data.meta?.isSkeleton === true) return true
        if (data._skeleton?.isLoading === true) return true

        // Check for skeleton patterns in arrays
        if (Array.isArray(data)) {
            return data.some(
                (item: any) =>
                    item?._skeleton?.isLoading === true ||
                    item?.app_name?.includes?.("Loading") ||
                    item?.displayName?.includes?.("████") ||
                    item?.app_id?.startsWith?.("skeleton-"),
            )
        }

        // Check wrapped data
        if (data.data && Array.isArray(data.data)) {
            return this.isSkeletonData(data.data)
        }

        return false
    }

    /**
     * Count skeleton items in data
     */
    private countSkeletonItems(data: any): number {
        if (!data) return 0

        if (Array.isArray(data)) {
            return data.filter(
                (item: any) =>
                    item?._skeleton?.isLoading === true ||
                    item?.app_name?.includes?.("Loading") ||
                    item?.displayName?.includes?.("████") ||
                    item?.app_id?.startsWith?.("skeleton-"),
            ).length
        }

        if (data.data && Array.isArray(data.data)) {
            return this.countSkeletonItems(data.data)
        }

        return 0
    }

    incrementNetworkRequest() {
        this.networkRequestCount++
        this.record("network:request", {count: this.networkRequestCount})
    }

    getNetworkRequestCount() {
        return this.networkRequestCount
    }

    getApiCalls() {
        return this.apiCalls
    }

    getEvents() {
        return this.events
    }

    /**
     * Analyze timeline by grouping events into phases
     */
    analyzeTimeline(): TimelineAnalysis {
        const phases: Record<string, PhaseAnalysis> = {}

        // Group events by phase
        this.events.forEach((event) => {
            const phase = event.phase || "unknown"
            if (!phases[phase]) {
                phases[phase] = {
                    duration: 0,
                    events: 0,
                    apiCalls: 0,
                    startTime: event.ts,
                    endTime: event.ts,
                    keyActions: [],
                }
            }

            phases[phase].events++
            phases[phase].endTime = Math.max(phases[phase].endTime, event.ts)
            phases[phase].startTime = Math.min(phases[phase].startTime, event.ts)

            if (event.type === "api:call") {
                phases[phase].apiCalls++
                phases[phase].keyActions.push(`${event.payload.method} ${event.payload.endpoint}`)
            }
        })

        // Calculate durations
        Object.keys(phases).forEach((phase) => {
            phases[phase].duration = phases[phase].endTime - phases[phase].startTime
        })

        const totalDuration = Math.max(...Object.values(phases).map((p) => p.endTime))

        return {
            phases,
            totalDuration,
            totalEvents: this.events.length,
            totalApiCalls: this.networkRequestCount,
        }
    }

    /**
     * Generate comprehensive test analysis
     */
    analyzeEvents(): TestAnalysis {
        const timeline = this.analyzeTimeline()

        // Count different event types
        const atomSubscriptions = this.events.filter((e) => e.type === "atom:subscription").length
        const dataFetches = this.events.filter((e) => e.type === "data:loaded").length
        const derivedComputations = this.events.filter((e) => e.type.includes("derived")).length

        // Calculate performance metrics
        const networkEvents = this.events.filter((e) => e.type === "api:call")
        const networkLatency =
            networkEvents.length > 0
                ? networkEvents.reduce((sum, e) => sum + (e.payload.timestamp || 0), 0) /
                  networkEvents.length
                : 0

        const atomEvents = this.events.filter((e) => e.type === "atom:subscription")
        const atomResponseTime =
            atomEvents.length > 0
                ? atomEvents.reduce((sum, e) => sum + e.ts, 0) / atomEvents.length
                : 0

        const deploymentAtoms = this.events.filter((e) =>
            e.payload?.atom?.includes("deployment"),
        ).length
        const parentAtoms = this.events.filter((e) => e.payload?.atom?.includes("parent")).length

        // Generate insights
        const insights: string[] = []

        if (timeline.totalApiCalls > 5) {
            insights.push(
                `High API usage detected (${timeline.totalApiCalls} calls) - consider caching optimizations`,
            )
        }

        if (networkLatency > 100) {
            insights.push(
                `Network latency is high (${networkLatency.toFixed(2)}ms avg) - check API performance`,
            )
        }

        const longestPhase = Object.entries(timeline.phases).sort(
            ([, a], [, b]) => b.duration - a.duration,
        )[0]
        if (longestPhase) {
            insights.push(`Longest phase: ${longestPhase[0]} (${longestPhase[1].duration}ms)`)
        }

        if (atomSubscriptions > timeline.totalApiCalls * 2) {
            insights.push(
                "Good atom reactivity - more subscriptions than API calls indicates efficient state management",
            )
        }

        // Analyze skeleton data across all events
        const skeletonEvents = this.events.filter(
            (e) => e.type === "atom:subscription" && e.payload.hasSkeletonData,
        )
        const skeletonAnalysis: Record<string, SkeletonStateAnalysis> = {}

        skeletonEvents.forEach((event) => {
            const atomName = event.payload.atom
            if (!skeletonAnalysis[atomName]) {
                skeletonAnalysis[atomName] = {
                    hasSkeletonData: true,
                    skeletonItemCount: event.payload.skeletonCount || 0,
                    loadingStage: "unknown",
                    skeletonToRealTransitions: 0,
                    immediateRenderTime: event.payload.immediateRender || 0,
                    progressiveLoadingStages: [],
                }
            }
        })

        // Add skeleton insights
        if (Object.keys(skeletonAnalysis).length > 0) {
            insights.push(`Skeleton data detected in ${Object.keys(skeletonAnalysis).length} atoms`)
            const totalSkeletonItems = Object.values(skeletonAnalysis).reduce(
                (sum, analysis) => sum + analysis.skeletonItemCount,
                0,
            )
            if (totalSkeletonItems > 0) {
                insights.push(`Total skeleton items rendered: ${totalSkeletonItems}`)
            }
        }

        return {
            timeline,
            summary: {
                totalDuration: timeline.totalDuration,
                totalEvents: timeline.totalEvents,
                networkRequests: this.networkRequestCount,
                atomSubscriptions,
                dataFetches,
                derivedComputations,
            },
            performance: {
                networkLatency,
                atomResponseTime,
                derivedAtomPerformance: {
                    deploymentAtoms,
                    parentAtoms,
                },
            },
            skeletonAnalysis,
            insights,
        }
    }

    /**
     * Generate enhanced markdown summary
     */
    generateEnhancedSummary(): string {
        const timeline = this.analyzeTimeline()

        let summary = `# Enhanced Test Execution Summary\n\n`
        summary += `Generated: ${new Date().toISOString()}\n\n`
        summary += `## 📊 Overview\n`
        summary += `- **Total Duration**: ${timeline.totalDuration}ms\n`
        summary += `- **Total Events**: ${timeline.totalEvents}\n`
        summary += `- **API Calls**: ${timeline.totalApiCalls}\n`
        summary += `- **Phases**: ${Object.keys(timeline.phases).length}\n\n`

        summary += `## 🌐 API Endpoints Called\n\n`
        this.apiCalls.forEach((call, i) => {
            summary += `${i + 1}. **${call.method} ${call.endpoint}**\n`
            summary += `   - Phase: ${call.phase}\n`
            summary += `   - Timestamp: ${call.timestamp}ms\n\n`
        })

        summary += `## ⏱️ Phase Timeline\n\n`
        Object.entries(timeline.phases)
            .sort(([, a], [, b]) => a.startTime - b.startTime)
            .forEach(([phase, data]) => {
                summary += `### ${phase}\n`
                summary += `- **Duration**: ${data.duration}ms (${data.startTime}ms - ${data.endTime}ms)\n`
                summary += `- **Events**: ${data.events}\n`
                summary += `- **API Calls**: ${data.apiCalls}\n`
                if (data.keyActions.length > 0) {
                    summary += `- **Key Actions**: ${data.keyActions.join(", ")}\n`
                }
                summary += `\n`
            })

        return summary
    }

    /**
     * Generate interactive HTML visualization
     */
    generateVisualization(analysis: TestAnalysis): string {
        const phaseData = Object.entries(analysis.timeline.phases)
            .sort(([, a], [, b]) => a.startTime - b.startTime)
            .map(([name, data]) => ({
                name,
                duration: data.duration,
                events: data.events,
                apiCalls: data.apiCalls,
                startTime: data.startTime,
            }))

        return `<!DOCTYPE html>
<html>
<head>
    <title>Test Analysis Visualization</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .chart-container { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric { padding: 15px; background: #f5f5f5; border-radius: 8px; text-align: center; }
        .metric h3 { margin: 0 0 10px 0; color: #333; }
        .metric .value { font-size: 24px; font-weight: bold; color: #007acc; }
        .insights { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0; }
        .insights h3 { margin-top: 0; color: #856404; }
        .insights ul { margin: 0; }
        .api-calls { background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 15px; margin: 20px 0; }
        .api-calls h3 { margin-top: 0; color: #0c5460; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧪 Test Analysis Dashboard</h1>
        <p>Generated: ${new Date().toISOString()}</p>
        
        <div class="metrics">
            <div class="metric">
                <h3>Total Duration</h3>
                <div class="value">${analysis.timeline.totalDuration}ms</div>
            </div>
            <div class="metric">
                <h3>API Calls</h3>
                <div class="value">${analysis.timeline.totalApiCalls}</div>
            </div>
            <div class="metric">
                <h3>Atom Subscriptions</h3>
                <div class="value">${analysis.summary.atomSubscriptions}</div>
            </div>
            <div class="metric">
                <h3>Phases</h3>
                <div class="value">${Object.keys(analysis.timeline.phases).length}</div>
            </div>
        </div>

        <div class="chart-container">
            <h2>Phase Duration Timeline</h2>
            <canvas id="phaseChart" width="400" height="200"></canvas>
        </div>

        <div class="chart-container">
            <h2>Events per Phase</h2>
            <canvas id="eventsChart" width="400" height="200"></canvas>
        </div>

        <div class="api-calls">
            <h3>🌐 API Endpoints Called</h3>
            <ol>
                ${this.apiCalls
                    .map(
                        (call) =>
                            `<li><strong>${call.method} ${call.endpoint}</strong> [${call.phase}] at ${call.timestamp}ms</li>`,
                    )
                    .join("")}
            </ol>
        </div>

        <div class="insights">
            <h3>💡 Key Insights</h3>
            <ul>
                ${analysis.insights.map((insight) => `<li>${insight}</li>`).join("")}
            </ul>
        </div>
    </div>

    <script>
        // Phase Duration Chart
        const phaseCtx = document.getElementById('phaseChart').getContext('2d');
        new Chart(phaseCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(phaseData.map((p) => p.name))},
                datasets: [{
                    label: 'Duration (ms)',
                    data: ${JSON.stringify(phaseData.map((p) => p.duration))},
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });

        // Events per Phase Chart
        const eventsCtx = document.getElementById('eventsChart').getContext('2d');
        new Chart(eventsCtx, {
            type: 'doughnut',
            data: {
                labels: ${JSON.stringify(phaseData.map((p) => p.name))},
                datasets: [{
                    data: ${JSON.stringify(phaseData.map((p) => p.events))},
                    backgroundColor: [
                        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
                        '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    </script>
</body>
</html>`
    }

    /**
     * Save comprehensive test results with analysis and visualization
     */
    async save(filename: string) {
        const analysis = this.analyzeEvents()
        const summary = this.generateEnhancedSummary()
        const visualization = this.generateVisualization(analysis)

        const data = {
            generatedAt: new Date().toISOString(),
            totalDuration: analysis.timeline.totalDuration,
            totalNetworkRequests: this.networkRequestCount,
            apiCalls: this.apiCalls,
            timeline: analysis.timeline,
            events: this.events,
            analysis,
            summary,
        }

        await writeFile(filename, JSON.stringify(data, null, 2))
        await writeFile(filename.replace(".json", "-summary.md"), summary)
        await writeFile(filename.replace(".json", "-visualization.html"), visualization)

        console.log(`💾 Enhanced results saved to: ${filename}`)
        console.log(`📄 Summary saved to: ${filename.replace(".json", "-summary.md")}`)
        console.log(
            `🌐 Visualization saved to: ${filename.replace(".json", "-visualization.html")}`,
        )
    }
}
