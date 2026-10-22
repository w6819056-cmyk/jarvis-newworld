# Windows wake visual parity

User confirmed the supplied 0.2.0 source as the visual reference. Preserve its cyan/amber palette, 19 armor shards, 3200ms materialization, energy rings and particle paths; correct migration defects rather than design a new effect. Work inline in the existing feature checkout as requested.

- [x] Render the unchanged reference and Windows renderer at matching viewports; collect console errors, computed image/mask/shard styles and timed frames.
- [x] Reproduce visual differences before editing: changed window, avatar and aura geometry; no missing image resources or canvas errors in the renderer comparison.
- [x] Restore original layout and native window travel area. Preserve speech and Codex behavior.
- [x] Compare early/middle/late frames and assert rendered shards/canvas particles and complete timing. Existing 35 tests and both builds passed.
- [x] Install 0.2.3 and verify installed main/CSS. Native transparent window rendered 227 samples over 3.9 seconds with all 19 shards and 3200ms materialization. Restart normally; update archive and delivery notes.
