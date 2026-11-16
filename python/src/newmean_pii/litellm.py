"""LiteLLM: the newmean-pii models as a guardrail that masks personal information inside the proxy process.

No extra service to run (the model is a C extension in this package). In the proxy's config.yaml:

    guardrails:
      - guardrail_name: "newmean-pii"
        litellm_params:
          guardrail: newmean_pii.litellm.NewmeanPIIGuardrail
          mode: "pre_call"        # mask the request before it is sent to the LLM
          size: "medium"          # optional, as are labels, sensitivity, redact_mode, model_dir, ...

and requests opt in with ``"guardrails": ["newmean-pii"]`` (or set ``default_on: true``). With ``mode: "post_call"`` the
response is masked instead. Masked values are not restored in the response.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Any, Iterable, List, Optional

from litellm.integrations.custom_guardrail import CustomGuardrail

from ._redactor import Redactor, create_redactor

__all__ = ["NewmeanPIIGuardrail"]


class NewmeanPIIGuardrail(CustomGuardrail):
    """Masks PII in every text of a request or response (``[PERSON]``, ``[PHONE]``, ...).

    ``redact_mode`` is the ``mode`` of ``Redactor.redact`` ("tag", "mask" or "blank"; LiteLLM's own ``mode`` is the
    guardrail event). ``redactor`` takes one you already have; otherwise ``size``, ``variant``, ``labels`` and the
    remaining ``create_redactor`` options (sensitivity, regex, allow, block, model_dir, cache_dir, model_url, ...) build
    one on the first request. Everything else goes to LiteLLM's ``CustomGuardrail``.
    """

    _OPTIONS = (
        "sensitivity", "regex", "keep_emoji", "whole_words", "strict_short_names", "allow", "block", "lists_id",
        "model_dir", "cache_dir", "model_url",
    )

    def __init__(
        self,
        size: str = "medium",
        variant: Optional[str] = None,
        labels: Optional[Iterable[str]] = None,
        redact_mode: str = "tag",
        redactor: Optional[Redactor] = None,
        **kwargs: Any,
    ) -> None:
        if redact_mode not in ("tag", "mask", "blank"):
            raise ValueError(f'redact_mode must be "tag", "mask" or "blank", not {redact_mode!r}')
        options = {k: kwargs.pop(k) for k in self._OPTIONS if k in kwargs}
        if labels is not None:
            options["labels"] = list(labels)
        self._args = (size, variant)
        self._options = options
        self._redact_mode = redact_mode
        self._redactor = redactor
        self._lock = threading.Lock()
        super().__init__(**kwargs)

    def _get(self) -> Redactor:
        if self._redactor is None:
            with self._lock:
                if self._redactor is None:
                    self._redactor = create_redactor(*self._args, **self._options)
        return self._redactor

    def _mask(self, texts: List[str]) -> List[str]:
        redactor = self._get()
        return [redactor.redact(t, mode=self._redact_mode).text if isinstance(t, str) and t else t for t in texts]

    async def apply_guardrail(self, inputs: Any, request_data: dict, input_type: Any, logging_obj: Any = None) -> Any:
        texts = inputs.get("texts")
        if texts:
            # the model releases the GIL, so a worker thread keeps the proxy's event loop free
            inputs["texts"] = await asyncio.to_thread(self._mask, list(texts))
        return inputs
