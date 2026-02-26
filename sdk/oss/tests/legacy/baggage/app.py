import agenta as ag

ag.init(config_fname="config.toml")

ag.config.default(
    flag=ag.BinaryParam(value=False),
)


@ag.route()
@ag.instrument()
def main(aloha: str = "Aloha") -> str:
    print(ag.ConfigManager.get_from_route())
    print(ag.SecretsManager.get_from_route())
    print(ag.config.flag)

    return aloha
