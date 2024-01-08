describe("Evaluators CRUD Test", function () {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get('[data-cy="playground-save-changes-button"]').eq(0).click()
    })

    context("CRUD operation with evaluators", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
        })

        it("should create a new evaluator", () => {
            cy.get('[data-cy="new-evaluation-button"]').click()
            cy.get(".ant-modal-content").should("exist")

            cy.get('[data-cy="select-testset-group"]').click()
            cy.get('[data-cy="select-testset-option"]').click()

            cy.get('[data-cy="select-variant-group"]').click()
            cy.get('[data-cy="select-variant-option"]').eq(0).click()
            cy.get('[data-cy="select-variant-group"]').click()

            cy.get('[data-cy="select-evaluators-group"]').click()
            cy.get('[data-cy="select-evaluators-option"]').eq(0).click()
            cy.get('[data-cy="select-evaluators-group"]').click()

            cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
        })

        it("should create a new Evaluation", () => {
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-cell[col-id="status"]').should("contain.text", "Completed")
            cy.get('.ag-row-first > [col-id="aggregated_results"]').click()
            cy.get(".ag-cell-focus").dblclick()
            cy.contains(/Evaluation Results/i)
            cy.get('[data-cy="evalaution-scenarios-table"]').should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
