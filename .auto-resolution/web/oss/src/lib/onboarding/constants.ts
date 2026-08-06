/**
 * Kill switch for the nextstepjs-based guided-tour engine.
 *
 * Tours are parked (legacy onboarding surfaces are hidden pending the new onboarding
 * widget). Flip to `true` to re-enable OnboardingProvider's NextStep wrapper and the
 * tour hooks. When `false`, nextstepjs must not be imported/initialized at runtime.
 */
export const ONBOARDING_TOURS_ENABLED = false
