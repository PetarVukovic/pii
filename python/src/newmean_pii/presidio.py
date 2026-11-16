"""Microsoft Presidio: the newmean-pii models as a recognizer for ``presidio-analyzer``.

    from presidio_analyzer import AnalyzerEngine
    from newmean_pii.presidio import NewmeanPIIRecognizer

    analyzer = AnalyzerEngine()
    analyzer.registry.add_recognizer(NewmeanPIIRecognizer())      # supported_language="en"
    analyzer.analyze("Call Kim Minsu on 010-1234-5678", language="en")

A Presidio recognizer serves one language, while the model reads 54: use ``recognizers(["en", "ko", "ja"])`` for one
recognizer per language that share a single model.
"""
from __future__ import annotations

import threading
from typing import Any, Dict, Iterable, List, Optional

from presidio_analyzer import AnalysisExplanation, EntityRecognizer, RecognizerResult

from ._redactor import Redactor, create_redactor

__all__ = ["ENTITY_MAPPING", "NewmeanPIIRecognizer", "recognizers"]

#: newmean-pii label -> Presidio entity. Presidio's own names where it has one; the level 2 labels fold into their level 1
#: entity. Override or extend with ``entity_mapping`` (a label mapped to None is not reported).
ENTITY_MAPPING: Dict[str, str] = {
    "PERSON": "PERSON",
    "PERSON_L2": "PERSON",
    "EMAIL": "EMAIL_ADDRESS",
    "PHONE": "PHONE_NUMBER",
    "ADDRESS": "LOCATION",
    "URL": "URL",
    "URL_L2": "URL",
    "ORG": "ORGANIZATION",
    "ID_NUMBER": "ID",
    "FINANCIAL": "FINANCIAL",
    "USERNAME": "USERNAME",
    "DATE_OF_BIRTH": "DATE_OF_BIRTH",
    "SECRET": "SECRET",
}


class _Shared:
    """One lazily created redactor for several recognizers."""

    def __init__(self, redactor: Optional[Redactor], options: Dict[str, Any]) -> None:
        self._redactor = redactor
        self._options = options
        self._lock = threading.Lock()

    def get(self) -> Redactor:
        if self._redactor is None:
            with self._lock:
                if self._redactor is None:
                    self._redactor = create_redactor(**self._options)
        return self._redactor


class NewmeanPIIRecognizer(EntityRecognizer):
    """Reports the model's spans as Presidio results.

    ``score`` is the confidence given to every result (the model returns spans, not scores; move the model's own threshold
    with ``sensitivity``). ``redactor`` takes one you already have; otherwise ``options`` are those of
    ``create_redactor`` (size, sensitivity, allow, block, model_dir, ...) and the model is loaded on the first text.
    """

    def __init__(
        self,
        supported_language: str = "en",
        *,
        redactor: Optional[Redactor] = None,
        score: float = 0.85,
        entity_mapping: Optional[Dict[str, Optional[str]]] = None,
        name: str = "NewmeanPIIRecognizer",
        _shared: Optional[_Shared] = None,
        **options: Any,
    ) -> None:
        if redactor is not None and options:
            raise TypeError("pass either a redactor or create_redactor options, not both")
        if not 0.0 <= score <= 1.0:
            raise ValueError("score must be between 0 and 1")
        mapping: Dict[str, Optional[str]] = dict(ENTITY_MAPPING)
        mapping.update(entity_mapping or {})
        self._mapping = {label: entity for label, entity in mapping.items() if entity}
        self._score = float(score)
        self._shared = _shared or _Shared(redactor, options)
        super().__init__(
            supported_entities=sorted(set(self._mapping.values())),
            name=name,
            supported_language=supported_language,
        )

    def load(self) -> None:
        """Nothing here: the model is loaded on the first text, so building a registry stays cheap."""

    def analyze(self, text: str, entities: Optional[List[str]] = None, nlp_artifacts: Any = None) -> List[RecognizerResult]:
        if not text:
            return []
        wanted = None if not entities else set(entities)
        results = []
        for span in self._shared.get().detect(text):
            entity = self._mapping.get(span.label)
            if entity is None or (wanted is not None and entity not in wanted):
                continue
            explanation = AnalysisExplanation(
                recognizer=self.name,
                original_score=self._score,
                textual_explanation=f"newmean-pii label {span.label} (source {span.source})",
            )
            results.append(RecognizerResult(entity, span.start, span.end, self._score, explanation))
        return results


def recognizers(languages: Iterable[str] = ("en",), **kwargs: Any) -> List[NewmeanPIIRecognizer]:
    """One recognizer per language code, all on one model: ``for r in recognizers(["en", "ko"]): registry.add_recognizer(r)``.

    ``kwargs`` are those of ``NewmeanPIIRecognizer`` (redactor, score, entity_mapping or create_redactor options).
    """
    redactor = kwargs.pop("redactor", None)
    recognizer_keys = ("score", "entity_mapping", "name")
    own = {k: kwargs.pop(k) for k in recognizer_keys if k in kwargs}
    if redactor is not None and kwargs:
        raise TypeError("pass either a redactor or create_redactor options, not both")
    shared = _Shared(redactor, kwargs)
    return [NewmeanPIIRecognizer(language, _shared=shared, **own) for language in languages]
