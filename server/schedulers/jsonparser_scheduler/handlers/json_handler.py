"""
JsonHandler — parses and validates JSON content.

Returns a JSON string with:
  - valid / invalid + parse error location
  - size: character count and estimated token count
  - depth: maximum nesting level
  - schema: recursive type tree (objects, arrays, primitives)
  - warnings: mixed array types, nulls, empty strings, empty containers
"""
import json

from schedulers.jsonparser_scheduler.handlers.base import FileHandlerBase


class JsonHandler(FileHandlerBase):
    def handle(self, input: str, options: dict | None = None) -> str:
        content = input
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            return json.dumps({
                "valid":  False,
                "error":  e.msg,
                "line":   e.lineno,
                "column": e.colno,
            })

        warnings: list[str] = []
        schema = self._schema_of(data, warnings, path="root")

        return json.dumps({
            "valid":    True,
            "type":     self._type_name(data),
            "size":     {"chars": len(content), "tokens": max(1, round(len(content) / 4))},
            "depth":    self._depth(data),
            "schema":   schema,
            "warnings": warnings,
        })

    # ------------------------------------------------------------------
    # Schema builder — returns a recursive description of the structure
    # Primitives  → type string e.g. "string", "boolean"
    # Objects     → {"_type": "object", "_keys": N, "_schema": {...}}
    # Arrays      → {"_type": "array",  "_items": N, "_element_type": "...",
    #                "_element_schema": {...}}   # only when items are objects
    # ------------------------------------------------------------------

    def _schema_of(self, data, warnings: list, path: str, depth: int = 0):
        if depth > 6:
            return "..."

        if isinstance(data, dict):
            if not data:
                warnings.append(f"Empty object at {path}")
                return {"_type": "object", "_keys": 0, "_schema": {}}
            schema = {
                k: self._schema_of(v, warnings, f"{path}.{k}", depth + 1)
                for k, v in data.items()
            }
            return {"_type": "object", "_keys": len(data), "_schema": schema}

        if isinstance(data, list):
            if not data:
                warnings.append(f"Empty array at {path}")
                return {"_type": "array", "_items": 0, "_element_type": "unknown"}
            types = list({self._type_name(i) for i in data})
            if len(types) > 1:
                warnings.append(
                    f"Mixed types in array at {path}: {', '.join(sorted(types))}"
                )
            element_type = types[0] if len(types) == 1 else "mixed"
            result: dict = {"_type": "array", "_items": len(data), "_element_type": element_type}
            if isinstance(data[0], (dict, list)):
                result["_element_schema"] = self._schema_of(
                    data[0], warnings, f"{path}[0]", depth + 1
                )
            return result

        # primitives
        if data is None:
            warnings.append(f"Null value at {path}")
            return "null"
        if isinstance(data, str) and data == "":
            warnings.append(f"Empty string at {path}")
        return self._type_name(data)

    # ------------------------------------------------------------------

    def _type_name(self, value) -> str:
        if value is None:          return "null"
        if isinstance(value, bool): return "boolean"
        if isinstance(value, int):  return "integer"
        if isinstance(value, float): return "float"
        if isinstance(value, str):  return "string"
        if isinstance(value, list): return "array"
        if isinstance(value, dict): return "object"
        return type(value).__name__

    def _depth(self, obj, current: int = 0) -> int:
        if isinstance(obj, dict):
            if not obj:
                return current + 1
            return max(self._depth(v, current + 1) for v in obj.values())
        if isinstance(obj, list):
            if not obj:
                return current + 1
            return max(self._depth(i, current + 1) for i in obj)
        return current
