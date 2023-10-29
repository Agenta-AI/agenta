describe("Playground Prompt Test", function () {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("When testing prompt functionality", () => {
        it("Should test prompt functionality in the Playground", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.contains(/modify parameters/i)
            cy.get('[data-cy="testview-input-parameters-0"]').type("Germany")
            cy.get('[data-cy="testview-input-parameters-run-button"]').click()
            cy.get('[data-cy="testview-input-parameters-result"]').should(
                "contain.text",
                "Loading...",
            )
            cy.get('[data-cy="testview-input-parameters-result"]', {timeout: 15000}).should(
                "contain.text",
                "The capital of Germany is Berlin.",
            )
            cy.get(".ant-message-notice-content").should("not.exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
