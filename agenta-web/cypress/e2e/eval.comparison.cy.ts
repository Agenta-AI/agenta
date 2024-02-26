describe("Evaluation Comparison Test", function () {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get('[data-cy="playground-save-changes-button"]').eq(0).click()
    })

    context("Executing Evaluation Comparison Workflow", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
        })

        it("Should create 2 new Evaluations", () => {
            Array.from({length: 2}).map((_) => {
                cy.createNewEvaluation()
            })
        })

        it("Should verify that there are completed evaluations in the list", () => {
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-row[row-index="1"]').should("exist")
            cy.get('.ag-cell[col-id="status"]', {timeout: 60000})
                .eq(0)
                .should("contain.text", "Completed")
            cy.get('.ag-cell[col-id="status"]', {timeout: 60000})
                .eq(1)
                .should("contain.text", "Completed")
        })

        it("Should select 2 evaluations, click on the compare button, and successfully navigate to the comparison page", () => {
            cy.get("#ag-33-input").check()
            cy.get("#ag-39-input").check()
            cy.get('[data-cy="evaluation-results-compare-button"]').should("not.be.disabled")
            cy.get('[data-cy="evaluation-results-compare-button"]').click()
            cy.location("pathname").should("include", "/evaluations/compare")
            cy.contains(/Evaluations Comparison/i)
            cy.get('[data-cy="evaluation-compare-table"]').should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
