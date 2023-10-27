import {randString} from "../../../src/lib/helpers/utils"

let app_id

const countries = [
    {country: "France", capital: "Paris"},
    {country: "Germany", capital: "Berlin"},
    {country: "Sweden", capital: "Stockholm"},
]

Cypress.Commands.add("createVariantsAndTestsets", () => {
    cy.addingOpenaiKey()
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

    cy.intercept("POST", "/api/apps/app_and_variant_from_template/").as("postRequest")
    cy.get('[data-cy="enter-app-name-modal-button"]').click()
    cy.get('[data-cy="create-app-status-modal"]').should("exist")
    cy.wait("@postRequest").then((interception) => {
        app_id = interception.response.body.app_id
        cy.wrap(interception.response.body.app_id).as("app_id")
    })
    cy.url({timeout: 15000}).should("include", "/playground")
    cy.contains(/modify parameters/i)
    cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
    cy.clickLinkAndWait('[data-cy="testset-new-manual-link"]')
    const testsetName = randString(5)

    cy.get('[data-cy="testset-name-input"]').type(testsetName)
    cy.wrap(testsetName).as("testsetName")

    cy.get(".ag-row").should("have.length", 3)
    countries.forEach((country, index) => {
        cy.get(".ag-row")
            .eq(index)
            .within(() => {
                cy.get("div.ag-cell")
                    .eq(1)
                    .within(() => {
                        cy.get("span").eq(0).dblclick()
                        cy.get(".ag-input-field-input").type(country.country)
                    })
                cy.get("div.ag-cell")
                    .eq(2)
                    .within(() => {
                        cy.get("span").eq(0).dblclick()
                        cy.get(".ag-input-field-input").type(
                            `The capital of ${country.country} is ${country.capital}.`,
                        )
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

Cypress.Commands.add("addingOpenaiKey", () => {
    cy.visit("/settings")
    cy.get('[data-cy="openai-api-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
    cy.get('[data-cy="openai-api-save"]').click()
})
