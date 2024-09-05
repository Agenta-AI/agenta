describe("Playground Prompt Test", function () {
    context("When testing single prompt template in the Playground", () => {
        let app_id
        before(() => {
            cy.createVariant()
            cy.get("@app_id").then((appId) => {
                app_id = appId
            })
        })
        it("Should test prompt functionality in the Playground", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.url().should("include", "/playground")
            cy.contains(/modify parameters/i)
            cy.get('[data-cy^="testview-input-parameters"]').eq(0).type("Germany")
            cy.get('[data-cy="testview-input-parameters-run-button"]').click()
            cy.intercept("POST", "**/demo/app/generate", {
                statusCode: 200,
                fixture: "single-prompt-openai/playground.json",
            })
        })
    })

    context("When testing chat prompt template in the Playground", () => {
        let app_id
        before(() => {
            cy.createVariant("chat")
            cy.get("@app_id").then((appId) => {
                app_id = appId
            })
        })

        it("Should test chat prompt functionality in the Playground", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.url().should("include", "/playground")
            cy.contains(/modify parameters/i)
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
