import {randString} from "../../../src/lib/helpers/utils"
import {removeLlmProviderKey} from "../../../src/lib/helpers/llmProviders"

let app_id

const countries = [
    {country: "France", capital: "Paris"},
    {country: "Germany", capital: "Berlin"},
    {country: "Sweden", capital: "Stockholm"},
]

const apiKey = Cypress.env("NEXT_PUBLIC_OPENAI_API_KEY")

Cypress.Commands.add("createVariant", () => {
    cy.addingOpenaiKey()
    cy.visit("/apps")

    // Check if there are app variants present
    cy.request({
        url: `${Cypress.env().baseApiURL}/apps`,
        method: "GET",
    }).then((resp) => {
        if (resp.body.length) {
            cy.get('[data-cy="create-new-app-button"]').click()
            cy.get('[data-cy="create-from-template"]').click()
        } else {
            cy.get('[data-cy="create-from-template__no-app"]').click()
        }
    })

    cy.contains("Single Prompt")
        .parentsUntil('[data-cy^="app-template-card"]')
        .last()
        .contains("create app", {matchCase: false})
        .click()

    const appName = randString(5)
    cy.task("log", `App name: ${appName}`)

    cy.get('[data-cy="enter-app-name-modal"]')
        .should("exist")
        .within(() => {
            cy.get("input").type(appName)
        })

    cy.get('[data-cy="enter-app-name-modal-button"]').click()

    cy.url().should("include", "/playground")
    cy.url().then((url) => {
        app_id = url.match(/\/apps\/([a-zA-Z0-9]+)\/playground/)[1]

        cy.wrap(app_id).as("app_id")
    })
    cy.contains(/modify parameters/i)
    cy.removeLlmProviderKey()
})

Cypress.Commands.add("createVariantsAndTestsets", () => {
    cy.createVariant()

    cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
    cy.get('[data-cy="app-testsets-link"]').trigger("mouseout")
    cy.clickLinkAndWait('[data-cy="testset-new-manual-link"]')
    const testsetName = randString(5)

    cy.get('[data-cy="testset-name-input"]').type(testsetName)
    cy.wrap(testsetName).as("testsetName")

    cy.get(".ag-row").should("have.length", 3)
    countries.forEach((country, index) => {
        cy.get(`.ag-center-cols-container .ag-row[row-index="${index}"]`).within(() => {
            cy.get(".ag-cell").eq(1).type(country.country)
            cy.get(".ag-cell")
                .eq(2)
                .type(`The capital of ${country.country} is ${country.capital}.`)
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

    cy.removeLlmProviderKey()
})

Cypress.Commands.add("addingOpenaiKey", () => {
    cy.visit("/settings")
    cy.get('[data-cy="openai-api-input"]').eq(0).type(apiKey)
    cy.get('[data-cy="openai-api-save"]').eq(0).click()
})

Cypress.Commands.add("removeLlmProviderKey", () => {
    removeLlmProviderKey()
})

Cypress.Commands.add("createNewEvaluation", () => {
    cy.request({
        url: `${Cypress.env().baseApiURL}/evaluations/?app_id=${app_id}`,
        method: "GET",
    }).then((resp) => {
        if (resp.body.length) {
            cy.get('[data-cy="new-evaluation-button"]').click()
        } else {
            cy.get('[data-cy="new-evaluation-button__no_variants"]').click()
        }
    })
    cy.get(".ant-modal-content").should("exist")

    cy.get('[data-cy="select-testset-group"]').click()
    cy.get('[data-cy="select-testset-option"]').eq(0).click()

    cy.get('[data-cy="select-variant-group"]').click()
    cy.get('[data-cy="select-variant-option"]').eq(0).click()
    cy.get('[data-cy="select-variant-group"]').click()

    cy.get('[data-cy="select-evaluators-group"]').click()
    cy.get('[data-cy="select-evaluators-option"]').eq(0).click()
    cy.get('[data-cy="select-evaluators-group"]').click()

    cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
    cy.wait(1000)
})
