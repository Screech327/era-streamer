# Design sandboxes

Standalone design-preview pages used while iterating on overlay styles
(player-card banners, goal popups, boost backdrops, now-watching cards).

They are NOT part of the shipped app — no server route serves them and the
electron-builder `files` glob only bundles `overlay/`, `src/`, `ui/`. Open them
directly in a browser to compare style variants. Kept for reference.
