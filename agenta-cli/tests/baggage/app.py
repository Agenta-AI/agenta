import agenta as ag

ag.init(config_fname="config.toml")

ag.config.default(
    flag=ag.BinaryParam(value=False),
)

# XELnjVve.c1f177c87250b603cf1ed2a69ebdfc1cec3124776058e7afcbba93890c515e74


@ag.route()
@ag.instrument()
def main(aloha: str = "Aloha") -> str:

    print(ag.ConfigManager.get_from_route())
    print(ag.VaultManager.get_from_route())
    print(ag.config.flag)

    return aloha
