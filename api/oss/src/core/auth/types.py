"""Core authentication types (OSS)."""

from enum import Enum


class MethodKind(str, Enum):
    """
    Valid authentication method patterns.

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

    @classmethod
    def matches_pattern(cls, identity: str, allowed_pattern: str) -> bool:
        """
        Check if an identity matches an allowed pattern.

        Args:
            identity: Authentication method (e.g., "email:otp", "social:google")
            allowed_pattern: Pattern to match against (supports wildcards)

        Returns:
            True if identity matches the pattern

        Examples:
            matches_pattern("email:otp", "email:*") → True
            matches_pattern("social:google", "social:*") → True
            matches_pattern("sso:acme:okta", "sso:acme:*") → True
            matches_pattern("email:otp", "sso:*") → False
        """
        # Exact match
        if identity == allowed_pattern:
            return True

        # Wildcard match
        if allowed_pattern.endswith(":*"):
            prefix = allowed_pattern[:-2]  # Remove ":*"
            if identity.startswith(f"{prefix}:"):
                return True

        return False
