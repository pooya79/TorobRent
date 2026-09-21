import uuid
from enum import StrEnum

DEVELOPMENT_SEED_NAMESPACE = uuid.UUID("f8482aec-b7b0-4b43-92bd-a63b27e46619")


class DevelopmentFixtureKind(StrEnum):
    SOURCE = "source"
    SOURCE_PROPOSAL = "source-proposal"
    EXTERNAL_CANDIDATE = "external-candidate"
    EXTERNAL_CANDIDATE_EVENT = "external-candidate-event"
    PROPERTY = "property"
    TERMS = "terms"
    LISTING = "listing"
    LISTING_IMAGE = "listing-image"
    PROPERTY_IMAGE = "property-image"
    SUBMISSION = "submission"
    SUBMISSION_IMAGE = "submission-image"
    SUBMISSION_EVENT = "submission-event"
    LISTING_INQUIRY = "listing-inquiry"
    LISTING_INQUIRY_MESSAGE = "listing-inquiry-message"
    CONVERSATION_REPORT = "conversation-report"
    SYSTEM_NOTIFICATION = "system-notification"
    SUPPORT_REQUEST = "support-request"
    SUPPORT_MESSAGE = "support-message"
    SUPPORT_EVENT = "support-event"


def development_fixture_id(kind: DevelopmentFixtureKind, index: int) -> uuid.UUID:
    return uuid.uuid5(DEVELOPMENT_SEED_NAMESPACE, f"{kind}:{index}")
