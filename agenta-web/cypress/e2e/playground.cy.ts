import {randString} from "../../src/lib/helpers/utils"

describe("run a simple prompt", () => {
    it("navigate to /apps", () => {
        const appName = randString(5)
        cy.visit("/apps")
        cy.get('[data-cy="add-new-app-modal"]').should("not.exist")
        cy.get('[data-cy="choose-template-modal"]').should("not.exist")
        cy.get('[data-cy="enter-app-name-modal"]').should("not.exist")
        cy.get('[data-cy="create-new-app-button"]').click()
        cy.get('[data-cy="add-new-app-modal"]').should("exist")
        cy.get('[data-cy="create-from-template"]').click()
        cy.get('[data-cy="choose-template-modal"]').should("exist")
        cy.get('[data-cy="create-app-button"]').click()
        cy.get('[data-cy="enter-app-name-modal"]')
            .should("exist")
            .within(() => {
                cy.get("input").type(appName)
            })
        cy.get('[data-cy="enter-app-name-modal-button"]').click()
    })
})
