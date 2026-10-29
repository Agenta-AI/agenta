import {atom} from "jotai"

import type {Walkthrough} from "./featureGuides"

/** The walkthrough the lightbox is showing; `GlobalDrawers` mounts the dialog once. */
export const openFeatureGuideAtom = atom<Walkthrough | null>(null)
