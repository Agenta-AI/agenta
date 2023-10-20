import agenta as ag
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate

default_prompt = """
**Write an email** from {from_sender} to {to_receiver} with the designated tone and style: {email_style}. The primary content of the email is: {email_content}.

Use the following format:
Subject: <subject>

<body>

**Procedure**:

**(1) Determine the primary talking points of the email:**
1. Identify the central theme of the provided content.
2. Extract secondary messages or supporting points.

**(2) Frame sentences for each talking point, keeping in mind the given tone and style {{ style }}:**
3. Create a compelling opening sentence that sets the tone and introduces the main theme.
4. Formulate sentences that add depth or context to each of the previously identified talking points.

**(3) Draft the initial version of the email:**
Use the sentences crafted in the previous step to compose a coherent and engaging email. Ensure that the flow feels natural and that each sentence transitions smoothly to the next.

**(4) Analyze the email and list ways to refine it:**
5. Identify areas where the message might be unclear or could benefit from additional information.
6. Consider places where the language or tone might be enhanced to be more persuasive or emotive.
7. Evaluate if the email adheres to the style directive and, if not, identify deviations.

**(5) Re-write the email by applying the insights gained:**
Rework the initial draft, incorporating the improvements identified in the previous step. Aim to present the message as effectively as possible while strictly adhering to the prescribed tone and style.

"""

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.9),
    prompt_template=ag.TextParam(default_prompt)
)

@ag.entrypoint
def generate(
    from_sender: str,
    to_receiver: str,
    email_style: str,
    email_content: str,
) -> str:
    llm = OpenAI(temperature=ag.config.temperature)
    prompt = PromptTemplate(
        input_variables=["from_sender", "to_receiver", "email_style", "email_content"], template=ag.config.prompt_template
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(
        from_sender=from_sender,
        to_receiver=to_receiver,
        email_style=email_style,
        email_content=email_content,
    )

    return output
