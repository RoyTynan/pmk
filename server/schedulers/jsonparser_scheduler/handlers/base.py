"""
FileHandlerBase — base class for all file handlers.
Extends HandlerBase with the same interface.

The input string is the content to process (e.g. raw JSON text).
The options dict carries any handler-specific parameters.

Raise an exception to signal failure — the scheduler and kernel API
both catch it and mark the operation as failed.
"""
from kernelroot.core.handler_base import HandlerBase


class FileHandlerBase(HandlerBase):
    pass
