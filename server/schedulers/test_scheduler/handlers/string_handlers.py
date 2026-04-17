"""
String manipulation handlers — BOILERPLATE to prove the scaffold works.
Replace or extend with your own handler logic.

Each handler receives input (str) and options (dict), returns a JSON string.
"""
import json

from schedulers.test_scheduler.handlers.base import TestHandlerBase


class RemoveAlternateWordsHandler(TestHandlerBase):
    """Removes every other word from the input string."""

    def handle(self, input: str, options: dict | None = None) -> str:
        words  = input.split()
        result = " ".join(words[i] for i in range(0, len(words), 2))
        return json.dumps({"input": input, "output": result})


class AddWordHandler(TestHandlerBase):
    """Appends a word to the end of the input string.
    Options: word (str) — word to append (default: 'hello')
    """

    def handle(self, input: str, options: dict | None = None) -> str:
        word   = (options or {}).get("word", "hello")
        result = f"{input} {word}"
        return json.dumps({"input": input, "output": result})


class DeleteWordHandler(TestHandlerBase):
    """Removes all occurrences of a word from the input string.
    Options: word (str) — word to remove
    """

    def handle(self, input: str, options: dict | None = None) -> str:
        word = (options or {}).get("word", "")
        if not word:
            return json.dumps({"input": input, "output": input, "warning": "no word specified"})
        result = " ".join(w for w in input.split() if w != word)
        return json.dumps({"input": input, "output": result})
