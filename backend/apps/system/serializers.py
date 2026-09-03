from typing import Any

from rest_framework import serializers


class HealthSerializer(serializers.Serializer[Any]):
    status = serializers.ChoiceField(choices=["ok", "unavailable"])


class ContactDetailsSerializer(serializers.Serializer[Any]):
    phone = serializers.CharField(allow_null=True)
    address = serializers.CharField(allow_null=True)
    map_url = serializers.URLField(allow_null=True)
