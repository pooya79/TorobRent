import uuid
from enum import StrEnum

DEVELOPMENT_SEED_NAMESPACE = uuid.UUID("f8482aec-b7b0-4b43-92bd-a63b27e46619")


class DevelopmentFixtureKind(StrEnum):
    SOURCE = "source"
    PROPERTY = "property"
    TERMS = "terms"
    LISTING = "listing"
    SUBMISSION = "submission"
    SUBMISSION_EVENT = "submission-event"


def development_fixture_id(kind: DevelopmentFixtureKind, index: int) -> uuid.UUID:
    return uuid.uuid5(DEVELOPMENT_SEED_NAMESPACE, f"{kind}:{index}")
