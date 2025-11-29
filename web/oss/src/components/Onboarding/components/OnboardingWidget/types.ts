import type {UserOnboardingStatus} from "@/oss/state/onboarding"

import {CHECKLIST_PREREQUISITES} from "./constants"

export type ChecklistPrerequisite =
    (typeof CHECKLIST_PREREQUISITES)[keyof typeof CHECKLIST_PREREQUISITES]

export type ChecklistItemTour = {
    section: keyof UserOnboardingStatus
}

export type ChecklistItem = {
    id: string
    title: string
    description: string
    href?: string
    disabled?: boolean
    tip?: string
    cta?: string
    tour?: ChecklistItemTour
    prerequisites?: ChecklistPrerequisite[]
}

export type ChecklistSection = {
    id: string
    title: string
    items: ChecklistItem[]
}

export type ChecklistContext = {
    projectURL: string
    appURL: string
    recentlyVisitedAppURL: string
}
