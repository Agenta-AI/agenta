from typing import Literal

Namespace = Literal[
    "data.inputs",
    "data.internals",
    "data.outputs",
    "metrics.scores",
    "metrics.marginal.costs",
    "metrics.marginal.tokens",
    "metadata.config",
    "metadata.version",
    "tags",
    "resource.project",
    "resource.experiment",
    "resource.application",
    "resource.configuration",
    "resource.service",
    "extra",
]

Status = Literal[
    "OK",
    "ERROR",
]
