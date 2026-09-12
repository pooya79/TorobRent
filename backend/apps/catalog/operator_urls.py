from django.urls import path

from .operator_views import (
    CatalogCurationPropertySearchView,
    PropertyComparisonView,
    PropertyMatchApproveView,
    PropertyMatchClaimView,
    PropertyMatchDecisionView,
    PropertyMatchImageView,
)

app_name = "operator-catalog-curation"

urlpatterns = [
    path("approve/", PropertyMatchApproveView.as_view(), name="approve"),
    path("decisions/<uuid:decision_id>/", PropertyMatchDecisionView.as_view(), name="decision"),
    path("images/<uuid:image_id>/", PropertyMatchImageView.as_view(), name="image"),
    path("claim/", PropertyMatchClaimView.as_view(), name="claim"),
    path("properties/", CatalogCurationPropertySearchView.as_view(), name="property-search"),
    path("comparison/", PropertyComparisonView.as_view(), name="comparison"),
]
