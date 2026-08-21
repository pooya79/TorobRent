from typing import Any

from rest_framework import serializers


class HealthSerializer(serializers.Serializer[Any]):
    status = serializers.ChoiceField(choices=["ok", "unavailable"])
