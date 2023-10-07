describe("Regex Evaluation workflow", () => {
    context("When navigating successfully to the evaluation path", () => {
        it("Should navigate to evaluation page", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When user tries to start without selecting all options", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })

        it("Should show modal", () => {
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get(".ant-message-notice-content")
                .should("contain.text", "Please select a variant")
                .should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })

        it("Should show modal", () => {
            cy.clickLinkAndWait('[data-cy="regex-button"]')
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get(".ant-message-notice-content")
                .should("contain.text", "Please select a variant")
                .should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })

        it("Should show modal", () => {
            cy.clickLinkAndWait('[data-cy="regex-button"]')

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get(".ant-message-notice-content")
                .should("contain.text", "Please select a testset")
                .should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })
    })

    context("When it works", () => {
        it("Should work", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
            cy.clickLinkAndWait('[data-cy="regex-button"]')

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy="testset-0"]').click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')

            cy.location("pathname").should("include", "/auto_regex_test")
        })
    })
})
