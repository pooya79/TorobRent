from typing import TypeVar

from django.contrib import admin
from django.db.models import Model

_ModelT = TypeVar("_ModelT", bound=Model)
_ParentModelT = TypeVar("_ParentModelT", bound=Model)

class ModelAdmin(admin.ModelAdmin[_ModelT]):
    warn_unsaved_form: bool

class TabularInline(admin.TabularInline[_ModelT, _ParentModelT]): ...
