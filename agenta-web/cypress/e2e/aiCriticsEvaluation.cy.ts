describe("AI Critics Evaluation workflow", () => {
    beforeEach(() => {
        cy.visit("/apps")
        cy.clickLinkAndWait('[data-cy="app-card-link"]')
        cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
    })

    it("successfully navigate to evaluation path", () => {
        cy.url().should("include", "/evaluations")
    })

    it("select", () => {})
})
