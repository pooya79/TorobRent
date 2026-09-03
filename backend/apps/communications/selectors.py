from django.db.models import QuerySet

from apps.accounts.models import User

from .models import MessageKind, SystemNotification


def system_notifications_for(
    recipient: User, *, kind: str = "all", unread: bool = False
) -> QuerySet[SystemNotification]:
    notifications = SystemNotification.objects.filter(recipient=recipient).select_related(
        "originating_event__submission",
        "originating_source_proposal_event__proposal",
    )
    if kind not in ("all", MessageKind.SYSTEM_NOTIFICATION):
        return notifications.none()
    if unread:
        notifications = notifications.filter(read_state__isnull=True)
    return notifications
