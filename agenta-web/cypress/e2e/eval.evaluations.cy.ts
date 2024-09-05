describe("Evaluations CRUD Operations Test", function () {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("Executing Evaluations CRUD operations", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
        })

        it("Should successfully create an Evaluation", () => {
            cy.createNewEvaluation()
        })

        it("Should throw warning when creating an evaluation without selecting testset, variants, and evaluators", () => {
            cy.get('[data-cy="new-evaluation-button"]').click()
            cy.get(".ant-modal-content").should("exist")

            cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
            cy.get(".ant-modal-content").should("contain.text", "This field is required")
        })

        it("Should verify the successful creation and completion of the evaluation", () => {
            cy.get(".ant-table-row").eq(0).should("exist")
            cy.get('[data-cy="evaluation-status-cell"]').should("contain.text", "Completed")
        })

        it("Should select evaluation and successfully delete it", () => {
            cy.get(".ant-checkbox-wrapper").should("exist")
            cy.get(".ant-checkbox-input").eq(0).check()
            cy.get('[data-cy="delete-evaluation-button"]').click()

            cy.get(".ant-modal-content").should("exist")
           cy.get(".ant-modal-footer > .ant-btn-primary").click()
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
