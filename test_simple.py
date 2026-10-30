from agenta.sdk.utils.resolvers import resolve_json_selector

def test():
    data = {"key": "value"}
    assert resolve_json_selector("/summarize", {}) == "/summarize"
    assert resolve_json_selector("$100 bounty", {}) == "$100 bounty"
    assert resolve_json_selector("$.key", data) == "value"
    assert resolve_json_selector("/key", {"key": "value"}) == "value"
    print("All tests passed!")

if __name__ == "__main__":
    test()