describe("App Navigation without errors", () => {
    context("when the user has clicked on an app variant", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
        })

        it("should navigate to playground and check if it's successful", () => {
            cy.clickLinkAndWait('[data-cy="app-playground-link"]')
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

        it("should navigate to endpoints and check if it's successful", () => {
            cy.clickLinkAndWait('[data-cy="app-endpoints-link"]')
            cy.location("pathname").should("include", "/endpoints")
            cy.get('[data-cy="endpoints"]').within(() => {
                cy.contains("API endpoint")
            })
        })
    })

    context("when accessing the apikeys from apps page", () => {
        before(() => {
            cy.visit("/apps")
        })

        it("should navigate to apikeys and check if it's successful", () => {
            cy.clickLinkAndWait('[data-cy="apikeys-link"]')
            cy.location("pathname").should("include", "/apikeys")
            cy.get('[data-cy="apikeys"]').within(() => {
                cy.contains("API Keys")
                cy.contains("LLM providers")
            })
        })
    })
})
