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
        })

        it("should create a new Evaluation", () => {
            cy.get('[data-cy="new-evaluation-button"]').click()
            cy.get(".ant-modal-content").should("exist")

            cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
            cy.get(".ant-modal-content").should("contain.text", "This field is required")
        })

        it("should delete an Evaluation", () => {
            /* ==== Generated with Cypress Studio ==== */
            cy.get(".ag-root-wrapper").should("exist")
            cy.get("#ag-4-input").check()
            cy.get(".ant-space > :nth-child(1) > .ant-btn").click()
            cy.get(".ant-modal-confirm-btns > :nth-child(2) > span").click()
            /* ==== End Cypress Studio ==== */
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
