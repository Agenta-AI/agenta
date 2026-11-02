import type {SettingsTabKey} from "@agenta/settings"

import type {Walkthrough} from "../education/featureGuides"

/** Walkthrough clips per Settings tab; a tab without one shows no video link. */
export const SETTINGS_WALKTHROUGHS: Partial<Record<SettingsTabKey, Walkthrough>> = {}
