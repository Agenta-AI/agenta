# Agenta Lab: Your LLMOps platform for LLM-powered application development

Agenta Lab is an open-source, **developer-focused** LLMOps platform that streamlines the development and evaluation of LLM-powered applications.

Building LLM-powered apps is currently very frustrating. It involves a significant amount of prompt engineering and a lots of parameters to tune and countless iterations. Agenta simplifies this process, enabling you to quickly iterate, experiment, and optimize your LLM apps. All without imposing any restrictions on your choice of framework, library, or model.

## How Agenta Lab works:
1. Develop your LLM-powered application as you would normally do. Feel free to use any framework, library, or model (langchain, llma_index, GPT-3, or open-source models).
2. With two lines of code, specify the parameters for your experiment.
3. Deploy your app using the Agenta CLI.
4. You or your team can iterate, version parameters, test different versions, and run systematic evaluations via a user-friendly web platform.

In the future, we plan to extend Agenta Lab to facilitate your LLM-app development further, providing features for deployment, monitoring, logging, and A/B testing.

## Features of Agenta Lab

- **Parameter Playground:** With just a few lines of code, define the parameters you wish to experiment with. Through our user-friendly web platform, you or your team can then experiment and tweak these parameters.

- **Version Evaluation:** Define test sets, evaluate, and compare different app versions.

- **API Deployment Made Easy:** Agenta Lab allows you to deploy your LLM applications as APIs without any additional effort. (Currently only available locally)
## Documentation

Please go to [docs.agenta.ai](docs.agenta.ai) for full documentation on:
- [Installation](docs.agenta.ai/docs/installation)
- [Getting Started](docs.agenta.ai/docs/getting-started)
- [How to tutorials](docs.agenta.ai/docs/how-to)

## Getting Started

### Requirements

Agenta Lab requires Docker installed on your machine. If you don't have Docker, you can install it from [here](https://docs.docker.com/get-docker/).

### Installation

```bash
pip install agenta
```

### Usage

#### 0. Start the agenta server

```bash
docker compose -f "docker-compose.yml" up -d --build
```

#### 1. Create a new project

Create an empty folder and use the following command to initialize a new project. Provide an app name, then choose from Template and Simple Prompt as a template.

```bash
mkdir example_app; cd example_app
agenta init
```

#### 2. Write your app and deploy it

Modify the app in app.py if needed and then proceed to serve it. Your app will start running, and you can see its endpoints on `localhost/app_name/variant_name/openapi.json`.

```bash
agenta serve
```

#### 3. Start experimenting
Navigate to localhost:3000, select your app, and begin experimenting with different parameters in the playground.


## Why choose Agenta Lab for building LLM-apps?

While there are numerous LLMops platforms, we believe Agenta Lab offers unique benefits:

- Developer-Friendly: We cater to complex LLM-apps and pipelines that require more than just a few no-code abstractions. We give you the freedom to develop your apps the way you want.
- Privacy-First: We respect your privacy and do not proxy your data through third-party services. You have the choice to host your data and models.
- Solution-Agnostic: You have the freedom to use any library and models, be it Langchain, llma_index, or a custom-written alternative.
- Collaborative: We recognize that building LLM-powered apps requires the collaboration of developers and domain experts. Our tool enables this collaboration, allowing domain experts to edit and modify parameters (e.g., prompts, hyperparameters, etc.), and label results for evaluation.
- Open-Source: We encourage you to contribute to the platform and customize it to suit your needs.

## Roadmap 

Currently, we support Q&A applications (no chat) and do not yet support persistent data (like using a persistent vector database). Our future plans include:

- Supporting chat applications.
- Support for persistent data and vector databases.
- Automated Deployment: Enable automatic app deployment with a simple commit.
- Monitoring and Logging: Introduce a dashboard to monitor your app's performance and usage.
- A/B Testing & User Feedback: Allow for experimentation with different app versions and collect user feedback.
- Regression Testing: Introduce regression tests based on real data for each new version deployment.

## Contributing

We warmly welcome contributions to Agenta Lab. Feel free to submit issues, fork the repository, and send pull requests.

### How can you help
- Designers, UI/UX and Frontend Developers: We need your expertise to enhance the UI/UX of the dashboard and the CLI. We also need help with improving the frontend of the dashboard. Feel free to fork and submit a PR. For bigger ideas, you can contact us via Discord or email (team@agenta.ai).