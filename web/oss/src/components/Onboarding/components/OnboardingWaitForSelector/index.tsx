import {useEffect, useMemo, useRef, useState} from "react"
import {useAtomValue} from "jotai"
import {useNextStep} from "nextstepjs"

import {onboardingStepsAtom} from "@/oss/state/onboarding"
import type {OnboardingStep} from "@/oss/state/onboarding/types"

const WAIT_CLASSNAME = "onboarding-waiting-for-selector"
const DEFAULT_WAIT_TIMEOUT_MS = 10000
const SETTLE_DELAY_MS = 100

const OnboardingWaitForSelector = () => {
    const onboardingTours = useAtomValue(onboardingStepsAtom)
    const {currentTour, currentStep, isNextStepVisible, setCurrentStep, closeNextStep} =
        useNextStep()
    const [isWaiting, setIsWaiting] = useState(false)
    const observerRef = useRef<MutationObserver | null>(null)
    const timeoutRef = useRef<number | null>(null)
    const settleTimeoutRef = useRef<number | null>(null)

    useEffect(() => {
        if (typeof document === "undefined") return
        if (document.getElementById("onboarding-wait-style")) return

        const style = document.createElement("style")
        style.id = "onboarding-wait-style"
        style.innerHTML = `
            body.${WAIT_CLASSNAME} [data-name="nextstep-overlay"],
            body.${WAIT_CLASSNAME} [data-name="nextstep-overlay2"] {
                display: none !important;
            }
        `
        document.head.appendChild(style)

        return () => {
            style.remove()
        }
    }, [])

    useEffect(() => {
        if (typeof document === "undefined") return
        const body = document.body
        if (!body) return

        if (isWaiting) {
            body.classList.add(WAIT_CLASSNAME)
        } else {
            body.classList.remove(WAIT_CLASSNAME)
        }

        return () => {
            body.classList.remove(WAIT_CLASSNAME)
        }
    }, [isWaiting])

    const {activeStep, totalSteps} = useMemo(() => {
        if (!currentTour) {
            return {activeStep: null, totalSteps: 0}
        }

        const tour = onboardingTours.find((item) => item.tour === currentTour)
        if (!tour) {
            return {activeStep: null, totalSteps: 0}
        }

        const step = tour.steps[currentStep] as OnboardingStep | undefined
        return {activeStep: step ?? null, totalSteps: tour.steps.length}
    }, [currentTour, currentStep, onboardingTours])

    useEffect(() => {
        const clearWaitHelpers = () => {
            if (observerRef.current) {
                observerRef.current.disconnect()
                observerRef.current = null
            }
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current)
                timeoutRef.current = null
            }
            if (settleTimeoutRef.current) {
                window.clearTimeout(settleTimeoutRef.current)
                settleTimeoutRef.current = null
            }
        }

        if (!isNextStepVisible || !activeStep?.waitForSelector || !activeStep.selector) {
            setIsWaiting(false)
            clearWaitHelpers()
            return
        }

        if (typeof document === "undefined") {
            return
        }

        const rootNode = document.body
        if (!rootNode) {
            return
        }

        let resolved = false

        const finishWaiting = () => {
            if (resolved) return
            resolved = true
            setIsWaiting(false)
            clearWaitHelpers()
        }

        const settleAfterResolve = () => {
            if (settleTimeoutRef.current) {
                window.clearTimeout(settleTimeoutRef.current)
            }
            settleTimeoutRef.current = window.setTimeout(() => {
                finishWaiting()
            }, SETTLE_DELAY_MS)
        }

        const attemptResolve = () => {
            const element = document.querySelector(activeStep.selector!)
            if (element) {
                settleAfterResolve()
                return true
            }
            return false
        }

        setIsWaiting(true)

        if (attemptResolve()) {
            return () => {
                clearWaitHelpers()
            }
        }

        observerRef.current = new MutationObserver(() => {
            attemptResolve()
        })
        observerRef.current.observe(rootNode, {childList: true, subtree: true})

        const timeoutMs =
            typeof activeStep.waitTimeoutMs === "number"
                ? activeStep.waitTimeoutMs
                : DEFAULT_WAIT_TIMEOUT_MS

        if (timeoutMs > 0) {
            timeoutRef.current = window.setTimeout(() => {
                if (!attemptResolve()) {
                    finishWaiting()
                    if (currentStep < totalSteps - 1) {
                        setCurrentStep(currentStep + 1)
                    } else {
                        closeNextStep()
                    }
                }
            }, timeoutMs)
        }

        return () => {
            clearWaitHelpers()
        }
    }, [activeStep, closeNextStep, currentStep, isNextStepVisible, setCurrentStep, totalSteps])

    return null
}

export default OnboardingWaitForSelector
