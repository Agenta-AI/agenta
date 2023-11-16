import {randString} from "../../src/lib/helpers/utils"

// This is added to prevent Cypress from failing the test prematurely due to application errors.
Cypress.on("uncaught:exception", () => false)

describe("Code Evaluation workflow", () => {
    const eval_name = randString(5)
    let app_id
    let testset_name
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get("@testsetName").then((testsetName) => {
            testset_name = testsetName
        })
    })

    context("When navigating to Evaluation Page", () => {
        it("Should reach the Evaluation Page", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.contains(/modify parameters/i)
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When creating a new evaluation", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.clickLinkAndWait('[data-cy="code-evaluation-button"]')
            cy.clickLinkAndWait('[data-cy="new-code-evaluation-button"]')
            cy.url().should("include", "/create_custom_evaluation")
        })

        it("Should add a new Code Evaluation successfully", () => {
            cy.get('[data-cy="code-evaluation-save-button"]').should("be.disabled")
            cy.get('[data-cy="code-evaluation-input"]').type(eval_name)
            cy.get(".monaco-editor").type(".")
            cy.get('[data-cy="code-evaluation-save-button"]').should("not.be.disabled")
            cy.clickLinkAndWait('[data-cy="code-evaluation-save-button"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When executing the evaluation", () => {
        it("Should execute evaluation workflow successfully", () => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.clickLinkAndWait('[data-cy="code-evaluation-button"]')
            cy.get('[data-cy^="code-evaluation-option"]').contains(eval_name).click()

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy^="testset"]').contains(testset_name).click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.url().should("include", "/custom_code_run")
            cy.wait(1500)
            cy.clickLinkAndWait('[data-cy="code-evaluation-run"]')

            cy.get('[data-cy="code-evaluation-result"]').should("contain.text", "0.75")
            cy.get(".ant-statistic-content-value").should("contain.text", "0.75")
            cy.get(".ant-message-notice-content").should("exist")
        })
    })

    context("When displaying Code Evaluation result", () => {
        it("Should display Code Evaluation result", () => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.url().should("include", "/evaluations")
            cy.get('[data-cy="automatic-evaluation-result"]').within(() => {
                cy.get("tr").last().should("contain.text", "Custom Code Run")
            })
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
