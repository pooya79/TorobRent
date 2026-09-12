from django.urls import path

from .operator_views import CatalogCurationPropertySearchView, PropertyComparisonView

app_name = "operator-catalog-curation"

urlpatterns = [
    path("properties/", CatalogCurationPropertySearchView.as_view(), name="property-search"),
    path("comparison/", PropertyComparisonView.as_view(), name="comparison"),
]
