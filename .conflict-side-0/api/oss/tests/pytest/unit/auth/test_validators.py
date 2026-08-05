"""
Unit tests for oss.src.utils.validators.

Covers:
- _SPECIAL_CHARS does not include backslash (Warning fix)
- _SPECIAL_CHARS matches the frontend regex character class
- validate_password enforces the configured policy
"""

import pytest


# ---------------------------------------------------------------------------
# _SPECIAL_CHARS
# ---------------------------------------------------------------------------


class TestSpecialChars:
    def test_backslash_not_in_special_chars(self):
        """
        _SPECIAL_CHARS was previously built from a raw string r"...\\-...\\[...]"
        which injected literal backslashes into the frozenset.  After the fix it
        must not contain backslash.
        """
        from oss.src.utils.validators import _SPECIAL_CHARS

        assert "\\" not in _SPECIAL_CHARS, (
            "Backslash must not be a recognised special character — "
            "it is not accepted by the frontend regex validator"
        )

    def test_expected_chars_present(self):
        from oss.src.utils.validators import _SPECIAL_CHARS

        expected = set("!@#$%^&*()_+-=[]{}|;':\",./<>?")
        missing = expected - _SPECIAL_CHARS
        assert not missing, f"Missing special chars: {missing!r}"

    def test_no_duplicate_or_extra_regex_artifacts(self):
        from oss.src.utils.validators import _SPECIAL_CHARS

        # Raw-string escapes that used to leak into the set
        leaking = {r"\-", r"\[", r"\]", r"\""}
        for fragment in leaking:
            for ch in fragment:
                if ch == "\\":
                    assert ch not in _SPECIAL_CHARS, (
                        f"Unexpected backslash in _SPECIAL_CHARS (leaked from raw-string escape {fragment!r})"
                    )


# ---------------------------------------------------------------------------
# validate_password
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestValidatePassword:
    async def test_too_short_rejected(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="basic",
                        password_regex=None,
                    )
                },
            )(),
        )

        result = await validators.validate_password("short", "tenant")
        assert result is not None
        assert "8" in result

    async def test_min_length_accepted(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="basic",
                        password_regex=None,
                    )
                },
            )(),
        )

        result = await validators.validate_password("exactly8", "tenant")
        assert result is None

    async def test_strong_policy_requires_uppercase(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="strong",
                        password_regex=None,
                    )
                },
            )(),
        )

        result = await validators.validate_password("alllower1!", "tenant")
        assert result is not None
        assert "uppercase" in result.lower()

    async def test_strong_policy_requires_digit(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="strong",
                        password_regex=None,
                    )
                },
            )(),
        )

        result = await validators.validate_password("NoDigitHere!", "tenant")
        assert result is not None
        assert "digit" in result.lower()

    async def test_strong_policy_requires_special_char(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="strong",
                        password_regex=None,
                    )
                },
            )(),
        )

        result = await validators.validate_password("NoSpecial1", "tenant")
        assert result is not None
        assert "special" in result.lower()

    async def test_strong_policy_valid_password_accepted(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="strong",
                        password_regex=None,
                    )
                },
            )(),
        )

        result = await validators.validate_password("StrongPass1!", "tenant")
        assert result is None

    async def test_backslash_not_accepted_as_special_char(self, monkeypatch):
        """
        Before the _SPECIAL_CHARS fix a password like 'NoBackSlash1\\'
        would pass the special-char check on the backend but fail on the frontend.
        After the fix it must fail the backend check too.
        """
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="strong",
                        password_regex=None,
                    )
                },
            )(),
        )

        # Backslash is the only "special" character here — should fail
        result = await validators.validate_password("NoSpec1al\\", "tenant")
        assert result is not None, (
            "Backslash alone must not satisfy the special-character requirement"
        )

    async def test_custom_regex_takes_precedence(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="strong",
                        password_regex=r"^PIN\d{4}$",
                    )
                },
            )(),
        )

        assert await validators.validate_password("PIN1234", "tenant") is None
        assert await validators.validate_password("PIN123", "tenant") is not None
        assert await validators.validate_password("StrongPass1!", "tenant") is not None

    async def test_none_policy_skips_validation(self, monkeypatch):
        from oss.src.utils import validators
        from oss.src.utils.env import SuperTokensConfig

        monkeypatch.setattr(
            "oss.src.utils.env.env",
            type(
                "env",
                (),
                {
                    "supertokens": SuperTokensConfig(
                        password_min_length=8,
                        password_max_length=None,
                        password_policy="none",
                        password_regex=None,
                    )
                },
            )(),
        )

        result = await validators.validate_password("x", "tenant")
        assert result is None
