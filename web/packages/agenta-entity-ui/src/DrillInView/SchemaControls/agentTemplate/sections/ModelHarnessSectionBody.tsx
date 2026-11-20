import {useModelHarness} from "../useModelHarness"

// A section's body, in its own component so `useModelHarness` runs HERE rather than in the parent.
// Two reasons, both load-bearing:
//  1. Context. The hook itself reads the changed-paths / focus filters (to mark rows, open the group
//     that changed, and narrow to it). React resolves context at the READER's position, so the hook
//     must run BELOW the providers — wrapping its output in them does nothing. A body rendered from
//     the parent's `mh` silently ignores both filters.
//  2. Cost. `useModelHarness` carries harness-catalog + vault-secrets + build-kit-overlay
//     subscriptions; mounting it per body keeps them scoped to the bodies that are on screen.
export const ModelHarnessSectionBody = ({
    section,
    ...params
}: {
    section: "model-harness" | "advanced" | "permissions"
} & Parameters<typeof useModelHarness>[0]) => {
    const mh = useModelHarness(params)
    if (section === "permissions") return <>{mh.permissionsBody}</>
    if (section === "advanced") return <>{mh.advancedChangeBody}</>
    return <>{mh.modelHarnessBody}</>
}

/** The props every inline body of the panel passes on (the live config, not a drawer draft). */
export type ModelHarnessBodyProps = Omit<Parameters<typeof ModelHarnessSectionBody>[0], "section">
