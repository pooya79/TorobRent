import uuid
from enum import StrEnum

DEMO_NAMESPACE = uuid.UUID("f8482aec-b7b0-4b43-92bd-a63b27e46619")


class DemoFixtureKind(StrEnum):
    SOURCE = "source"
    PROPERTY = "property"
    TERMS = "terms"
    LISTING = "listing"
    SUBMISSION = "submission"
    SUBMISSION_EVENT = "submission-event"


def demo_id(kind: DemoFixtureKind, index: int) -> uuid.UUID:
    return uuid.uuid5(DEMO_NAMESPACE, f"{kind}:{index}")
