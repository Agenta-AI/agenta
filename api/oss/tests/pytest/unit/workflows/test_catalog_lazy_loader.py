from oss.src.resources.workflows import catalog as workflow_catalog


def test_catalog_is_built_lazily_once_per_process(monkeypatch):
    original_catalog = workflow_catalog._catalog
    build_calls = 0

    def _fake_build_catalog():
        nonlocal build_calls
        build_calls += 1
        return [
            {
                "key": "demo",
                "name": "Demo",
                "description": "Demo",
                "categories": [],
                "flags": {},
                "data": {},
                "presets": [],
            }
        ]

    try:
        workflow_catalog._catalog = None
        monkeypatch.setattr(workflow_catalog, "_build_catalog", _fake_build_catalog)

        first = workflow_catalog.get_all_workflow_catalog_templates()
        second = workflow_catalog.get_all_workflow_catalog_templates()

        assert build_calls == 1
        assert first == second
        assert first is not second
    finally:
        workflow_catalog._catalog = original_catalog
