import { randString } from "../../src/lib/helpers/utils"

describe("Playground Prompt Test", function () {
    // let app_id
    // before(() => {
    //     cy.createVariant()
        // cy.get("@app_id").then((appId) => {
        //     app_id = appId
        // })
    // })

    it("Should test prompt functionality in the Playground", () => {
        cy.visit("/apps")
    cy.get('[data-cy="create-from-template__no-app"]').click()
    cy.get('[data-cy="create-app-button"]').first().click()
    const appName = randString(5)

    cy.get('[data-cy="enter-app-name-modal"]')
        .should("exist")
        .within(() => {
            cy.get("input").type(appName)
        })

    cy.get('[data-cy="enter-app-name-modal-button"]').click()
    // cy.get('[data-cy="create-app-status-modal"]').should("exist")

    cy.url({timeout: 15000}).should("include", "/playground")
    // cy.url().then((url) => {
    //     app_id = url.match(/\/apps\/([a-zA-Z0-9]+)\/playground/)[1]

    //     cy.wrap(app_id).as("app_id")
    // })
    cy.contains(/modify parameters/i)
        cy.get('[data-cy="testview-input-parameters-0"]').type("Germany")
        cy.get('[data-cy="testview-input-parameters-run-button"]').click()
        cy.get('[data-cy="testview-input-parameters-result"]').should("contain.text", "Loading...")
        cy.get('[data-cy="testview-input-parameters-result"]', {timeout: 15000}).should(
            "contain.text",
            "The capital of Germany is Berlin.",
        )
        cy.get(".ant-message-notice-content").should("not.exist")
    })

    // after(() => {
    //     cy.cleanupVariantAndTestset()
    // })
})
