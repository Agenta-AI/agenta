/**
 * Banner type determines the priority order.
 * Lower priority number = shown first.
 *
 * To add a new banner type:
 * 1. Add it to this union type
 * 2. Add its priority to PRIORITY_ORDER in state/atoms.ts
 * 3. Create the banner content component in banners/
 * 4. Register it in the appropriate atom (activeBannersAtom for OSS, eeBannersAtom for EE)
 */
export type BannerType = "trial" | "upgrade" | "changelog" | "star-repo"

export interface BannerAction {
    label: string
    href?: string
    onClick?: () => void
}

export interface BannerConfig {
    /** Unique ID for persistence (e.g., "changelog-2024-12-16-feature") */
    id: string
    /** Determines priority order */
    type: BannerType
    /** Can user dismiss this banner? */
    dismissible: boolean
    /** Banner title */
    title: string
    /** Banner description */
    description: string
    /** Optional action button */
    action?: BannerAction
    /** Optional custom content renderer */
    customContent?: React.ReactNode
}
