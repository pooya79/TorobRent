from django.urls import path

from .views import (
    ListingContinuationView,
    ListingPhoneRevealView,
    LocationAutocompleteView,
    PropertyDetailView,
    PropertySearchView,
    PropertyViewEventView,
)

app_name = "catalog"

urlpatterns = [
    path("locations/", LocationAutocompleteView.as_view(), name="location-autocomplete"),
    path("properties/", PropertySearchView.as_view(), name="property-search"),
    path("properties/<uuid:property_id>/", PropertyDetailView.as_view(), name="property-detail"),
    path(
        "properties/<uuid:property_id>/view/",
        PropertyViewEventView.as_view(),
        name="property-view-event",
    ),
    path(
        "listings/<uuid:listing_id>/phone-reveal/",
        ListingPhoneRevealView.as_view(),
        name="listing-phone-reveal",
    ),
    path(
        "listings/<uuid:listing_id>/continuation/",
        ListingContinuationView.as_view(),
        name="listing-continuation",
    ),
]
