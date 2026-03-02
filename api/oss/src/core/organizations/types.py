"""Core authentication method types (OSS)."""

from enum import Enum


# ============================================================================
# AUTHENTICATION METHOD KINDS
# ============================================================================


class MethodKind(str, Enum):
    """
    Valid authentication method patterns for organization policies.

    Supports exact matches and wildcards:
    - email:otp - Email OTP authentication
    - email:password - Email/password authentication (future)
    - email:* - Any email-based authentication
    - social:google - Google OAuth
    - social:github - GitHub OAuth
    - social:* - Any social provider
    - sso:{organization_slug}:{provider_slug} - Specific SSO provider for organization
    - sso:{organization_slug}:* - Any SSO provider for organization
    - sso:* - Any SSO provider (any organization)
    """

    EMAIL_OTP = "email:otp"
    EMAIL_PASSWORD = "email:password"
    EMAIL_WILDCARD = "email:*"
    SOCIAL_GOOGLE = "social:google"
    SOCIAL_GITHUB = "social:github"
    SOCIAL_WILDCARD = "social:*"
    SSO_WILDCARD = "sso:*"

    @classmethod
    def is_valid_pattern(cls, pattern: str) -> bool:
        """
        Check if a pattern is a valid method kind.

        Allows:
        - Exact enum values
        - SSO patterns: sso:{organization_slug}:{provider_slug} or sso:{organization_slug}:*
        """
        # Check if it's a known enum value
        if pattern in cls._value2member_map_:
            return True

        # Check SSO patterns
        if pattern.startswith("sso:"):
            parts = pattern.split(":")
            if len(parts) == 3:
                organization_slug, provider = parts[1], parts[2]
                # Validate organization_slug is not empty
                if organization_slug and (provider == "*" or provider):
                    return True

        return False
