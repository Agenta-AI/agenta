import type {InternalTour, OnboardingTour, RegisterTourOptions} from "./types"

/**
 * Tour Registry - Central store for all onboarding tours
 *
 * This is a singleton that allows tours to be registered from anywhere
 * in the codebase (e.g., feature modules can register their own tours).
 *
 * @example
 * // Register a tour (typically in a feature module)
 * tourRegistry.register({
 *   id: "evaluation-intro",
 *   steps: [
 *     { selector: "#results-tab", title: "View Results", content: "..." },
 *   ]
 * })
 *
 * // Get all registered tours
 * const tours = tourRegistry.getAll()
 */
class TourRegistry {
    private tours: Map<string, {tour: OnboardingTour; options: RegisterTourOptions}> = new Map()
    private listeners: Set<() => void> = new Set()

    /**
     * Register a tour
     */
    register(tour: OnboardingTour, options: RegisterTourOptions = {}): void {
        this.tours.set(tour.id, {tour, options})
        this.notifyListeners()
    }

    /**
     * Unregister a tour
     */
    unregister(tourId: string): void {
        this.tours.delete(tourId)
        this.notifyListeners()
    }

    /**
     * Get a specific tour by ID
     */
    get(tourId: string): OnboardingTour | null {
        const entry = this.tours.get(tourId)
        if (!entry) return null

        // Check condition if provided
        if (entry.options.condition && !entry.options.condition()) {
            return null
        }

        return entry.tour
    }

    /**
     * Get all registered tours (filtered by conditions)
     */
    getAll(): OnboardingTour[] {
        return Array.from(this.tours.values())
            .filter(({options}) => !options.condition || options.condition())
            .map(({tour}) => tour)
    }

    /**
     * Convert tours to nextstepjs format
     */
    toNextStepFormat(): InternalTour[] {
        return this.getAll().map((tour) => ({
            tour: tour.id,
            steps: tour.steps,
        }))
    }

    /**
     * Check if a tour exists
     */
    has(tourId: string): boolean {
        return this.tours.has(tourId)
    }

    /**
     * Subscribe to registry changes
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private notifyListeners(): void {
        this.listeners.forEach((listener) => listener())
    }

    /**
     * Clear all tours (useful for testing)
     */
    clear(): void {
        this.tours.clear()
        this.notifyListeners()
    }
}

// Singleton instance
export const tourRegistry = new TourRegistry()
