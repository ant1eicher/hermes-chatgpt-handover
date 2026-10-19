"""ChatGPT Handover — agent half.

Deliberately empty: the feature lives in `dashboard/plugin_api.py` (backend routes) and
`desktop/plugin.js` (the Desktop page). This file exists so `hermes plugins enable` recognises
the package and the dashboard's `plugins.enabled` gate admits the backend.
"""


def register(ctx):  # noqa: ARG001 — no tools, no hooks, by design
    return None
