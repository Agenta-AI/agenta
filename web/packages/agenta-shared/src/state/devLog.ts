import type {PrimitiveAtom} from "jotai"

import {logAtom} from "./logAtom"

/**
 * Conditionally wraps an atom with logAtom based on env flag.
 * Usage:
 *   devLog(myAtom, 'myAtom', process.env.NEXT_PUBLIC_LOG_MY_FEATURE === 'true')
 */
export function devLog<T>(atom: PrimitiveAtom<T>, name: string, flag: boolean) {
    if (flag) logAtom(atom, name)
}
