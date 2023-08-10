/// <reference types="cypress" />

import "./utils"

declare global {
    namespace Cypress {
        interface Chainable {
            clickLinkAndWait(selector: string): Chainable<void>
        }
    }
}
