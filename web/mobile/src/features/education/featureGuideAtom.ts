import {atom} from "jotai"

import type {FeatureGuideKey} from "./featureGuides"

/** Which feature guide's video is open; `GlobalDrawers` mounts the dialog once. */
export const openFeatureGuideAtom = atom<FeatureGuideKey | null>(null)
