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

        it("should create a new Evaluation", () => {
            Array.from({length: 2}).map((_) => {
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

                cy.get(
                    ".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg",
                ).click()
                cy.wait(1000)
            })
        })

        it("should create a new Evaluation", () => {
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-row[row-index="1"]').should("exist")
            cy.get('.ag-cell[col-id="status"]').should("contain.text", "Completed")
        })

        it("should create a new Evaluation", () => {
            cy.get("#ag-33-input").check()
            cy.get("#ag-35-input").check()
            cy.get(":nth-child(2) > .ant-btn > .ant-btn-icon > .anticon > svg").click()
            cy.location("pathname").should("include", "/evaluations/compare")
            cy.contains(/Evaluations Comparison/i)
            cy.get('[data-cy="evaluation-compare-table"]').should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
