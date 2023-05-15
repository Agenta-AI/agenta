# Agenta Lab: Streamline Your LLM-App Development

Agenta is an open-source CI/CD platform designed to simplify and accelerate the development and deployment of LLM-powered applications such as chatbots, agents, Q&A systems, and more. 

Building LLM-powered apps is currently very frustrating. You need to iterate over multiple versions and play around with 100s of parameters to find something that works. Agenta streamline this process to allow you to bring your app to production faster with the certainty that it works well.

Agenta is targeted towards technnical developers building complex LLM-powered apps into production.

## Why another platform for building LLM-apps?

There are a number of great platforms for building LLM apps, yet we find that none fits our needs:

- Developer-friendly: We write complicated llm-apps and pipelines that cannot be abstracted with a few no-code abstractions. We want the control to build our apps the way we want.
- Privacy-first: We did not want our data to proxied through a third-party service. We prefered to host our own data and models.
- Solution-agnostic: We wanted to be able to use any library and models we want, whether Langchain, llma_index, or a home written alternative.
- Collaboration with non technical users: We realized that building LLM-powered apps involves the collaboration between developer and domain experts who might not be technical. We wanted to build a tool that allows both to collaborate and build apps together. The developer writes the main code, while the domain expert can edit and modify parameters (e.g. prompts, hyperparameters, etc.) and label the results for evaluation
- Open-source: We wanted to be able to contribute to the platform and extend it to our needs.

## Features
- Automated Deployment: Push a commit to automatically deploy your app, saving time and minimizing human error.
- App Evaluation: Test and compare app performance with regression tests, output comparisons, and intermediate output analysis.
- A/B Testing & User Feedback: Experiment with different app versions and gather valuable user feedback for continuous improvement.
- Workflow Management: Launch evaluations, benchmarking, and labeling workflows to make informed decisions and ensure the quality of your app.
- Local Deployment: Deploy your app locally along with the required vector database for seamless integration.

Please note that some features mentioned above are part of our future roadmap. Currently, Agenta supports monitoring, logging, and evaluations.

Follow the steps below for installation and testing instructions.

## Architecture

## Running

## Testing

## Open-source and monitization
We want to be upfront from the beginning. We decided from the beginning not the host the project under our personal usernames, then switch to a business later, like some did. Although this is an open-source project, we do plan to monetize it and build a sustainable business around it. We are still unsure how we will do this.

However here is what we promise:
- We take care of the community and the contributors: whenever possible, we would love to have our top collaborators as part of our team (either as early co-founders, employees, or contractors). We will also make sure to give back to the community by sponsoring events, giving talks, and contributing to other open-source projects.
- The core functionalities of our project will always be open-source and free to use: If you are a small team that wants to evaluate different apps, version them, and deploy them to production. You will have all the features to do that in a version that you can self-host without limitations.
- We will always be transparent about our plans and roadmap: We will always be transparent about our plans and roadmap. We will also be transparent about our monetization plans and how we plan to make money.
- We will always maintain the open-source version of this project. Unless we go out of business.


## Contributing

We welcome contributions to help us improve and expand Agenta. Please feel free to submit issues, fork the repository, and send pull requests.

### How can you help
- Designers/ UI-UX and frontend people: We need your help improving the UI/UX of the dashboard and the CLI. We also need help with the frontend of the dashboard. Please feel free to fork and PR. If you feel you have larger ideas, just contact us on Discord or email (team@agenta.ai).
