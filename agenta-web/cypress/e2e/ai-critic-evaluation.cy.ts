describe("AI Critics Evaluation workflow", () => {
    context("When navigating successfully to the evaluation path", () => {
        it("Should navigate to evaluation page", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When you select evaluation in the absence of an API key", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clearLocalStorage("openAiToken")
            cy.wait(1000)

            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.get('[data-cy="ai-critic-button"]').click()

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy="testset-0"]').click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("exist")
        })

        it("Should display modal", () => {
            cy.get('[data-cy="evaluation-error-modal-ok-button"]').click()
        })

        it("Should display modal and naviagte to apikeys", () => {
            cy.get('[data-cy="evaluation-error-modal-nav-button"]').click()
            cy.url().should("include", "/settings")
        })
    })

    context("When you select evaluation in the presence of an API key", () => {
        beforeEach(() => {
            cy.visit("/settings")
            cy.get('[data-cy="openai-api-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
            cy.get('[data-cy="openai-api-save"]').click()

            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.get('[data-cy="ai-critic-button"]').click()

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy="testset-0"]').click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
        })

        it("Should navigate successfully to ai critic", () => {
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.url().should("include", "/auto_ai_critique")
        })

        it("Should executes a complete evaluation workflow without error", () => {
            cy.get('[data-cy="ai-critic-evaluation-result"]').should(
                "contain.text",
                "Run evaluation to see results!",
            )
            cy.get(".ant-message-notice-content").should("not.exist")
            cy.wait(1000)
            cy.clickLinkAndWait('[data-cy="ai-critic-run-evaluation"]')
            cy.get(".ant-spin").should("exist")

            cy.get('[data-cy="ai-critic-evaluation-result"]', {timeout: 10000}).should(
                "contain.text",
                "Results Data",
            )

            cy.get(".ant-spin").should("not.exist")
            cy.get(".ant-message-notice-content").should("contain.text", "Evaluation Results Saved")
        })

        it("Should executes a complete evaluation workflow with error", () => {
            cy.clearLocalStorage("openAiToken")
            cy.wait(1000)
            cy.clickLinkAndWait('[data-cy="ai-critic-run-evaluation"]')

            cy.get(".ant-spin").should("exist")
            cy.get('[data-cy="ai-critic-evaluation-result"]', {timeout: 10000}).should(
                "contain.text",
                "Failed to run evaluation",
            )

            cy.get(".ant-spin").should("not.exist")
            cy.get(".ant-message-notice-content").should("exist")
        })
    })
})
