describe("AI Critics Evaluation workflow", () => {
    let app_id
    let testset_name
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get("@testsetName").then((testsetName) => {
            testset_name = testsetName
        })
    })

    context("When you select evaluation without an API key", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.clearLocalStorage("openAiToken")

            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.get('[data-cy="ai-critic-button"]').click()

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy^="testset"]').contains(testset_name).click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("exist")
        })

        it("Should display when starting evaluation", () => {
            cy.get('[data-cy="evaluation-error-modal-ok-button"]').click()
        })

        it("Should navigate to Settings when clicking on the modal", () => {
            cy.get('[data-cy="evaluation-error-modal-nav-button"]').click()
            cy.url().should("include", "/settings")
        })
    })

    context("When you select evaluation with an API key", () => {
        beforeEach(() => {
            cy.addingOpenaiKey()

            cy.visit(`/apps/${app_id}/evaluations`)
            cy.get('[data-cy="ai-critic-button"]').click()

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy^="testset"]').contains(testset_name).click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
        })

        it("Should successfully navigate to AI Critic", () => {
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.url().should("include", "/auto_ai_critique")
        })

        it("Should complete the evaluation workflow without errors", () => {
            cy.get('[data-cy="ai-critic-evaluation-result"]').should(
                "contain.text",
                "Run evaluation to see results!",
            )
            cy.get(".ant-message-notice-content").should("not.exist")
            cy.wait(1500)
            cy.clickLinkAndWait('[data-cy="ai-critic-run-evaluation"]')
            cy.get(".ant-spin").should("exist")

            cy.get('[data-cy="ai-critic-evaluation-result"]', {timeout: 15000}).should(
                "contain.text",
                "Results Data",
            )

            cy.get(".ant-spin").should("not.exist")
            cy.get(".ant-message-notice-content").should("contain.text", "Evaluation Results Saved")
        })

        it("Should execute evaluation workflow with error", () => {
            cy.clearLocalStorage("openAiToken")
            cy.wait(1000)
            cy.clickLinkAndWait('[data-cy="ai-critic-run-evaluation"]')

            cy.get(".ant-spin").should("exist")
            cy.get('[data-cy="ai-critic-evaluation-result"]', {timeout: 15000}).should(
                "contain.text",
                "Failed to run evaluation",
            )

            cy.get(".ant-spin").should("not.exist")
            cy.get(".ant-message-notice-content").should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
