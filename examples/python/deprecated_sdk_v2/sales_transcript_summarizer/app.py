import agenta as ag
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.schema import HumanMessage
from langchain.prompts import PromptTemplate
from langchain.chat_models import ChatOpenAI

sample_sales_transcript = """
Salesperson: Good morning! My name is Alex, and I'm from XYZ Solutions. How can I assist you today?
Prospect: Hi Alex, I'm interested in upgrading our current software system. We need a solution that can handle higher volumes and provide better reporting capabilities.

Salesperson: Absolutely! We have the perfect software suite that meets your requirements. It's our latest version, specifically designed for businesses like yours. It can handle large volumes of data and offers advanced reporting features. Would you like me to walk you through the key features?
Prospect: Yes, please. I want to understand how it can benefit our team and streamline our operations.

Salesperson: Great! With our software, you'll experience improved data processing, reducing the time it takes to generate reports by up to 50%. Additionally, it offers customizable dashboards, so you can monitor key metrics in real-time. The system also integrates seamlessly with your existing tools, eliminating any disruption during implementation.
Prospect: That sounds impressive. How about the cost of the upgrade? We have a budget to consider.

Salesperson: Of course. The pricing for the software depends on the number of user licenses and the level of customization required. I can provide you with a detailed quote tailored to your specific needs. Additionally, we offer flexible payment options to accommodate your budget.
Prospect: That's good to know. Can you also share some success stories or case studies from other clients who upgraded to this version?

Salesperson: Absolutely! We have several success stories from businesses similar to yours. One of our clients, Company A, saw a 30% increase in productivity within the first three months of implementation. They also reported a significant reduction in errors and better decision-making due to real-time data insights.
Prospect: Impressive! I'd like to discuss this with my team before making a decision. Can you send me the detailed quote and any additional information?

Salesperson: Of course! I'll email you all the relevant materials right away. Please feel free to reach out if you have any further questions or need assistance in the future.
Prospect: Thank you, Alex. I appreciate your help.

Salesperson: You're welcome! It was my pleasure assisting you. Have a wonderful day!
"""


default_prompt1 = "summarize the following {text} "
default_prompt2 = "these are summaries of a long text {text}\n please summarize them"

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.9),
    model=ag.MultipleChoiceParam(
        "text-davinci-003",
        ["text-davinci-003", "gpt-3.5-turbo", "gpt-4"],
    ),
    max_tokens=ag.IntParam(50, 0, 4000),
    chunk_size=ag.MultipleChoiceParam(
        "1000",
        ["1000", "2000", "3000"],
    ),
    prompt_chunks=ag.TextParam(default_prompt1),
    prompt_final=ag.TextParam(default_prompt2),
)


def call_llm(model, temperature, max_tokens, prompt, **kwargs):
    # import ipdb
    # ipdb.set_trace()
    if model == "text-davinci-003":
        llm = OpenAI(model=model, temperature=temperature, max_tokens=max_tokens)
        chain = LLMChain(llm=llm, prompt=prompt)
        output = chain.run(**kwargs)
    elif model in ["gpt-3.5-turbo", "gpt-4"]:
        chat = ChatOpenAI(model=model, temperature=temperature, max_tokens=max_tokens)
        messages = [HumanMessage(content=prompt.format(**kwargs))]
        output = chat(
            messages,
        ).content
    return output


@ag.entrypoint
def generate(
    transcript: str,
) -> str:
    transcript_chunks = [
        transcript[i : i + int(ag.config.chunk_size)]
        for i in range(0, len(transcript), int(ag.config.chunk_size))
    ]

    outputs = []
    prompt = PromptTemplate(
        input_variables=["text"],
        template=ag.config.prompt_chunks,
    )

    for chunk in transcript_chunks:
        outputs.append(
            call_llm(
                model=ag.config.model,
                temperature=ag.config.temperature,
                max_tokens=ag.config.max_tokens,
                prompt=prompt,
                text=chunk,
            )
        )

    outputs = "\n".join(outputs)

    prompt = PromptTemplate(
        input_variables=["text"],
        template=ag.config.prompt_final,
    )
    final_out = call_llm(
        model=ag.config.model,
        temperature=ag.config.temperature,
        max_tokens=ag.config.max_tokens,
        prompt=prompt,
        text=outputs,
    )
    return str(final_out)
