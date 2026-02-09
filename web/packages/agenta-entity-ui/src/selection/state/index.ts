/**
 * Entity Selection State
 *
 * Jotai atoms for hierarchical selection and modal management.
 */

// Selection state molecule
export {
    selectionMolecule,
    // Individual atoms (for fine-grained access)
    selectionStateFamily,
    currentPathFamily,
    currentLevelFamily,
    searchTermFamily,
    isAtRootFamily,
    currentParentIdFamily,
    navigateDownFamily,
    navigateUpFamily,
    navigateToLevelFamily,
    setSearchTermFamily,
    resetSelectionFamily,
    setPathFamily,
} from "./selectionState"

// Modal state controller
export {
    entitySelectorController,
    // Individual atoms
    entitySelectorOpenAtom,
    entitySelectorConfigAtom,
    entitySelectorResolverAtom,
    entitySelectorActiveTypeAtom,
    entitySelectorAllowedTypesAtom,
    entitySelectorTitleAtom,
    entitySelectorAdaptersAtom,
    resetEntitySelectorAtom,
    openEntitySelectorAtom,
    closeEntitySelectorWithSelectionAtom,
    closeEntitySelectorAtom,
    forceCloseEntitySelectorAtom,
    setEntitySelectorActiveTypeAtom,
} from "./modalState"
