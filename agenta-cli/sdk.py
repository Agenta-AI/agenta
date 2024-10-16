from typing import Any, Dict, Optional

from pydantic import BaseModel


class Reference(BaseModel):
    # IDENTIFIER
    id: Optional[str] = None
    slug: Optional[str] = None
    # VERSION
    version: Optional[str] = None


class Application(BaseModel):
    # SCOPE
    project_id: str
    # IDENTIFIER
    id: str
    slug: str
    # HEADER
    name: Optional[str] = None
    description: Optional[str] = None


class Service(BaseModel):
    # INTERNALS
    url: str


class Configuration(BaseModel):
    # SCOPE
    project_id: str
    # IDENTIFIER
    id: str
    slug: str
    # HEADER
    name: Optional[str] = None
    description: Optional[str] = None
    # VERSION
    version: str
    latest: bool

    # REFERENCES
    application: Application

    # INTERNALS
    parameters: Dict[str, Any]


class Variant(BaseModel):
    # SCOPE
    project_id: str
    # IDENTIFIER
    id: str
    slug: str
    # HEADER
    name: Optional[str] = None
    description: Optional[str] = None
    # VERSION
    version: str
    latest: bool

    # REFERENCES
    application: Application
    service: Service
    configuration: Configuration


class Environment(BaseModel):
    # SCOPE
    project_id: str
    # IDENTIFIER
    id: str
    slug: str
    # HEADER
    name: Optional[str] = None
    description: Optional[str] = None
    # VERSION
    version: str
    latest: bool

    # REFERENCES
    application: Application
    variant: Variant


class Prompt(Variant):
    pass


class ApplicationsClient:
    def __init__(self):
        pass

    def create(
        self,
        *,
        application_slug: Optional[str] = None,
    ) -> Prompt:
        pass

    def fetch(
        self,
        *,
        configuration_reference: Optional[Reference] = None,
        variant_reference: Optional[Reference] = None,
        environment_reference: Optional[str] = None,
    ) -> Prompt:
        pass


class ConfigurationsClient:
    def __init__(self):
        pass

    def create(
        self,
        *,
        application_slug: Optional[str] = None,
        configuration_slug: Optional[str] = None,
        configuration_parameters: Optional[Dict[str, Any]] = None,
        configuration_reference: Optional[Reference] = None,
        configuration: Optional[Configuration] = None,
    ) -> Configuration:
        pass

    def fetch(
        self,
        *,
        configuration_reference: Optional[Reference] = None,
        variant_reference: Optional[Reference] = None,
        environment_reference: Optional[Reference] = None,
    ) -> Configuration:
        pass

    def commit(
        self,
        *,
        configuration_slug: Optional[str] = None,
        configuration_parameters: Optional[Dict[str, Any]] = None,
        configuration_reference: Optional[Reference] = None,
        configuration: Optional[Configuration] = None,
    ) -> Configuration:
        pass


class VariantsClient:
    def __init__(self):
        pass

    def create(
        self,
        *,
        variant_slug: Optional[str] = None,
        variant_url: Optional[str] = None,
        configuration_reference: Optional[Reference] = None,
        configuration: Optional[Configuration] = None,
        variant_reference: Optional[Reference] = None,
        variant: Optional[Variant] = None,
    ) -> Variant:
        pass

    def fetch(
        self,
        *,
        variant_reference: Optional[Reference] = None,
        environment_reference: Optional[Reference] = None,
    ) -> Variant:
        pass

    def commit(
        self,
        *,
        variant_slug: Optional[str] = None,
        variant_url: Optional[str] = None,
        configuration_reference: Optional[Reference] = None,
        configuration: Optional[Configuration] = None,
        variant_reference: Optional[Reference] = None,
        variant: Optional[Variant] = None,
    ) -> Variant:
        pass


class EnvironmentsClient:
    def __init__(self):
        pass

    def create(
        self,
        *,
        environment_slug: Optional[str] = None,
        variant_reference: Optional[Reference] = None,
        variant: Optional[Variant] = None,
    ) -> Environment:
        pass

    def fetch(
        self,
        *,
        environment_reference: Optional[Reference] = None,
    ) -> Prompt:
        pass

    def commit(
        self,
        *,
        environment_slug: Optional[str] = None,
        variant_reference: Optional[Reference] = None,
        variant: Optional[Variant] = None,
        environment_reference: Optional[str] = None,
        environment: Optional[Environment] = None,
    ) -> Environment:
        pass


class PromptsClient:
    def __init__(self):
        pass

    def create(
        self,
        slug: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        *,
        application_slug: Optional[str] = None,
        template_key: Optional[str] = None,
        prompt_reference: Optional[Reference] = None,
        prompt: Optional[Prompt] = None,
    ) -> Prompt:
        pass

    def fetch(
        self,
        *,
        prompt_reference: Optional[Reference] = None,
        environment_slug: Optional[Reference] = None,
    ) -> Prompt:
        pass

    def commit(
        self,
        slug: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        *,
        prompt_reference: Optional[Reference] = None,
        prompt: Optional[Prompt] = None,
    ) -> Prompt:
        pass

    def deploy(
        self,
        *,
        prompt_reference: Optional[Reference] = None,
        prompt: Optional[Variant] = None,
        environment_slug: str,
    ) -> Environment:
        pass


class Agenta:
    def __init__(self):
        self.applications = ApplicationsClient()
        self.configurations = ConfigurationsClient()
        self.variants = VariantsClient()
        self.environments = EnvironmentsClient()
        #
        self.prompts = PromptsClient()


ag = Agenta()


########## APPLICATIONS ##########

##### CREATE #####

# 1.a. new application
application: Application = ag.applications.create()

# 1.b. new application
application: Application = ag.applications.create(
    application_slug="...",
)

##### FETCH #####

# 1. existing configuration
application: Application = ag.applications.fetch(
    configuration_reference="...",
)

# 2. existing variant
application: Application = ag.applications.fetch(
    variant_reference="...",
)

# 3. existing environment
application: Application = ag.applications.fetch(
    environment_reference="...",
)


########## CONFIGURATIONS ##########

##### CREATE #####

# 1.a. new configuration
configuration: Configuration = ag.configurations.create(
    application_slug="...",
    configuration_parameters="...",
)

# 1.b. new configuration
configuration: Configuration = ag.configurations.create(
    application_slug="...",
    configuration_parameters="...",
    configuration_slug="...",
)

# 2.a.i. existing configuration
configuration: Configuration = ag.configurations.create(
    configuration_reference="...",
)

# 2.a.ii. existing configuration
configuration: Configuration = ag.configurations.create(
    configuration_reference="...",
    configuration_slug="...",
)

# 2.b.i. existing configuration
configuration: Configuration = ag.configurations.create(
    configuration="...",
)

# 2.b.ii. existing configuration
configuration: Configuration = ag.configurations.create(
    configuration="...",
    configuration_slug="...",
)

##### FETCH #####

# 1. exisiting configuration
configuration: Configuration = ag.configurations.fetch(
    configuration_reference="...",
)

# 2. existing variant
configuration: Configuration = ag.configurations.fetch(
    variant_reference="...",
)

# 3. existing environment
configuration: Configuration = ag.configurations.fetch(
    environment_reference="...",
)

##### COMMIT #####

# 1.a. existing configuration
configuration: Configuration = ag.configurations.commit(
    configuration_reference="...",
)

# 1.b. existing configuration
configuration: Configuration = ag.configurations.commit(
    configuration="...",
)

# 2. new configuration
configuration: Configuration = ag.configurations.commit(
    configuration_slug="...",
    configuration_parameters="...",
)


########## VARIANTS ##########

##### CREATE #####

# 1.a.i. existing configuration
variant: Variant = ag.variants.create(
    variant_url="...",
    configuration_reference="...",
)

# 1.a.ii. existing configuration
variant: Variant = ag.variants.create(
    variant_url="...",
    configuration_reference="...",
    variant_slug="...",
)

# 1.b.i. existing configuration
variant: Variant = ag.variants.create(
    variant_url="...",
    configuration="...",
)

# 1.b.ii. existing configuration
variant: Variant = ag.variants.create(
    variant_url="...",
    configuration="...",
    variant_slug="...",
)

# 2.a.i. existing variant
variant: Variant = ag.variants.create(
    variant_reference="...",
)

# 2.a.ii. existing variant
variant: Variant = ag.variants.create(
    variant_reference="...",
    variant_slug="...",
)

# 2.b.i. existing variant
variant: Variant = ag.variants.create(
    variant="...",
)

# 2.b.ii. existing variant
variant: Variant = ag.variants.create(
    variant="...",
    variant_slug="...",
)

##### FETCH #####

# 1. existing variant
variant: Variant = ag.variants.fetch(
    variant_reference="...",
)

# 2. existing environment
variant: Variant = ag.variants.fetch(
    environment_reference="...",
)

##### COMMIT #####

# 1.a. existing variant
variant: Variant = ag.variants.commit(
    variant_reference="...",
)

# 1.b. existing variant
variant: Variant = ag.variants.commit(
    variant="...",
)

# 2.a. existing configuration
variant: Variant = ag.variants.commit(
    variant_slug="...",
    configuration_reference="...",
)

# 2.b. existing configuration
variant: Variant = ag.variants.commit(
    variant_slug="...",
    configuration="...",
)

# 3. new variant url
variant: Variant = ag.variants.commit(
    variant_slug="...",
    variant_url="...",
)

########## ENVIRONMENTS ##########

ag.environments = EnvironmentsClient(...)

##### CREATE #####

# 1.a.i. existing variant
environment: Environment = ag.prompts.deploy(
    variant_reference="...",
)

# 1.a.ii. existing variant
environment: Environment = ag.prompts.deploy(
    variant_reference="...",
    environment_slug="...",
)

# 1.b.i. existing variant
environment: Environment = ag.prompts.deploy(
    variant="...",
)

# 1.b.ii. existing variant
environment: Environment = ag.prompts.deploy(
    variant="...",
    environment_slug="...",
)

# 2.a.i. existing environment
environment: Environment = ag.prompts.deploy(
    environment_reference="...",
)

# 2.a.ii. existing environment
environment: Environment = ag.prompts.deploy(
    environment_reference="...",
    environment_slug="...",
)

# 2.b.i. existing environment
environment: Environment = ag.prompts.deploy(
    environment="...",
)

# 2.b.ii. existing environment
environment: Environment = ag.prompts.deploy(
    environment="...",
    environment_slug="...",
)

##### FETCH #####

# 1. existing environment
environment: Environment = ag.environments.fetch(
    environment_reference="...",
)

##### DEPLOY #####

# 1.a. existing variant
environment: Environment = ag.prompts.deploy(
    variant_reference="...",
)

# 1.b. existing variant
environment: Environment = ag.prompts.deploy(
    variant="...",
)

# 2.a. existing environment
environment: Environment = ag.prompts.deploy(
    environment_slug="...",
    environment_reference="...",
)

# 2.b. existing environment
environment: Environment = ag.prompts.deploy(
    environment_slug="...",
    environment="...",
)


########## PROMPTS ##########

##### CREATE #####

# 1.a.i. new prompt
prompt: Prompt = ag.prompts.create(
    parameters="...",
)

# 1.a.ii. new prompt
prompt: Prompt = ag.prompts.create(
    parameters="...",
    slug="...",
)

# 1.a.iii. new prompt
prompt: Prompt = ag.prompts.create(
    parameters="...",
    slug="...",
    application_slug="...",
)

# 1.a.iv. new prompt
prompt: Prompt = ag.prompts.create(
    parameters="...",
    slug="...",
    application_slug="...",
    template_key="...",
)

# 2.a.i. existing prompt
prompt: Prompt = ag.prompts.create(
    prompt_reference="...",
)

# 2.a.ii. existing prompt
prompt: Prompt = ag.prompts.create(
    prompt_reference="...",
    slug="...",
)

# 2.b.i. existing prompt
prompt: Prompt = ag.prompts.create(
    prompt="...",
)

# 2.b.ii. existing prompt
prompt: Prompt = ag.prompts.create(
    prompt="...",
    slug="...",
)

##### FETCH #####

# 1. existing prompt
prompt: Prompt = ag.prompts.fetch(
    prompt_reference="...",
)

# 2. existing environment
prompt: Prompt = ag.prompts.fetch(
    environment_slug="...",
)

##### DEPLOY #####

# 1.a. existing environment
environment: Environment = ag.prompts.deploy(
    prompt_reference="...",
    environment_slug="...",
)

# 1.b. existing environment
environment: Environment = ag.prompts.deploy(
    prompt="...",
    environment_slug="...",
)

# 2.a. new environment
environment: Environment = ag.prompts.deploy(
    prompt_reference="...",
)

# 2.b. new environment
environment: Environment = ag.prompts.deploy(
    prompt="...",
)

# 3.a. new environment
environment: Environment = ag.prompts.deploy(
    prompt_reference="...",
    environment_slug="...",
)

# 3.b. new environment
environment: Environment = ag.prompts.deploy(
    prompt="...",
    environment_slug="...",
)
