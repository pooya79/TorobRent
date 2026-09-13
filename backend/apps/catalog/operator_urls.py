from django.urls import path

from .operator_views import (
    CatalogCurationPropertySearchView,
    GroupedPropertyDetailView,
    GroupedPropertyListView,
    PropertyComparisonView,
    PropertyMatchApproveView,
    PropertyMatchClaimView,
    PropertyMatchDecisionView,
    PropertyMatchImageView,
    PropertyMatchSuggestionDetailView,
    PropertyMatchSuggestionListView,
    PropertyMatchSuggestionRejectView,
    PropertyMatchSuggestionSnoozeView,
)

app_name = "operator-catalog-curation"

urlpatterns = [
    path("grouped-properties/", GroupedPropertyListView.as_view(), name="grouped-properties"),
    path(
        "grouped-properties/<uuid:property_id>/",
        GroupedPropertyDetailView.as_view(),
        name="grouped-property-detail",
    ),
    path("suggestions/", PropertyMatchSuggestionListView.as_view(), name="suggestions"),
    path(
        "suggestions/<uuid:suggestion_id>/",
        PropertyMatchSuggestionDetailView.as_view(),
        name="suggestion-detail",
    ),
    path(
        "suggestions/<uuid:suggestion_id>/reject/",
        PropertyMatchSuggestionRejectView.as_view(),
        name="suggestion-reject",
    ),
    path(
        "suggestions/<uuid:suggestion_id>/snooze/",
        PropertyMatchSuggestionSnoozeView.as_view(),
        name="suggestion-snooze",
    ),
    path("approve/", PropertyMatchApproveView.as_view(), name="approve"),
    path("decisions/<uuid:decision_id>/", PropertyMatchDecisionView.as_view(), name="decision"),
    path("images/<uuid:image_id>/", PropertyMatchImageView.as_view(), name="image"),
    path("claim/", PropertyMatchClaimView.as_view(), name="claim"),
    path("properties/", CatalogCurationPropertySearchView.as_view(), name="property-search"),
    path("comparison/", PropertyComparisonView.as_view(), name="comparison"),
]
