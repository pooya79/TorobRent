from collections.abc import Callable, Mapping
from typing import Any, overload

@overload
def display[**P, R](function: Callable[P, R]) -> Callable[P, R]: ...
@overload
def display[**P, R](
    function: None = ...,
    *,
    boolean: bool | None = ...,
    admin_order_field: str | None = ...,
    ordering: str | None = ...,
    description: str | None = ...,
    empty_value: str | None = ...,
    label: bool | Mapping[Any, str] | None = ...,
    header: bool | None = ...,
    dropdown: bool | None = ...,
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...
