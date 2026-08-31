from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import PhoneVerificationChallenge, User


@pytest.fixture(autouse=True)
def clear_account_throttles():
    cache.clear()


def csrf_client(api_client: APIClient) -> APIClient:
    response = api_client.get("/api/v1/auth/session/")
    api_client.credentials(HTTP_X_CSRFTOKEN=response.data["csrf_token"])
    return api_client


@pytest.mark.django_db
def test_user_manager_normalizes_email_and_hashes_password():
    user = get_user_model().objects.create_user("PERSON@EXAMPLE.COM", "secret-password")
    assert user.email == "person@example.com"
    assert user.check_password("secret-password")
    assert user.username is None
    assert user.is_submitter is False


@pytest.mark.django_db
def test_session_issues_csrf_token(api_client: APIClient):
    response = api_client.get("/api/v1/auth/session/")
    assert response.status_code == 200
    assert response.data["authenticated"] is False
    assert response.data["csrf_token"]
    assert "csrftoken" in response.cookies
    assert response["Cache-Control"] == "max-age=0, no-cache, no-store, must-revalidate, private"


@pytest.mark.django_db
def test_current_user_requires_authentication(api_client: APIClient):
    response = api_client.get("/api/v1/users/me/")
    assert response.status_code == 401
    assert response.data["code"] == "not_authenticated"
    assert response.data["request_id"] == response["X-Request-ID"]


@pytest.mark.django_db
def test_current_user_returns_authenticated_user(api_client: APIClient, user):
    api_client.force_authenticate(user=user)
    response = api_client.get("/api/v1/users/me/")
    assert response.status_code == 200
    assert response.data["email"] == "person@example.com"


@pytest.mark.django_db
def test_session_reports_authenticated_session(api_client: APIClient, user):
    api_client.force_login(user)
    response = api_client.get("/api/v1/auth/session/")
    assert response.status_code == 200
    assert response.data["authenticated"] is True


@pytest.mark.django_db
def test_submitter_registers_and_verifies_email(api_client: APIClient):
    response = csrf_client(api_client).post(
        "/api/v1/auth/register/",
        {"identifier": "NEW@example.com", "password": "correct-horse-battery"},
        format="json",
    )

    assert response.status_code == 201
    assert response.data == {
        "detail": "حساب ساخته شد. برای تأیید ایمیل، پیام ارسال‌شده را بررسی کنید."
    }
    user = User.objects.get(email="new@example.com")
    assert user.is_submitter is True
    assert user.email_verified_at is None
    assert len(mail.outbox) == 1
    token = mail.outbox[0].body.rsplit("/verify-email?token=", 1)[1].strip()

    unverified_login = api_client.post(
        "/api/v1/auth/login/",
        {"identifier": "new@example.com", "password": "correct-horse-battery"},
        format="json",
    )
    assert unverified_login.status_code == 401

    verify_response = api_client.post("/api/v1/auth/verify-email/", {"token": token}, format="json")

    assert verify_response.status_code == 200
    assert verify_response.data == {"detail": "ایمیل شما تأیید شد. اکنون می‌توانید وارد شوید."}
    user.refresh_from_db()
    assert user.email_verified_at is not None

    reused_response = api_client.post("/api/v1/auth/verify-email/", {"token": token}, format="json")
    assert reused_response.status_code == 400
    assert "نامعتبر" in reused_response.data["errors"]["token"][0]["message"]


@override_settings(DEMO_OTP_DISCLOSURE=True)
@pytest.mark.django_db
def test_phone_registration_requires_otp_before_normalized_identifier_can_log_in(
    api_client: APIClient,
):
    client = csrf_client(api_client)

    registration = client.post(
        "/api/v1/auth/register/",
        {"identifier": "+98 912 345 6789", "password": "correct-horse-battery"},
        format="json",
    )

    assert registration.status_code == 201
    assert registration.data["detail"] == "کد تأیید برای شماره تلفن ارسال شد."
    assert registration.data["demo_otp"].isdigit()
    assert len(registration.data["demo_otp"]) == 6
    user = User.objects.get(phone="09123456789")
    assert user.email is None
    assert user.phone_verified_at is None

    unverified_login = client.post(
        "/api/v1/auth/login/",
        {"identifier": "09123456789", "password": "correct-horse-battery"},
        format="json",
    )
    assert unverified_login.status_code == 401

    verification = client.post(
        "/api/v1/auth/verify-phone/",
        {"identifier": "۰۹۱۲۳۴۵۶۷۸۹", "otp": registration.data["demo_otp"]},
        format="json",
    )
    assert verification.status_code == 200
    user.refresh_from_db()
    assert user.phone_verified_at is not None

    reused = client.post(
        "/api/v1/auth/verify-phone/",
        {"identifier": "09123456789", "otp": registration.data["demo_otp"]},
        format="json",
    )
    assert reused.status_code == 400

    login = client.post(
        "/api/v1/auth/login/",
        {"identifier": "+989123456789", "password": "correct-horse-battery"},
        format="json",
    )
    assert login.status_code == 200
    assert login.data["phone"] == "09123456789"
    assert login.data["phone_verified"] is True


@pytest.mark.django_db
def test_phone_otp_requests_are_private_and_enforce_the_resend_delay(api_client: APIClient):
    client = csrf_client(api_client)
    User.objects.create_user(phone="09123456789", password="correct-horse-battery")
    expected = {"detail": "اگر شماره قابل تأیید باشد، کد تأیید ارسال می‌شود."}

    first = client.post(
        "/api/v1/auth/phone-verification/request/",
        {"identifier": "+989123456789"},
        format="json",
    )
    missing = client.post(
        "/api/v1/auth/phone-verification/request/",
        {"identifier": "09999999999"},
        format="json",
    )
    delayed = client.post(
        "/api/v1/auth/phone-verification/request/",
        {"identifier": "09123456789"},
        format="json",
    )

    assert first.status_code == missing.status_code == delayed.status_code == 202
    assert first.data == missing.data == delayed.data == expected
    assert User.objects.get(phone="09123456789").phone_challenges.count() == 1


@override_settings(DEMO_OTP_DISCLOSURE=True)
@pytest.mark.django_db
def test_phone_otp_reports_expiry_and_attempt_exhaustion(api_client: APIClient):
    client = csrf_client(api_client)
    expired_registration = client.post(
        "/api/v1/auth/register/",
        {"identifier": "09123456789", "password": "correct-horse-battery"},
        format="json",
    )
    expired_otp = expired_registration.data["demo_otp"]
    PhoneVerificationChallenge.objects.filter(phone="09123456789").update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )

    expired = client.post(
        "/api/v1/auth/verify-phone/",
        {"identifier": "09123456789", "otp": expired_otp},
        format="json",
    )
    assert expired.status_code == 400
    assert expired.data["errors"]["otp"][0]["message"] == (
        "اعتبار کد تمام شده است. کد تازه‌ای درخواست کنید."
    )

    attempts_registration = client.post(
        "/api/v1/auth/register/",
        {"identifier": "09351234567", "password": "correct-horse-battery"},
        format="json",
    )
    wrong_otp = "999999" if attempts_registration.data["demo_otp"] == "000000" else "000000"
    for _ in range(5):
        invalid = client.post(
            "/api/v1/auth/verify-phone/",
            {"identifier": "09351234567", "otp": wrong_otp},
            format="json",
        )
        assert invalid.status_code == 400

    exhausted = client.post(
        "/api/v1/auth/verify-phone/",
        {"identifier": "09351234567", "otp": attempts_registration.data["demo_otp"]},
        format="json",
    )
    assert exhausted.data["errors"]["otp"][0]["message"] == (
        "تعداد تلاش‌ها بیش از حد مجاز است. کد تازه‌ای درخواست کنید."
    )


@override_settings(DEMO_OTP_DISCLOSURE=True)
@pytest.mark.django_db
def test_verified_email_account_can_add_phone_and_use_both_identifiers(
    api_client: APIClient, user: User
):
    user.email_verified_at = timezone.now()
    user.save(update_fields=["email_verified_at"])
    client = csrf_client(api_client)
    client.force_login(user)

    requested = client.post(
        "/api/v1/auth/phone-verification/request/",
        {"identifier": "+98 935 123 4567"},
        format="json",
    )
    assert requested.status_code == 202
    assert requested.data["demo_otp"].isdigit()

    verified = client.post(
        "/api/v1/auth/verify-phone/",
        {"identifier": "09351234567", "otp": requested.data["demo_otp"]},
        format="json",
    )
    assert verified.status_code == 200

    client.logout()
    for identifier in ("person@example.com", "09351234567"):
        csrf_client(client)
        login = client.post(
            "/api/v1/auth/login/",
            {"identifier": identifier, "password": "correct-horse-battery"},
            format="json",
        )
        assert login.status_code == 200
        client.logout()


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("endpoint", "email", "is_submitter"),
    [
        ("/api/v1/auth/register/", "simple-submitter@example.com", True),
        ("/api/v1/auth/renter-register/", "simple-renter@example.com", False),
    ],
)
def test_demo_registration_accepts_a_simple_password(
    api_client: APIClient, endpoint: str, email: str, is_submitter: bool
):
    response = csrf_client(api_client).post(
        endpoint,
        {"identifier": email, "password": "123"},
        format="json",
    )

    assert response.status_code == 201
    user = User.objects.get(email=email)
    assert user.check_password("123")
    assert user.is_submitter is is_submitter


@pytest.mark.django_db
def test_renter_registers_without_submitter_status_and_waits_for_verification(
    api_client: APIClient,
):
    client = csrf_client(api_client)

    response = client.post(
        "/api/v1/auth/renter-register/",
        {"identifier": "RENTER@example.com", "password": "correct-horse-battery"},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["detail"].startswith("حساب ساخته شد")
    renter = User.objects.get(email="renter@example.com")
    assert renter.is_submitter is False
    assert client.get("/api/v1/auth/session/").data["authenticated"] is False
    assert client.get("/api/v1/users/me/").status_code == 401


@pytest.mark.django_db
def test_registration_requires_csrf(api_client: APIClient):
    response = api_client.post(
        "/api/v1/auth/register/",
        {"email": "new@example.com", "password": "correct-horse-battery"},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_submitter_logs_in_and_logs_out_with_same_origin_session(api_client: APIClient, user: User):
    user.email_verified_at = user.date_joined
    user.save(update_fields=["email_verified_at"])
    client = csrf_client(api_client)

    login_response = client.post(
        "/api/v1/auth/login/",
        {"identifier": "PERSON@example.com", "password": "correct-horse-battery"},
        format="json",
    )

    assert login_response.status_code == 200
    assert login_response.data["email"] == "person@example.com"
    assert login_response.data["email_verified"] is True
    assert csrf_client(client).get("/api/v1/auth/session/").data["authenticated"] is True
    assert client.get("/api/v1/users/me/").status_code == 200

    logout_response = client.post("/api/v1/auth/logout/", format="json")

    assert logout_response.status_code == 200
    assert logout_response.data == {"detail": "با موفقیت خارج شدید."}
    assert client.get("/api/v1/auth/session/").data["authenticated"] is False


@pytest.mark.django_db
def test_login_requires_csrf(api_client: APIClient, user: User):
    response = api_client.post(
        "/api/v1/auth/login/",
        {"email": user.email, "password": "correct-horse-battery"},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_password_recovery_is_private_and_reset_token_is_one_time(
    api_client: APIClient, user: User
):
    client = csrf_client(api_client)
    expected = {"detail": "اگر حسابی با این ایمیل وجود داشته باشد، پیوند بازیابی ارسال می‌شود."}

    missing_response = client.post(
        "/api/v1/auth/password-reset/", {"email": "missing@example.com"}, format="json"
    )
    existing_response = client.post(
        "/api/v1/auth/password-reset/", {"email": user.email}, format="json"
    )

    assert missing_response.status_code == existing_response.status_code == 202
    assert missing_response.data == existing_response.data == expected
    assert len(mail.outbox) == 1
    token = mail.outbox[0].body.rsplit("/reset-password?token=", 1)[1].strip()

    reset_response = client.post(
        "/api/v1/auth/password-reset/confirm/",
        {"token": token, "new_password": "password"},
        format="json",
    )

    assert reset_response.status_code == 200
    user.refresh_from_db()
    assert user.check_password("password")

    reused_response = client.post(
        "/api/v1/auth/password-reset/confirm/",
        {"token": token, "new_password": "yet-another-correct-password"},
        format="json",
    )
    assert reused_response.status_code == 400
    assert reused_response.data["errors"]["token"][0]["message"] == (
        "پیوند بازیابی نامعتبر است یا اعتبار آن تمام شده است."
    )


@pytest.mark.django_db
def test_malformed_and_expired_tokens_have_safe_persian_errors(api_client: APIClient, user: User):
    client = csrf_client(api_client)
    malformed_verification = client.post(
        "/api/v1/auth/verify-email/", {"token": "not-a-token"}, format="json"
    )
    malformed_reset = client.post(
        "/api/v1/auth/password-reset/confirm/",
        {"token": "not-a-token", "new_password": "a-new-correct-horse-battery"},
        format="json",
    )

    assert malformed_verification.status_code == malformed_reset.status_code == 400
    assert "نامعتبر" in malformed_verification.data["errors"]["token"][0]["message"]
    assert "نامعتبر" in malformed_reset.data["errors"]["token"][0]["message"]
    assert "نامعتبر" in malformed_verification.data["detail"]
    assert "نامعتبر" in malformed_reset.data["detail"]

    client.post("/api/v1/auth/password-reset/", {"email": user.email}, format="json")
    token = mail.outbox[0].body.rsplit("/reset-password?token=", 1)[1].strip()
    with override_settings(PASSWORD_RESET_TIMEOUT=-1):
        expired_reset = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"token": token, "new_password": "a-new-correct-horse-battery"},
            format="json",
        )
    assert expired_reset.status_code == 400
    assert "اعتبار آن تمام" in expired_reset.data["errors"]["token"][0]["message"]


@pytest.mark.django_db
@pytest.mark.parametrize("token_body", [{}, {"token": ""}, {"token": None}])
def test_missing_blank_and_null_tokens_have_persian_errors(
    api_client: APIClient, token_body: dict[str, str | None]
):
    client = csrf_client(api_client)

    verification = client.post("/api/v1/auth/verify-email/", token_body, format="json")
    reset = client.post(
        "/api/v1/auth/password-reset/confirm/",
        {**token_body, "new_password": "a-new-correct-horse-battery"},
        format="json",
    )

    assert verification.status_code == reset.status_code == 400
    assert verification.data["errors"]["token"][0]["message"] == "پیوند ناقص است."
    assert reset.data["errors"]["token"][0]["message"] == "پیوند ناقص است."


@pytest.mark.django_db
def test_expired_verification_token_has_safe_persian_error(api_client: APIClient):
    client = csrf_client(api_client)
    client.post(
        "/api/v1/auth/register/",
        {"identifier": "new@example.com", "password": "correct-horse-battery"},
        format="json",
    )
    token = mail.outbox[0].body.rsplit("/verify-email?token=", 1)[1].strip()

    with override_settings(EMAIL_VERIFICATION_TIMEOUT=-1):
        response = client.post("/api/v1/auth/verify-email/", {"token": token}, format="json")

    assert response.status_code == 400
    assert "اعتبار آن تمام" in response.data["errors"]["token"][0]["message"]


@pytest.mark.django_db
def test_login_is_throttled(api_client: APIClient):
    cache.clear()
    client = csrf_client(api_client)
    credentials = {"identifier": "missing@example.com", "password": "incorrect-password"}

    for _ in range(10):
        assert client.post("/api/v1/auth/login/", credentials, format="json").status_code == 401
    throttled = client.post("/api/v1/auth/login/", credentials, format="json")

    assert throttled.status_code == 429
    assert throttled.data["code"] == "throttled"


@pytest.mark.django_db
def test_phone_otp_request_and_verification_are_throttled(api_client: APIClient):
    client = csrf_client(api_client)

    for index in range(5):
        response = client.post(
            "/api/v1/auth/phone-verification/request/",
            {"identifier": f"0912000000{index}"},
            format="json",
        )
        assert response.status_code == 202
    assert (
        client.post(
            "/api/v1/auth/phone-verification/request/",
            {"identifier": "09120000005"},
            format="json",
        ).status_code
        == 429
    )

    cache.clear()
    for _ in range(20):
        response = client.post(
            "/api/v1/auth/verify-phone/",
            {"identifier": "09120000000", "otp": "000000"},
            format="json",
        )
        assert response.status_code == 400
    assert (
        client.post(
            "/api/v1/auth/verify-phone/",
            {"identifier": "09120000000", "otp": "000000"},
            format="json",
        ).status_code
        == 429
    )


@pytest.mark.skipif(connection.vendor != "postgresql", reason="PostgreSQL locking behavior")
@pytest.mark.django_db(transaction=True)
def test_verification_token_succeeds_only_once_under_concurrent_use():
    registration_client = csrf_client(APIClient(enforce_csrf_checks=True))
    registration_client.post(
        "/api/v1/auth/register/",
        {"identifier": "concurrent@example.com", "password": "correct-horse-battery"},
        format="json",
    )
    token = mail.outbox[0].body.rsplit("/verify-email?token=", 1)[1].strip()
    clients = [csrf_client(APIClient(enforce_csrf_checks=True)) for _ in range(8)]
    barrier = Barrier(len(clients))

    def verify(client: APIClient) -> int:
        try:
            barrier.wait()
            return client.post(
                "/api/v1/auth/verify-email/", {"token": token}, format="json"
            ).status_code
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=len(clients)) as executor:
        statuses = list(executor.map(verify, clients))

    assert statuses.count(200) == 1
    assert statuses.count(400) == len(clients) - 1


@pytest.mark.skipif(connection.vendor != "postgresql", reason="PostgreSQL locking behavior")
@pytest.mark.django_db(transaction=True)
def test_password_reset_token_succeeds_only_once_under_concurrent_use(user: User):
    request_client = csrf_client(APIClient(enforce_csrf_checks=True))
    request_client.post("/api/v1/auth/password-reset/", {"email": user.email}, format="json")
    token = mail.outbox[0].body.rsplit("/reset-password?token=", 1)[1].strip()
    clients = [csrf_client(APIClient(enforce_csrf_checks=True)) for _ in range(8)]
    barrier = Barrier(len(clients))

    def reset(item: tuple[int, APIClient]) -> int:
        index, client = item
        try:
            barrier.wait()
            return client.post(
                "/api/v1/auth/password-reset/confirm/",
                {"token": token, "new_password": f"new-correct-horse-battery-{index}"},
                format="json",
            ).status_code
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=len(clients)) as executor:
        statuses = list(executor.map(reset, enumerate(clients)))

    assert statuses.count(200) == 1
    assert statuses.count(400) == len(clients) - 1
