from typing import Any

from rest_framework.pagination import PageNumberPagination


class StandardPageNumberPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["count", "results"],
            "properties": {
                "count": {"type": "integer", "example": 123},
                "next": {
                    "type": ["string", "null"],
                    "format": "uri",
                    "example": "http://api.example.org/properties/?page=2",
                },
                "previous": {
                    "type": ["string", "null"],
                    "format": "uri",
                    "example": "http://api.example.org/properties/?page=1",
                },
                "results": schema,
            },
        }
