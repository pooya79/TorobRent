from typing import Any
from uuid import UUID

from rest_framework import serializers

from .exclusions import matches
from .models import SourceExceptionAttempt, SourceExclusion, SourceExtractionException


class SourceExceptionAttemptSerializer(serializers.ModelSerializer[SourceExceptionAttempt]):
    class Meta:
        model = SourceExceptionAttempt
        fields = ("run", "attempt", "attempted_at", "state", "problem", "detail", "is_current")
        read_only_fields = fields


class SourceExtractionExceptionSerializer(serializers.ModelSerializer[SourceExtractionException]):
    history = SourceExceptionAttemptSerializer(many=True, read_only=True)
    state = serializers.SerializerMethodField()
    exclusion_reason = serializers.SerializerMethodField()

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.active_rules: dict[UUID, list[SourceExclusion]] = {}

    def exclusion(self, exception: SourceExtractionException) -> SourceExclusion | None:
        if exception.source_id not in self.active_rules:
            self.active_rules[exception.source_id] = [
                rule
                for rule in exception.source.exclusions.prefetch_related("actions")
                if not any(action.action == "remove" for action in rule.actions.all())
            ]
        return next(
            (
                rule
                for rule in self.active_rules[exception.source_id]
                if matches(
                    domain=exception.source.domain,
                    kind=rule.kind,
                    pattern=rule.url,
                    url=exception.canonical_url,
                )
            ),
            None,
        )

    def get_state(self, exception: SourceExtractionException) -> str:
        return "excluded" if self.exclusion(exception) else exception.state

    def get_exclusion_reason(self, exception: SourceExtractionException) -> str:
        rule = self.exclusion(exception)
        return rule.reason if rule else ""

    class Meta:
        model = SourceExtractionException
        fields = (
            "id",
            "canonical_url",
            "first_occurrence",
            "state",
            "problem",
            "detail",
            "last_run",
            "last_attempt",
            "last_attempt_at",
            "history",
            "exclusion_reason",
        )
        read_only_fields = fields


class SourceExceptionRetrySerializer(serializers.Serializer[dict[str, object]]):
    exception_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1, max_length=20
    )
