import {isDemo} from "../support/commands/utils"

describe("App Navigation without errors", () => {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("When the user navigates outside of the App views", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.contains(/modify parameters/i)
        })

        it("should navigate to playground and check if it's successful", () => {
            cy.location("pathname").should("include", "/playground")
            cy.get('[data-cy="playground-header"]').within(() => {
                cy.get("h2").should("contain.text", "1. Modify Parameters")
                cy.get("button").should("have.length", 3)
            })
        })

        it("should navigate to testsets and check if it's successful", () => {
            cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
            cy.location("pathname").should("include", "/testsets")
            cy.get('[data-cy="app-testset-list"]').should("exist")
        })

        it("should navigate to evaluations and check if it's successful", () => {
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.location("pathname").should("include", "/evaluations")
            cy.get('[data-cy="evaluations-container"]').within(() => {
                cy.contains("1. Select an evaluation type")
                cy.contains("2. Which variants would you like to evaluate")
                cy.contains("3. Which testset you want to use?")
            })
        })

        if (isDemo()) {
            it("should navigate to endpoints and check if it's successful", () => {
                cy.clickLinkAndWait('[data-cy="app-endpoints-link"]')
                cy.location("pathname").should("include", "/endpoints")
                cy.get('[data-cy="endpoints"]').within(() => {
                    cy.contains("API endpoint")
                })
            })
        }
    })

    context("When the user navigates from Apps view", () => {
        before(() => {
            cy.visit("/apps")
        })

        it("should navigate to secrets and check if it's successful", () => {
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
