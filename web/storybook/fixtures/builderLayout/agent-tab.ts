import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

import {configSliceQueries} from "./foundation-a2"

/**
 * The Agent tab and the confirmation dialogs: the agent "Support triage" of S02 as a saved
 * revision (the first slice's fixture), the vault the Secrets list reads, and the values the
 * dialogs of F06 name.
 */
export const agentTabQueries = (scope: StoryScope): [readonly unknown[], unknown][] => [
    ...configSliceQueries(scope),
    // The Secrets list waits for the vault; an empty vault shows each attachment by its slug.
    [["vault", "secrets", undefined, scope.projectId], []],
]

/** F06 f2: the integration being removed. */
export const REMOVED_INTEGRATION = "Zendesk"

/** F06 f4: the automation being deleted. */
export const DELETED_AUTOMATION = "Daily summary"

/** F06 f5: revert v3 on an agent at v4. */
export const REVERT = {selectedVersion: 3, latestVersion: 4}
