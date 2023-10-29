import {isDemo} from "../support/commands/utils"

describe("App Navigation without errors", () => {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("When the user navigates through the app", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.contains(/modify parameters/i)
        })

        it("should navigate successfully to Playground", () => {
            cy.location("pathname").should("include", "/playground")
            cy.get('[data-cy="playground-header"]').within(() => {
                cy.get("h2").should("contain.text", "1. Modify Parameters")
                cy.get("button").should("have.length", 3)
            })
        })

        it("should navigate successfully to Testsets", () => {
            cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
            cy.location("pathname").should("include", "/testsets")
            cy.get('[data-cy="app-testset-list"]').should("exist")
        })

        it("should navigate successfully to Evaluations", () => {
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.location("pathname").should("include", "/evaluations")
            cy.get('[data-cy="evaluations-container"]').within(() => {
                cy.contains("1. Select an evaluation type")
                cy.contains("2. Which variants would you like to evaluate")
                cy.contains("3. Which testset you want to use?")
            })
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
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
