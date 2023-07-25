import agenta as ag
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate


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


def truncate_text(text: str, max_length: int) -> str:
    """
    Function is responsible for truncating the input text to maximum length.
    """
    return text[:max_length]


def generate_summary(text: str, max_length: int) -> str:
    # Implement your summarization logic here (you can use external libraries or models)
    # For simplicity, let's just truncate the text for this example
    summary = truncate_text(text, max_length) + "\nWith this information, {question}"
    return summary


@ag.post
def generate(
    question: str,
    max_length: int,
    temperature: ag.FloatParam = 0.9,
    prompt_template: ag.TextParam = sample_sales_transcript,
) -> str:
    # Generate a summary using the summarization function
    summary = generate_summary(prompt_template, max_length)

    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(
        input_variables=["question"],
        template=summary,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(question=question)

    return output
