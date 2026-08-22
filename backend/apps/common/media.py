from django.db import models


class MediaVariantKind(models.TextChoices):
    SMALL = "small", "کوچک"
    MEDIUM = "medium", "متوسط"
    LARGE = "large", "بزرگ"
