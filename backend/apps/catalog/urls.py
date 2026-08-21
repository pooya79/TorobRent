from django.urls import path

from .views import LocationAutocompleteView, PropertyDetailView, PropertySearchView

app_name = "catalog"

urlpatterns = [
    path("locations/", LocationAutocompleteView.as_view(), name="location-autocomplete"),
    path("properties/", PropertySearchView.as_view(), name="property-search"),
    path("properties/<uuid:property_id>/", PropertyDetailView.as_view(), name="property-detail"),
]
