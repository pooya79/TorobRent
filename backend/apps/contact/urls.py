from django.urls import path

from .views import ContactMessageCreateView

app_name = "contact"

urlpatterns = [path("messages/", ContactMessageCreateView.as_view(), name="message-create")]
