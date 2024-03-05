describe("Evaluations CRUD Operations Test", function () {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get('[data-cy="playground-save-changes-button"]').eq(0).click()
    })

    context("Executing Evaluations CRUD operations", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations/results`)
            cy.location("pathname").should("include", "/evaluations/results")
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
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-cell[col-id="status"]').should("contain.text", "Completed")
        })

        it("Should select evaluation and successfully delete it", () => {
            cy.get(".ag-root-wrapper").should("exist")
            cy.get("#ag-33-input").check()
            cy.get(":nth-child(1) > .ant-btn > .ant-btn-icon > .anticon > svg").click()
            cy.get(".ant-modal-confirm-btns > :nth-child(2) > span").click()
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
