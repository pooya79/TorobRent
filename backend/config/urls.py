from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/system/", include("apps.system.urls")),
    path("api/v1/auth/", include("apps.accounts.session_urls")),
    path("api/v1/catalog/", include("apps.catalog.urls")),
    path("api/v1/contact/", include("apps.contact.urls")),
    path("api/v1/source-proposals/", include("apps.source_proposals.urls")),
    path("api/v1/submissions/", include("apps.submissions.urls")),
    path("api/v1/operator/submissions/", include("apps.submissions.operator_urls")),
    path(
        "api/v1/operator/source-proposals/",
        include("apps.source_proposals.operator_urls"),
    ),
    path(
        "api/v1/operator/external-listing-candidates/",
        include("apps.source_proposals.external_candidate_urls"),
    ),
    path("api/v1/operator/support-requests/", include("apps.contact.operator_urls")),
    path("api/v1/users/", include("apps.accounts.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
]

if settings.DEBUG:
    urlpatterns.append(
        path(
            "api/docs/",
            SpectacularSwaggerView.as_view(url_name="schema"),
            name="swagger-ui",
        )
    )
