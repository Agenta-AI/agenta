describe("AI Critics Evaluation workflow", () => {
    context("When successfully navigating to the evaluation path", () => {
        it("should navigate to evaluation page", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("when selecting evaluation without apikey", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        })
        it("should ok button", () => {
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.get('[data-cy="ai-critic-button"]').click()
            cy.get('[data-cy="variants-dropdown"]').eq(0).click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="selected-testset"]').click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("exist")
            cy.get('[data-cy="evaluation-error-modal-ok-button"]').click()
        })

        it("should nav button", () => {
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.get('[data-cy="ai-critic-button"]').click()
            cy.get('[data-cy="variants-dropdown"]').eq(0).click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="selected-testset"]').click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("exist")
            cy.get('[data-cy="evaluation-error-modal-nav-button"]').click()
            cy.url().should("include", "/apikeys")
        })
    })

    context.only("when apikey provided", () => {
        it("should ok button", () => {
            cy.visit("/apikeys")
            cy.get('[data-cy="apikeys-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
            cy.get('[data-cy="apikeys-save-button"]').click()
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.get('[data-cy="ai-critic-button"]').click()
            cy.get('[data-cy="variants-dropdown"]').eq(0).click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="selected-testset"]').click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.url().should("include", "/auto_ai_critique")
            cy.clickLinkAndWait('[data-cy="ai-critic-run-evaluation"]')
        })
    })
})
