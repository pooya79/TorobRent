from typing import Any

from rest_framework import serializers


class ProblemFieldErrorSerializer(serializers.Serializer[Any]):
    code = serializers.CharField()
    message = serializers.CharField()


class ProblemSerializer(serializers.Serializer[Any]):
    type = serializers.URLField()
    title = serializers.CharField()
    status = serializers.IntegerField()
    detail = serializers.CharField()
    code = serializers.CharField()
    request_id = serializers.UUIDField(allow_null=True)
    errors = serializers.DictField(  # type: ignore[assignment]
        child=serializers.ListField(child=ProblemFieldErrorSerializer()), required=False
    )
