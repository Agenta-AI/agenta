describe("Evaluation Scenarios Test", function () {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get('[data-cy="playground-save-changes-button"]').eq(0).click()
    })

    context("Executing Evaluation Scenarios Workflow", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations/results`)
            cy.location("pathname").should("include", "/evaluations/results")
        })

        it("Should successfully create an Evaluation", () => {
            cy.createNewEvaluation()
        })

        it("Should verify that evalaution was created and completed successfully", () => {
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-cell[col-id="status"]').should("contain.text", "Completed")
        })

        it("Should double click on the Evaluation and successfully navigate to the evalaution results page", () => {
            cy.get(".ag-root-wrapper").should("exist")
            cy.get('.ag-row-first > [col-id="aggregated_results"]').click()
            cy.wait(1000)
            cy.get(".ag-cell-focus").dblclick()
            cy.contains(/Evaluation Results/i)
            cy.get('[data-cy="evalaution-scenarios-table"]').should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
