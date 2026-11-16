"""Langfuse: a ``mask`` function, so traces are stored without the personal information the model finds.

    from langfuse import Langfuse
    from newmean_pii.langfuse import pii_mask

    langfuse = Langfuse(mask=pii_mask(size="medium"))

Langfuse calls the function with the input, output and metadata of every observation before they are sent. Every string
inside them is masked (dict values and list items, at any depth); keys, numbers and other values are kept. This module
does not import langfuse: the function fits any code that takes ``mask(*, data, **kwargs)``.
"""
from __future__ import annotations

import threading
from typing import Any, Callable, List, Optional

from ._redactor import Redactor, create_redactor

__all__ = ["pii_mask"]


def pii_mask(redactor: Optional[Redactor] = None, *, mode: str = "tag", **options: Any) -> Callable[..., Any]:
    """A function ``mask(*, data, **kwargs) -> data`` with every string in ``data`` masked.

    ``mode`` is that of ``Redactor.redact`` ("tag" gives ``[EMAIL]``, "mask" asterisks, "blank" removes). Pass a
    ``redactor`` you already have, or ``options`` for ``create_redactor`` (size, sensitivity, labels, allow, block,
    model_dir, ...); without a redactor the model is loaded on the first call, not here.
    """
    if redactor is not None and options:
        raise TypeError("pass either a redactor or create_redactor options, not both")
    if mode not in ("tag", "mask", "blank"):
        raise ValueError(f'mode must be "tag", "mask" or "blank", not {mode!r}')
    lock = threading.Lock()
    holder: List[Redactor] = [] if redactor is None else [redactor]

    def get() -> Redactor:
        if not holder:
            with lock:
                if not holder:
                    holder.append(create_redactor(**options))
        return holder[0]

    def walk(value: Any) -> Any:
        if isinstance(value, str):
            return get().redact(value, mode=mode).text if value else value
        if isinstance(value, dict):
            return {k: walk(v) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(v) for v in value]
        if isinstance(value, tuple):
            return tuple(walk(v) for v in value)
        return value

    def mask(*, data: Any, **kwargs: Any) -> Any:
        return walk(data)

    return mask
