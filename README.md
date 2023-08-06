![37 copy](https://github.com/Agenta-AI/agenta/assets/4510758/762d4838-f56f-4773-94a7-38ae417ca439)

<p align="center">
  <img src="https://img.shields.io/github/contributors/Agenta-AI/agenta" alt="Contributors">
  <img src="https://img.shields.io/github/last-commit/Agenta-AI/agenta" alt="Last Commit">
</br>
</p>

<p align="center">
<a  href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA">
<img src="https://img.shields.io/badge/JOIN US ON SLACK-4A154B?style=for-the-badge&logo=slack&logoColor=white" />
</a>
<a href="https://www.linkedin.com/company/agenta-ai/">
<img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" />
</a>
<a  href="https://twitter.com/agenta_ai">
<img src="https://img.shields.io/badge/Twitter-1DA1F2?style=for-the-badge&logo=twitter&logoColor=white" />
</a>
</p>

<br>

### **The Open-source Developer-first LLMOps Platform**

Building production-ready LLM-powered applications is currently very difficult. It involves countless iterations of prompt engineering, parameter tuning, and architectures.

Agenta provides you with the tools to quickly 🔄 **iterate**, 🧪 **experiment**, and ⚖️ **evaluate** your LLM apps. All without imposing any restrictions on your choice of framework, library, or model.

https://github.com/Agenta-AI/agenta/assets/57623556/99733147-2b78-4b95-852f-67475e4ce9ed

## Getting Started

Please go to [docs.agenta.ai](https://docs.agenta.ai) for full documentation on:

- [Installation](https://docs.agenta.ai/installation)
- [Getting Started](https://docs.agenta.ai/getting-started)
- [Tutorials](https://docs.agenta.ai/tutorials)

## How Agenta works:

**1. Write your LLM-app code**

Write the code using any framework, library, or model you want. Add the `agenta.post` decorator and put the inputs and parameters in the function call just like in this example:

_Example simple application that generates baby names_

```python
import agenta as ag
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate

default_prompt = "Give me five cool names for a baby from {country} with this gender {gender}!!!!"


@ag.post
def generate(
    country: str,
    gender: str,
    temperature: ag.FloatParam = 0.9,
    prompt_template: ag.TextParam = default_prompt,
) -> str:
    llm = OpenAI(temperature=temperature)
    prompt = PromptTemplate(
        input_variables=["country", "gender"],
        template=prompt_template,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(country=country, gender=gender)

    return output
```

**2.Deploy your app using the Agenta CLI.**

<img width="722" alt="Screenshot 2023-06-19 at 15 58 34" src="https://github.com/Agenta-AI/agenta/assets/4510758/eede3e78-0fe1-42a0-ad4e-d880ddb10bf0">

**3. Go to agenta at localhost:3000**

Now your team can 🔄 iterate, 🧪 experiment, and ⚖️ evaluate different versions of your app (with your code!) in the web platform.</summary>
<br/>

<img width="1501" alt="Screenshot 2023-06-25 at 21 08 53" src="https://github.com/Agenta-AI/agenta/assets/57623556/7e07a988-a36a-4fb5-99dd-9cc13a678434">

## Features

- 🪄 **Playground:** With just a few lines of code, define the parameters and prompts you wish to experiment with. You and your team can quickly experiment and test new variants on the web UI.

https://github.com/Agenta-AI/agenta/assets/4510758/8b736d2b-7c61-414c-b534-d95efc69134c

- 📊 **Version Evaluation:** Define test sets, the evaluate manually or programmatically your different variants.

https://github.com/Agenta-AI/agenta/assets/4510758/f8a2a423-c0a9-40df-9c00-52908cac165a

- 🚀 **API Deployment Made Easy:** When you are ready, deploy your LLM applications as APIs in one click.

## Why choose Agenta for building LLM-apps?

- 🔨 **Build quickly**: You need to iterate many times on different architectures and prompts to bring apps to production. We streamline this process and allow you to do this in days instead of weeks.
- 🏗️ **Build robust apps and reduce hallucination**: We provide you with the tools to systematically and easily evaluate your application to make sure you only serve robust apps to production
- 👨‍💻 **Developer-centric**: We cater to complex LLM-apps and pipelines that require more than one simple prompt. We allow you to experiment and iterate on apps that have complex integration, business logic, and many prompts.
- 🌐 **Solution-Agnostic**: You have the freedom to use any library and models, be it Langchain, llma_index, or a custom-written alternative.
- 🔒 **Privacy-First**: We respect your privacy and do not proxy your data through third-party services. The platform and the data are hosted on your infrastructure.

## Migration

Migrate data from `dataset` to `testset` collection. follow the documentation [here](https://docs.agenta.ai/migration/migration)

## Contributing

We warmly welcome contributions to Agenta. Feel free to submit issues, fork the repository, and send pull requests.

Check out our [Contributing Guide](https://docs.agenta.ai/contributing/getting-started) for more information.

## Contributors ✨

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-8-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/SamMethnani"><img src="https://avatars.githubusercontent.com/u/57623556?v=4?s=100" width="100px;" alt="Sameh Methnani"/><br /><sub><b>Sameh Methnani</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=SamMethnani" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=SamMethnani" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/suadsuljovic"><img src="https://avatars.githubusercontent.com/u/8658374?v=4?s=100" width="100px;" alt="Suad Suljovic"/><br /><sub><b>Suad Suljovic</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=suadsuljovic" title="Code">💻</a> <a href="#design-suadsuljovic" title="Design">🎨</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/burtenshaw"><img src="https://avatars.githubusercontent.com/u/19620375?v=4?s=100" width="100px;" alt="burtenshaw"/><br /><sub><b>burtenshaw</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=burtenshaw" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://abram.tech"><img src="https://avatars.githubusercontent.com/u/55067204?v=4?s=100" width="100px;" alt="Abram"/><br /><sub><b>Abram</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=aybruhm" title="Code">💻</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=aybruhm" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://israelabebe.com"><img src="https://avatars.githubusercontent.com/u/7479824?v=4?s=100" width="100px;" alt="Israel Abebe"/><br /><sub><b>Israel Abebe</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/issues?q=author%3Avernu" title="Bug reports">🐛</a> <a href="#design-vernu" title="Design">🎨</a> <a href="https://github.com/Agenta-AI/agenta/commits?author=vernu" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/SohaibAnwaar"><img src="https://avatars.githubusercontent.com/u/29427728?v=4?s=100" width="100px;" alt="Master X"/><br /><sub><b>Master X</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=SohaibAnwaar" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://main-portfolio-26wv6oglp-witehound.vercel.app/"><img src="https://avatars.githubusercontent.com/u/26417477?v=4?s=100" width="100px;" alt="corinthian"/><br /><sub><b>corinthian</b></sub></a><br /><a href="https://github.com/Agenta-AI/agenta/commits?author=witehound" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Pajko97"><img src="https://avatars.githubusercontent.com/u/25198892?v=4?s=100" width="100px;" alt="Pavle Janjusevic"/><br /><sub><b>Pavle Janjusevic</b></sub></a><br /><a href="#infra-Pajko97" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!
