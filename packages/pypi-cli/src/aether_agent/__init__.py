"""pip/pipx installer and launcher for the Aether Agent CLI.

Aether Agent itself is a Node program published to npm as ``aether-agents``. This package
is the Python front door to it: ``pipx install aether-agent`` gets you the same ``aether``
CLI without hand-rolling an npm global install, and every command you type is forwarded to
that CLI unchanged.

The version here tracks the npm package exactly, and is the version this launcher installs
by default.
"""

from __future__ import annotations

__version__ = "0.3.0"

#: The npm package this launcher installs and runs.
NPM_PACKAGE = "aether-agents"

__all__ = ["NPM_PACKAGE", "__version__"]
