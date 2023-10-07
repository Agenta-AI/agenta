describe("Regex Evaluation workflow", () => {
    context("When navigating successfully to the evaluation path", () => {
        it("Should navigate to evaluation page", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })
})
