import {atomWithStorage} from "jotai/utils"

/** Mirrors the desktop strip's key so hiding templates is ONE preference, not one per surface. */
export const TEMPLATES_HIDDEN_KEY = "agenta:templates:strip-hidden"

/** Redeclared rather than imported: `/m` cannot reach `@/oss/*`. Same key, same semantics. */
export const templatesHiddenAtom = atomWithStorage<boolean>(TEMPLATES_HIDDEN_KEY, false)
