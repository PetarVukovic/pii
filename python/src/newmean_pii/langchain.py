"""LangChain: the newmean-pii models as a detector for ``PIIMiddleware`` (langchain >= 1.0).

    from langchain.agents import create_agent
    from newmean_pii.langchain import pii_middleware

    agent = create_agent("openai:gpt-6.1", middleware=[pii_middleware()])
    # "Call Kim Minsu on 010-1234-5678" reaches the model as "Call [REDACTED_PERSON] on [REDACTED_PHONE]"

``pii_detector`` needs no LangChain import: it returns plain dicts in the shape of LangChain's ``PIIMatch``
(``type``, ``value``, ``start``, ``end``), so it also fits any code that takes such a detector.
"""
from __future__ import annotations

import threading
from typing import Any, Callable, Dict, Iterable, List, Optional

from ._redactor import Redactor, create_redactor

__all__ = ["pii_detector", "pii_middleware"]

Detector = Callable[[str], List[Dict[str, Any]]]


def pii_detector(redactor: Optional[Redactor] = None, *, labels: Optional[Iterable[str]] = None, **options: Any) -> Detector:
    """A detector ``(text) -> [{"type", "value", "start", "end"}]`` for every label in one model call.

    ``type`` is the label in lower case ("person", "phone", "address", ...), which LangChain's "redact" strategy shows
    as ``[REDACTED_PERSON]``. Pass a ``redactor`` you already have, or ``options`` for ``create_redactor`` (size,
    sensitivity, allow, block, model_dir, ...); without a redactor the model is loaded on the first call, not here.
    ``labels`` limits the labels reported (with your own redactor too).
    """
    if redactor is not None and options:
        raise TypeError("pass either a redactor or create_redactor options, not both")
    wanted = None if labels is None else frozenset(labels)
    lock = threading.Lock()
    holder: List[Redactor] = [] if redactor is None else [redactor]

    def get() -> Redactor:
        if not holder:
            with lock:
                if not holder:
                    holder.append(create_redactor(labels=wanted, **options))
        return holder[0]

    def detect(text: str) -> List[Dict[str, Any]]:
        if not text:
            return []
        return [
            {"type": s.label.lower(), "value": text[s.start : s.end], "start": s.start, "end": s.end}
            for s in get().detect(text)
            if wanted is None or s.label in wanted
        ]

    return detect


def pii_middleware(
    redactor: Optional[Redactor] = None,
    *,
    strategy: str = "redact",
    apply_to_input: bool = True,
    apply_to_output: bool = False,
    apply_to_tool_results: bool = False,
    labels: Optional[Iterable[str]] = None,
    name: str = "pii",
    **options: Any,
) -> Any:
    """A ``PIIMiddleware`` that masks everything the model finds: one middleware and one model call per message.

    ``strategy`` and the ``apply_to_*`` flags are LangChain's ("redact", "mask", "hash" or "block"; input only by
    default). The other arguments are those of ``pii_detector``. ``name`` is the middleware's ``pii_type``, used in its
    name and in the error of the "block" strategy; give each instance its own when an agent has several.
    """
    try:
        from langchain.agents.middleware import PIIMiddleware
    except ImportError as e:  # pragma: no cover
        raise ImportError("pii_middleware needs langchain >= 1.0 (pip install langchain)") from e
    return PIIMiddleware(
        name,
        detector=pii_detector(redactor, labels=labels, **options),
        strategy=strategy,  # type: ignore[arg-type]
        apply_to_input=apply_to_input,
        apply_to_output=apply_to_output,
        apply_to_tool_results=apply_to_tool_results,
    )
