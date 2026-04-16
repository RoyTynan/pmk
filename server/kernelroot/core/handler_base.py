"""
HandlerBase — base class for all direct-call handlers.

A handler receives an input string and optional options dict, performs its
work, and returns a result string. Handlers are called directly by the
kernel API server for synchronous requests, and by schedulers for
queue-based task dispatch.

Raise an exception to signal failure — callers catch it and handle accordingly.
"""


class HandlerBase:
    def handle(self, input: str, options: dict | None = None) -> str:
        raise NotImplementedError(f"{self.__class__.__name__} must implement handle()")
