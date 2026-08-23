from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.views import PUBLIC_MUTATION_ERRORS

from .serializers import ContactMessageCreatedSerializer, ContactMessageCreateSerializer


@method_decorator(csrf_protect, name="dispatch")
class ContactMessageCreateView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "contact"

    @extend_schema(
        summary="Send a message to TorobRent Operators",
        request=ContactMessageCreateSerializer,
        responses={
            201: ContactMessageCreatedSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = ContactMessageCreateSerializer(
            data=request.data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {"detail": "پیام شما ثبت شد و اپراتور آن را بررسی می‌کند."},
            status=status.HTTP_201_CREATED,
        )
