import type {UserOnboardingStatus} from "@/oss/state/onboarding"

import {CHECKLIST_PREREQUISITES} from "./constants"

export type ChecklistPrerequisite =
    (typeof CHECKLIST_PREREQUISITES)[keyof typeof CHECKLIST_PREREQUISITES]

export interface ChecklistItemTour {
    section: keyof UserOnboardingStatus
    tourId?: string
}

export interface ChecklistItem {
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

export interface ChecklistSection {
    id: string
    title: string
    items: ChecklistItem[]
}

export interface ChecklistContext {
    projectURL: string
    appURL: string
    recentlyVisitedAppURL: string
}
