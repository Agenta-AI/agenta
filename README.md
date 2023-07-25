![37 copy](https://github.com/Agenta-AI/agenta/assets/4510758/762d4838-f56f-4773-94a7-38ae417ca439)


<p align="center">
    <a href="https://twitter.com/agenta_ai">
    <img src="https://img.shields.io/twitter/follow/agenta_ai?style=social" alt="Twitter Follow">
  </a>
  <img src="https://img.shields.io/github/contributors/Agenta-AI/agenta" alt="Contributors">
  <img src="https://img.shields.io/github/last-commit/Agenta-AI/agenta" alt="Last Commit">
</br>
<a href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA">
    <img src="https://img.shields.io/badge/Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white">
    </a>
</p>

### **The Open-source Developer-first LLMOps Platform**


Building production-ready LLM-powered applications is currently very difficult. It involves countless iterations of prompt engineering, parameter tuning, and architectures.

Agenta provides you with the tools to quickly 🔄 **iterate**, 🧪 **experiment**, and ⚖️ **evaluate** your LLM apps. All without imposing any restrictions on your choice of framework, library, or model.

https://github.com/Agenta-AI/agenta/assets/57623556/99733147-2b78-4b95-852f-67475e4ce9ed



## How Agenta works:
<details open><summary>Write your LLM-powered application as you would normally do. Feel free to use any framework, library, or model (langchain or llma_index, GPT-4 or Falcon).</summary>
<br/>

_Example simple application that generates baby names_
```python
    from jinja2 import Template
    import openai
    template = Template(prompt_template)
    prompt = template.render(country=country, gender=gender)

    openai.api_key = os.environ.get("OPENAI_API_KEY")  # make sure to set this manually!
    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}])

    print(chat_completion.choices[0].message.content)
```

</details>
<details open> <summary>With two lines of code, specify the inputs and parameters for your experiment.</summary>
<br/>
  
```python
import agenta as ag
default_prompt = "Give me five cool names for a baby from {{country}} with this gender {{gender}}!!!!"
@ag.post
def generate(country: str, gender: str, temperature: ag.FloatParam = 0.9, prompt_template: ag.TextParam = default_prompt) -> str:
# rest of the code
```
  </details>

<details open> <summary>Deploy your app using the Agenta CLI.</summary>
  <br/>
<img width="722" alt="Screenshot 2023-06-19 at 15 58 34" src="https://github.com/Agenta-AI/agenta/assets/4510758/eede3e78-0fe1-42a0-ad4e-d880ddb10bf0">
  </details>

<details open> <summary>Now your team can 🔄 iterate, 🧪 experiment, and ⚖️ evaluate different versions of your app (with your code!) in the web platform.</summary>
  <br/>
<img width="1501" alt="Screenshot 2023-06-25 at 21 08 53" src="https://github.com/Agenta-AI/agenta/assets/57623556/7e07a988-a36a-4fb5-99dd-9cc13a678434">
</details>

## Features

- 🪄 **Playground:** With just a few lines of code, define the parameters and prompts you wish to experiment with. You and your team can quickly experiment and fork new versions on the web UI.

- 📊 **Version Evaluation:** Define test sets, evaluate, and A/B test app versions.

- 🚀 **API Deployment Made Easy:** When you are ready, deploy your LLM applications as APIs in one click.
  
## Getting Started

Please go to [docs.agenta.ai](https://docs.agenta.ai) for full documentation on:
- [Installation](https://docs.agenta.ai/docs/installation)
- [Getting Started](https://docs.agenta.ai/docs/getting-started)
- [Tutorials](https://docs.agenta.ai/docs/tutorials)

## Why choose Agenta for building LLM-apps?

- 🔨 **Build quickly**: You need to iterate many times on different architectures and prompts to bring apps to production. We streamline this process and allow you to do this in days instead of weeks.
- 🏗️ **Build robust apps and reduce hallucination**: We provide you with the tools to systematically and easily evaluate your application to make sure you only serve robust apps to production
- 👨‍💻 **Developer-centric**: We cater to complex LLM-apps and pipelines that require more than one simple prompt. We allow you to experiment and iterate on apps that have complex integration, business logic, and many prompts.
- 🌐 **Solution-Agnostic**: You have the freedom to use any library and models, be it Langchain, llma_index, or a custom-written alternative.
- 🔒 **Privacy-First**: We respect your privacy and do not proxy your data through third-party services. The platform and the data are hosted on your infrastructure.

## Contributing

We warmly welcome contributions to Agenta. Feel free to submit issues, fork the repository, and send pull requests.

