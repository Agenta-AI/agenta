describe("Single Model Test workflow", () => {
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

    context("When executing the evaluation", () => {
        it("Should successfully execute the evaluation process", () => {
            cy.visit(`/apps/${app_id}/annotations/single_model_test`)
            cy.url().should("include", "/annotations/single_model_test")
            cy.clickLinkAndWait('[data-cy="new-annotation-modal-button"]')

            cy.get(".ant-modal-content").should("exist")

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy^="testset"]').contains(testset_name).click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.url().should("include", "/single_model_test")
            cy.get('[data-cy="evalInstructionsShown-ok-btn"]').click()

            cy.get('[data-cy="evaluation-vote-panel-numeric-vote-input"]').should("not.exist")

            cy.wait(1000)
            cy.get('[data-cy="single-model-run-all-button"]').click()
            cy.get('[data-cy="evaluation-vote-panel-numeric-vote-input"]').type("100")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
