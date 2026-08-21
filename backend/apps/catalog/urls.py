from django.urls import path

from .views import PropertyDetailView

app_name = "catalog"

urlpatterns = [
    path("properties/<uuid:property_id>/", PropertyDetailView.as_view(), name="property-detail"),
]
