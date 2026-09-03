from typing import Any

from django.contrib.auth.forms import (
    AdminPasswordChangeForm as DjangoAdminPasswordChangeForm,
)
from django.contrib.auth.forms import UserChangeForm as DjangoUserChangeForm
from django.contrib.auth.forms import UserCreationForm as DjangoUserCreationForm

class AdminPasswordChangeForm(DjangoAdminPasswordChangeForm[Any]): ...
class UserChangeForm(DjangoUserChangeForm[Any]): ...
class UserCreationForm(DjangoUserCreationForm[Any]): ...
