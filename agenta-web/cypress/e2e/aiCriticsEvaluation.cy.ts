describe("AI Critics Evaluation workflow", () => {
    beforeEach(() => {
        cy.visit("/apps")
        cy.clickLinkAndWait('[data-cy="app-card-link"]')
        cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
    })
    
    context("When successfully navigating to the evaluation path", () => {
        it("should navigate to evaluation page", () => {
            cy.url().should("include", "/evaluations")
        })
    })

    context("when selecting evaluation without apikey", () => {
        it("select", () => {
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.get('[data-cy="ai-critic-button"]').click()
            cy.get('[data-cy="variants-dropdown"]').eq(0).click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="selected-testset"]').click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("exist")
        })
    })
    
})
