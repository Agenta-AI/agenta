import {isDemo} from "../support/commands/utils"

describe("App Navigation without errors", () => {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    beforeEach(() => {
        cy.visit(`/apps/${app_id}/playground`)
        cy.contains(/modify parameters/i)
    })

    it("should navigate successfully to Playground", () => {
        cy.location("pathname").should("include", "/playground")
        cy.get('[data-cy="playground-header"]').within(() => {
            cy.get("h2").should("contain.text", "1. Modify Parameters")
            cy.get("button").should("have.length", 4)
        })
    })

    it("should navigate successfully to Testsets", () => {
        cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
        cy.location("pathname").should("include", "/testsets")
        cy.get('[data-cy="app-testset-list"]').should("exist")
    })

    it("should navigate successfully to Automatic Evaluation results evaluators page", () => {
        cy.clickLinkAndWait('[data-cy="app-evaluators-link"]')
        cy.url().should("include", "/evaluations/new-evaluator")
    })

    it("should navigate successfully to Automatic Evaluation results page", () => {
        cy.clickLinkAndWait('[data-cy="app-evaluations-results-link"]')
        cy.url().should("include", "/evaluations/results")
    })

    it("should navigate successfully to A/B Test page", () => {
        cy.clickLinkAndWait('[data-cy="app-human-ab-testing-link"]')
        cy.location("pathname").should("include", "/annotations/human_a_b_testing")
    })

    it("should navigate successfully to Single Model Test page", () => {
        cy.clickLinkAndWait('[data-cy="app-single-model-test-link"]')
        cy.location("pathname").should("include", "/annotations/single_model_test")
    })

    if (isDemo()) {
        it("should navigate successfully to Endpoints", () => {
            cy.clickLinkAndWait('[data-cy="app-endpoints-link"]')
            cy.location("pathname").should("include", "/endpoints")
            cy.get('[data-cy="endpoints"]').within(() => {
                cy.contains("API endpoint")
            })
        })
    }

    it("should navigate successfully to Settings", () => {
        cy.clickLinkAndWait('[data-cy="settings-link"]')
        cy.location("pathname").should("include", "/settings")
        cy.get('[data-cy="secrets"]').within(() => {
            cy.contains("LLM Keys")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
