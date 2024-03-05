/// <reference types="cypress" />

import "./utils"
import "./evaluations"

declare global {
    namespace Cypress {
        interface Chainable {
            clickLinkAndWait(selector: string): Chainable<void>
            createVariantsAndTestsets(): Chainable<void>
            cleanupVariantAndTestset(): Chainable<void>
            createVariant(): Chainable<void>
            saveOpenAiKey(): Chainable<void>
            removeLlmProviderKey(): Chainable<void>
            addingOpenaiKey(): Chainable<void>
            createNewEvaluation(): Chainable<void>
        }
    }
}
