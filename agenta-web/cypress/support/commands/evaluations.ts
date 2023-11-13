import {randString, removeOpenAIKey, saveOpenAIKey} from "../../../src/lib/helpers/utils"

let app_id

const countries = [
    {country: "France", capital: "Paris"},
    {country: "Germany", capital: "Berlin"},
    {country: "Sweden", capital: "Stockholm"},
]

Cypress.Commands.add("createVariant", () => {
    cy.saveOpenAiKey()
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

    cy.url({timeout: 15000}).should("include", "/playground")
    cy.url().then((url) => {
        app_id = url.match(/\/apps\/([a-zA-Z0-9]+)\/playground/)[1]

        cy.wrap(app_id).as("app_id")
    })
    cy.contains(/modify parameters/i)
    cy.removeOpenAiKey()
})

Cypress.Commands.add("createVariantsAndTestsets", () => {
    cy.createVariant()

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
    cy.request({
        url: `${Cypress.env().baseApiURL}/apps/${app_id}/`,
        method: "DELETE",
        body: {
            app_id,
        },
    })

    cy.removeOpenAiKey()
})

Cypress.Commands.add("saveOpenAiKey", () => {
    saveOpenAIKey(process.env.NEXT_PUBLIC_OPENAI_API_KEY)
})

Cypress.Commands.add("removeOpenAiKey", () => {
    removeOpenAIKey()
})
