---
name: Feature Request
description: Suggest an idea for this project
title: "[Feature]: "
labels: ["Feature Request"]
body:
  - type: textarea
    id: problem
    attributes:
      label: Is your feature request related to a problem? Please describe.
      description: A clear and concise description of what the problem is. Ex. I'm always frustrated when [...]
      placeholder: Tell us about the problem you're facing
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Describe the solution you'd like
      description: A clear and concise description of what you want to happen.
      placeholder: Describe your ideal solution
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Describe alternatives you've considered
      description: A clear and concise description of any alternative solutions or features you've considered.
      placeholder: What other approaches have you thought about?
    validations:
      required: false
  - type: textarea
    id: additional-context
    attributes:
      label: Additional context
      description: Add any other context or screenshots about the feature request here.
      placeholder: Any additional information, screenshots, or examples
    validations:
      required: false
  - type: input
    id: contact
    attributes:
      label: Twitter / LinkedIn details
      description: We announce new features on Twitter + LinkedIn. When this is announced, and you'd like a mention, we'll gladly shout you out!
      placeholder: ex. @username / https://www.linkedin.com/in/username/
    validations:
      required: false
