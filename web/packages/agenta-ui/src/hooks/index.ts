/**
 * Shared Hooks
 *
 * Reusable React hooks for common UI patterns.
 */

export {useSelectionState, type UseSelectionStateResult} from "./useSelectionState"
export {useRunAllShortcut, type UseRunAllShortcutParams} from "./useRunAllShortcut"
export {useDefaultStoreAtomValue} from "./useDefaultStoreAtomValue"
export {useMediaQuery, useIsNarrowScreen, NARROW_SCREEN_QUERY} from "./useMediaQuery"
export {
    useWindowMatch,
    useIsExpandedWindow,
    EXPANDED_WINDOW_QUERY,
    COMPACT_WINDOW_QUERY,
} from "./useWindowMatch"
export {
    useVisualViewportHeight,
    hasCoarsePointer,
    dismissSoftKeyboardAfterSend,
    KEYBOARD_SETTLE_MS,
    keyboardInset,
    viewportHeightOverride,
    COARSE_POINTER_QUERY,
    KEYBOARD_INSET_MIN_PX,
    VIEWPORT_HEIGHT_VAR,
    type VisualViewportSample,
} from "./useVisualViewport"
export {useScrollFadeEdges} from "./useScrollFadeEdges"
export {useHasOpened} from "./useHasOpened"
