# ApplyPilot visual autofill privacy

Visual autofill is an explicit fallback mode for pages whose human-readable labels cannot be reliably associated with DOM controls.

- The extension marks candidate controls with temporary `AP1`, `AP2`, ... badges.
- It scrolls through the active page and captures JPEG viewport segments in memory.
- Each segment is sent to the user-configured Responses API with `store: false`.
- Screenshots are never written to `chrome.storage`, IndexedDB, Cache Storage, downloads, the repository, or a local file.
- The in-memory screenshot variable is cleared immediately after each API request finishes.
- Temporary badges and attributes are removed, and the original scroll position is restored.
- The extension still applies strict Profile-path-to-label safety checks before writing values.
- The visual mode does not submit forms.

The API provider still receives and processes the screenshot during inference. Users should only enable visual mode when they accept sending the visible application-page content to their configured API provider.
