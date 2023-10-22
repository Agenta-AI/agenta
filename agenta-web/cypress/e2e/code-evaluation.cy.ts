import {randString} from "../../src/lib/helpers/utils"

// This is added to prevent Cypress from failing the test prematurely due to application errors.
Cypress.on("uncaught:exception", () => false)

describe("Code Evaluation workflow", () => {
    const eval_name = randString(5)
    let app_id
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("When navigating to Evaluation Page", () => {
        it("Should reach the Evaluation Page", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.wait(1000)
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("Should add a new Code Evaluation", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.clickLinkAndWait('[data-cy="code-evaluation-button"]')
            cy.clickLinkAndWait('[data-cy="new-code-evaluation-button"]')
            cy.url().should("include", "/create_custom_evaluation")
        })

        it("When creating a new evaluation", () => {
            cy.get('[data-cy="code-evaluation-save-button"]').should("be.disabled")
            cy.get('[data-cy="code-evaluation-input"]').type(eval_name)
            cy.get(".monaco-editor", {timeout: 15000}).type(".")
            cy.get('[data-cy="code-evaluation-save-button"]').should("not.be.disabled")
            cy.clickLinkAndWait('[data-cy="code-evaluation-save-button"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("Should Execute the Evaluation Workflow", () => {
        it("When executing the evaluation, it should run successfully", () => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.clickLinkAndWait('[data-cy="code-evaluation-button"]')
            cy.get('[data-cy^="code-evaluation-option"]').contains(eval_name).click()

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy="testset-0"]').click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.url().should("include", "/custom_code_run")
            cy.wait(1000)
            cy.clickLinkAndWait('[data-cy="code-evaluation-run"]')

            cy.get('[data-cy="code-evaluation-result"]', {timeout: 15000}).should(
                "contain.text",
                "0.75",
            )
            cy.get(".ant-statistic-content-value", {timeout: 15000}).should("contain.text", "0.75")
            cy.get(".ant-message-notice-content").should("exist")
        })
    })

    context("Should display Code Evaluation result", () => {
        it("When displaying Code Evaluation result", () => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.url().should("include", "/evaluations")
            cy.get('[data-cy="automatic-evaluation-result"]').within(() => {
                cy.get("tr", {timeout: 15000}).last().should("contain.text", "Custom Code Run")
            })
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
