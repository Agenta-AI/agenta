import {atom} from "jotai"

import type {FeatureGuideKey} from "./featureGuides"

/**
 * Which feature guide is open, or null. An atom so any screen can open the dialog the
 * way the trace drawer opens — the host (`GlobalDrawers`) mounts the dialog once for
 * the whole app.
 */
export const openFeatureGuideAtom = atom<FeatureGuideKey | null>(null)
