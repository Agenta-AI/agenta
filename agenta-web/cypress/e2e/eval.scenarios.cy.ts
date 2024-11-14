describe("Evaluation Scenarios Test", function () {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("Executing Evaluation Scenarios Workflow", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
        })

        it("Should successfully create an Evaluation", () => {
            cy.createNewEvaluation()
        })

        it("Should verify that evalaution was created and completed successfully", () => {
            cy.get(".ant-table-row").eq(0).should("exist")
            cy.get('[data-cy="evaluation-status-cell"]').should("contain.text", "Completed")
        })

        it("Should double click on the Evaluation and successfully navigate to the evalaution results page", () => {
            cy.get(".ant-table-row").eq(0).should("exist")
            cy.get(".ant-table-row").click({force: true})
            cy.wait(1000)
            cy.contains(/Evaluation Results/i)
            cy.get('[data-cy="evalaution-scenarios-table"]').should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
