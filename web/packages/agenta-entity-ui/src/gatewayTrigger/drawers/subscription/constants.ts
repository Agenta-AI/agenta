/**
 * Cross-component atoms and the revision adapter for the subscription drawer. Kept local to
 * the drawer — the schedule drawer declares its own knobs with its own semantics.
 */
import {atom} from "jotai"

// The form publishes its source-browse state here so the single drawer header can go "smart"
// (back + "Choose a trigger") without lifting browse state out of the form.
export const browseHeaderAtom = atom<{onBack: () => void} | null>(null)
// Default maps the whole event context under `context`; `$` resolves to the full context.
export const DEFAULT_INPUTS_MAPPING = '{"context": "$"}'
