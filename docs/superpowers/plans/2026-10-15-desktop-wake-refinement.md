# Compact desktop assistant and screen-wide wake

The user's latest brief supersedes exact 0.2.0 geometry. Keep the cyan helmet and armor assembly, but make the helmet small, controls compact and always discoverable, particles fewer and smooth, and wake origins span the current display.

Use one transparent display-sized window with a centered 300px helmet and 380px controls. Preserve normal desktop access through native click-through outside visible controls, helmet and open dialogs. Show above other apps briefly during wake, then restore the normal window level. A display change updates bounds. No exclusive fullscreen, no taskbar change.

Limit particles to 320, sample only the image bounds, cache trajectories, batch canvas paths, fade out into the solid helmet, stop particle work when idle, and remove animated blur/filter from armor pieces. Use a 2800ms formation with a short fading tail. Keep voice and Codex behavior.

- [x] Capture failing layout/animation checks for compact avatar, visible settings, narrow command bar, particle bound and fade-out.
- [x] Add display-sized bounds, bounded click-through IPC and temporary wake foreground handling.
- [x] Implement compact controls and optimized particle crossfade.
- [x] Verify buttons/dialogs, native click-through calls, frame timing and display canvas dimensions; run existing regression tests and builds.
- [x] Install 0.2.4 and return to the real microphone. Delivery source and notes updated.

Evidence: 300px helmet, 280px input, settings opacity 1; actual native window/display 1536×960. Installed wake-only fake audio reached listening→speaking→listening without a Codex task. 625 rAF samples over 3.9s: max gap 29.9ms, crossover 8.3ms, none over 50ms. This is a measured synthetic run, not a guarantee of human wake accuracy or all-load smoothness. Inline review used because the user requested no subagents.


## 0.2.5 user-directed refinement

The latest request supersedes the 300px/320-particle/always-visible choices: use a 420px maximum helmet, original 530px-wide reference sampling at 7px/82% (about 3600 particles), a 4200ms formation, and controls hidden until explicit helmet activation. Repeated click collapses, closes history and returns focus to the helmet. Hidden controls must not capture desktop clicks. Voice activation and hover do not expand UI; required approval dialogs remain functional. Preserve existing performance optimizations and validate the denser animation in the installed app. No extra approval or subagents needed for these user-directed choices.

Checks: updated Electron regression first failed on the 300px helmet. New build measures 420px, toolbar opacity 0, about 3624 particles plus two energy-ring arcs, 4200ms materialization, correct click toggle, final empty canvas, and 800×600 fit. Windows 27 and original 8 tests pass.

Installed 0.2.5: bounds match 1536×960 display; real native click-through calls and expand/collapse pass. Wake-only synthetic input exercised recognizer and native acknowledgment without a Codex task. 567 frame samples over 5.3s: max gap 30ms, crossover max 16.3ms, none over 50ms. Installer exit 0; backend, preload and renderer bytes match the build. Restored normal startup and real microphone after diagnostics.


## 0.2.6 spacing refinement

User asked for a slightly larger helmet and more space around buttons and input. Raise the maximum helmet height 420→480px, retain short-display scaling, expand the toolbar to 420px with 16px gaps, footer to 440px with 24px gaps and 300px input. Increase toolbar-to-helmet clearance to 40px and footer offset to 84px. Replace the unwanted focus outline with a helmet glow, preserving keyboard focus indication. Keep click-to-reveal and existing 4.2s dense-particle animation. Verify built layout, collapse/expand, small display fit and installed package without running another audio diagnostic. Installed inspection additionally caught Windows clamping the initial window height to the work area (936px instead of 960px, taskbar at the top). Reapplying bounds restored 960px; production startup now reapplies display bounds after showing the window. Verify the actual installed startup rather than weakening the full-monitor assertion.

Verified 0.2.6 production layout: 480px helmet, 300px input, 40px toolbar clearance, 84px footer offset, 24px button gaps. Default collapse, click toggle, no focus outline, settings and 800×600 fit passed; screenshots inspected. Installed final startup has monitor bounds 1536×960 without diagnostic correction; native mouse handling and expand/collapse passed. Installer exit 0; installed backend/renderer bytes match. Restored normal startup; no new audio diagnostics needed for this refinement.

## 0.2.7 wake audibility follow-up

Investigated the latest report: the ASR worker needs a complete assistant-name transcript, while the Windows capture chain used raw mic samples despite device-specific gain variation. Added a capped, smoothed worklet gain for quiet speech (target RMS .06, max 3x, ignore near-silence, soft limiting). Updated Electron fake-microphone regression to attenuate the real fixture to 25%; production renderer, AudioWorklet, contextBridge and Sherpa model still return final "嗨贾维斯打开浏览器搜索今天的天气". Peak .913 and no samples above .975. This tests amplitude robustness, not room noise/SNR or a person's mic. Windows 27 and original 8 suites pass. Package as 0.2.7 and verify installed build. Newly read skill: [systematic-debugging.md](C:/Users/Kevin/.codex/skills/systematic-debugging/SKILL.md).

## 0.2.8 original working/approval response

Compared the original CSS: working mode switches `--rgb` to amber, giving the helmet and scan amber light; approval has a distinct attention gesture. The Windows port had a fixed cyan helmet filter and disabled rig animation. Added a restrained 2.6s thinking sway plus amber glow/scan, and a separate short approval nod, keyed by renderer `data-status`. Regression failed before implementation on animation:none and passes afterward. Production screenshots and installed renderer tests confirm amber glow and both state animations. Windows 27, original 8 pass; installed 0.2.8 setup exit 0. Updated user guide and test notes.
