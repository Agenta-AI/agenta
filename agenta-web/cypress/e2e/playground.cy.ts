describe("Playground Prompt Test", function () {
    context("When testing single prompt template in the Playground", () => {
        before(() => {
            cy.createVariant()
        })

        it("Should test signle prompt functionality in the Playground", () => {
            cy.get('[data-cy^="testview-input-parameters"]').eq(0).type("Germany")
            cy.get('[data-cy="testview-input-parameters-run-button"]').click()
            cy.intercept("POST", "**/demo/app/generate", {
                statusCode: 200,
                fixture: "single-prompt-openai/playground.json",
            })
            cy.get('[data-cy="testview-input-parameters-result"]').should(
                "contain.text",
                "The capital of Germany is Berlin.",
            )
            cy.get(".ant-message-notice-content").should("not.exist")
        })

        after(() => {
            cy.cleanupVariantAndTestset()
        })
    })

    context("When testing chat prompt template in the Playground", () => {
        before(() => {
            cy.createVariant("chat")
        })

        it("Should test chat prompt functionality in the Playground", () => {
            cy.get('[data-cy="chatview-input-parameters"]').eq(0).type("Capital of Germany?")
            cy.get('[data-cy="testview-input-parameters-run-button"]').click()
            cy.intercept("POST", "**/demo/app/generate", {
                statusCode: 200,
                fixture: "single-prompt-openai/playground.json",
            })
            cy.get('[data-cy="chatview-input-parameters"]')
                .eq(1)
                .should("contain.text", "The capital of Germany is Berlin.")
            cy.get(".ant-message-notice-content").should("not.exist")
        })

        after(() => {
            cy.cleanupVariantAndTestset()
        })
    })
})
