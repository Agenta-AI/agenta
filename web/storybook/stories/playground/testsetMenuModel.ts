import type {TestsetMenuModel} from "@agenta/playground-ui/hooks"
import {fn} from "storybook/test"

/** A test set menu model with every action stubbed: not connected, unless overridden. */
export const testsetMenuModel = (overrides: Partial<TestsetMenuModel> = {}): TestsetMenuModel => ({
    loadableId: "testset:workflow:story",
    visible: true,
    label: "Test set",
    isConnected: false,
    hasLocalChanges: false,
    hasSuccessfulResults: false,
    isChat: false,
    connectedRevisionId: null,
    connectedTestsetId: null,
    dialog: null,
    saving: false,
    connect: fn(),
    sync: fn(),
    manage: fn(),
    change: fn(),
    disconnect: fn(),
    close: fn(),
    confirmLoad: fn(),
    confirmEdit: fn(),
    confirmKeepDrafts: fn(),
    resolveUnsaved: fn(),
    syncSubmit: fn(),
    canSyncSubmit: fn(),
    ...overrides,
})
