describe("Basic smoke tests to see if app has loaded correctly", () => {
    beforeEach(() => {
        cy.visit("/apps")
    })

    it("should navigate successfully to the app page", () => {
        cy.location("pathname").should("include", "/apps")
        cy.contains("Apps").should("be.visible")
    })

    it("should navigate successfully to Settings", () => {
        cy.clickLinkAndWait('[data-cy="settings-link"]')
        cy.location("pathname").should("include", "/settings")
        cy.get('[data-cy="secrets"]').within(() => {
            cy.contains("LLM Keys")
        })
    })
})
