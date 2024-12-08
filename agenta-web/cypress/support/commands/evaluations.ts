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

    cy.get('[data-cy="create-from-template"]').click()

    const appName = randString(5)
    cy.task("log", `App name: ${appName}`)

    cy.get('[data-cy^="enter-app-name-input"]').type(appName)

    cy.get('[data-cy="app-template-card"]').contains("Completion Prompt").click()

    cy.get('[data-cy="create-app-from-template-button"]').click()

    cy.url().should("include", "/playground")
    cy.url().then((url) => {
        app_id = url.match(/\/apps\/([a-fA-F0-9-]+)\/playground/)[1]

        cy.wrap(app_id).as("app_id")
    })
    cy.removeLlmProviderKey()
})

Cypress.Commands.add("createVariantsAndTestsets", () => {
    cy.createVariant()

    cy.visit("/testsets")
    cy.url().should("include", "/testsets")
    cy.get('[data-cy="create-testset-modal-button"]').click()
    cy.get(".ant-modal-content").should("exist")
    cy.get('[data-cy="create-testset-from-scratch"]').click()

    const testsetName = randString(5)
    cy.get('[data-cy="testset-name-input"]').type(testsetName)
    cy.clickLinkAndWait('[data-cy="create-new-testset-button"]')
    cy.wrap(testsetName).as("testsetName")

    cy.get(".ag-row").should("have.length", 1)
    cy.get('[data-cy="testset-header-column-edit-button"]').eq(0).click()
    cy.get('[data-cy="testset-header-column-edit-input"]').clear()
    cy.get('[data-cy="testset-header-column-edit-input"]').type("country")
    cy.get('[data-cy="testset-header-column-save-button"]').click()

    countries.forEach((country, index) => {
        if (index !== 0) {
            cy.get('[data-cy="add-new-testset-row"]').click()
        }

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

Cypress.Commands.add("createNewEvaluation", (evaluatorName = "Exact Match") => {
    cy.request({
        url: `${Cypress.env().baseApiURL}/evaluations?app_id=${app_id}`,
        method: "GET",
    }).then((resp) => {
        cy.get('[data-cy="new-evaluation-button"]').click()
    })
    cy.get(".ant-modal-content").should("exist")

    cy.get('[data-cy="select-testset-group"]').click()
    cy.get('[data-cy="select-testset-option"]').eq(0).click()

    cy.get('[data-cy="select-variant-group"]').click()
    cy.get('[data-cy="select-variant-option"]').eq(0).click()
    cy.get('[data-cy="select-variant-group"]').click()

    cy.get('[data-cy="select-evaluators-group"]').click()
    cy.get('[data-cy="select-evaluators-option"]').contains(evaluatorName).eq(0).click()
    cy.get('[data-cy="select-evaluators-group"]').click({force: true})

    cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
    cy.wait(1000)
})
