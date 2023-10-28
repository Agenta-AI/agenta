describe("Playground | Simple prompt", function () {
    let app_id
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("when an api key is provided", function () {
        it("should run the prompt without error", () => {
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
