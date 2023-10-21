import {randString} from "../../../src/lib/helpers/utils"

let app_id

let countries = ["France", "Germany", "Sweden"]

Cypress.Commands.add("createVariantsAndTestsets", () => {
    cy.visit("/settings")
    cy.get('[data-cy="openai-api-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
    cy.get('[data-cy="openai-api-save"]').click()
    cy.visit("/apps")
    cy.get('[data-cy="create-new-app-button"]').click()
    cy.get('[data-cy="create-from-template"]').click()
    cy.get('[data-cy="create-app-button"]').click()
    const appName = randString(5)

    cy.get('[data-cy="enter-app-name-modal"]')
        .should("exist")
        .within(() => {
            cy.get("input").type(appName)
        })

    cy.get('[data-cy="enter-app-name-modal-button"]').click()
    cy.intercept("POST", "/api/apps/app_and_variant_from_template/").as("postRequest")
    cy.wait("@postRequest", {requestTimeout: 15000}).then((interception) => {
        app_id = interception.response.body.app_id
        cy.wrap(interception.response.body.app_id).as("app_id")
    })
    cy.wait(5000)
    cy.get('[data-cy="create-app-status-modal"]').within(() => {
        cy.get("span")
            .contains(/go to app/i)
            .click()
    })

    cy.url().should("include", "/playground")
    cy.wait(1000)
    cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
    cy.clickLinkAndWait('[data-cy="testset-new-manual-link"]')
    const testsetName = randString(5)

    cy.get('[data-cy="testset-name-input"]').type(testsetName)

    countries.forEach((country, index) => {
        cy.get(".ag-row")
            .eq(index)
            .within(() => {
                cy.get("div.ag-cell")
                    .eq(1)
                    .within(() => {
                        cy.get("span").eq(0).dblclick()
                        cy.get(".ag-input-field-input").type(country)
                    })
            })
    })

    cy.get('[data-cy="testset-save-button"]').click()
})

Cypress.Commands.add("cleanupVariantAndTestset", () => {
    cy.visit("/apps")

    cy.request({
        url: `${Cypress.env().baseApiURL}/apps/${app_id}/`,
        method: "DELETE",
        body: {
            app_id,
        },
    })
})
