describe("App Navigation without errors", () => {
    beforeEach(() => {
        cy.visit("/apps")
        cy.clickLinkAndWait('[data-cy="app-card-link"]')
    })

    const variant = "capitals"

    it("should route to /playground", () => {
        cy.clickLinkAndWait('[data-cy="app-playground-link"]')
        cy.request({
            url: `/apps/${variant}/playground`,
            method: "GET",
        }).should((response) => {
            expect(response.status).to.eq(200)
        })
        cy.location("pathname").should("include", "/playground")
        cy.get('[data-cy="playground-header"]').within(() => {
            cy.get("h2").should("contain.text", "1. Modify Parameters")
            cy.get("button").should("have.length", 3)
        })
    })

    it("should route to /testsets", () => {
        cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
        cy.request({
            url: `/apps/${variant}/testsets`,
            method: "GET",
        }).should((response) => {
            expect(response.status).to.eq(200)
        })
        cy.location("pathname").should("include", "/testsets")
        cy.get('[data-cy="app-testset-list"]').should("exist")
    })

    it("should route to /evaluations", () => {
        cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        cy.request({
            url: `/apps/${variant}/evaluations`,
            method: "GET",
        }).should((response) => {
            expect(response.status).to.eq(200)
        })
        cy.location("pathname").should("include", "/evaluations")
        cy.get('[data-cy="evaluations-container"]').within(() => {
            cy.contains("1. Select an evaluation type")
            cy.contains("2. Which variants would you like to evaluate")
            cy.contains("3. Which testset you want to use?")
        })
    })

    it("should route to /endpoints", () => {
        cy.clickLinkAndWait('[data-cy="app-endpoints-link"]')
        cy.request({
            url: `/apps/${variant}/endpoints`,
            method: "GET",
        }).should((response) => {
            expect(response.status).to.eq(200)
        })
        cy.location("pathname").should("include", "/endpoints")
        cy.get('[data-cy="endpoints"]').within(() => {
            cy.contains("API endpoint")
        })
    })

    it("should route to /apikeys", () => {
        cy.clickLinkAndWait('[data-cy="apikeys-link"]')
        cy.request({
            url: `/apikeys`,
            method: "GET",
        }).should((response) => {
            expect(response.status).to.eq(200)
        })
        cy.location("pathname").should("include", "/apikeys")
        cy.get('[data-cy="apikeys"]').within(() => {
            cy.contains("API Keys")
            cy.contains("LLM providers")
        })
    })
})
