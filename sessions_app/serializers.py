from rest_framework import serializers


class AnonymousNameSerializer(serializers.Serializer):
    anonymous_name = serializers.CharField(max_length=64, trim_whitespace=True)

    def validate_anonymous_name(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Name must be at least 2 characters.")
        if len(value) > 64:
            raise serializers.ValidationError("Name must be at most 64 characters.")
        allowed = set(" -_'")
        if not all(c.isalnum() or c in allowed for c in value):
            raise serializers.ValidationError(
                "Use letters, numbers, spaces, hyphens, or apostrophes only."
            )
        return value
