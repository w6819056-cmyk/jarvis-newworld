# Jarvis–Mineradio Visual Preset Voice Design

## Goal

Allow the user to switch Mineradio's existing music visual presets by voice through Jarvis, either naming a preset or asking for a different random preset.

## User Experience

- After waking Jarvis, the user can say “切换到雨幕霓虹” or “把视觉效果换成月蚀圣环”. Jarvis selects that built-in preset in Mineradio.
- The user can say “帮我换一个音乐效果”. Mineradio selects one built-in preset other than the currently active preset.
- Mineradio's visual console continues to work as it does now. A voice selection uses the existing preset transition, active-card state, and playback-preset persistence.
- Jarvis reports the selected preset only after Mineradio confirms the action. Unknown preset names do not fall through as a preset action.

## Architecture

Jarvis parses final post-wake transcript text for an explicit preset-switch intent and a known preset name, or for the dedicated random-switch intent. It sends only a preset identifier or the random operation over the existing authenticated named pipe. The protocol adds a narrow `visual.set_preset` action with a validated built-in preset ID, plus a bounded random selection operation that excludes the active ID. Mineradio resolves the selected ID against its existing `presetMeta` list and calls its existing `setPreset` function. The response includes the resulting ID and display name.

Preset IDs follow Mineradio's existing `presetMeta` array: 0 Emily album cover, 1 roller, 2 planet, 3 void, 4 record, 5 galaxy, 6 requiem, 7 Sonic Topography, 8 Wallpaper Engine Sonic Topography, 9 Eclipse Halo, 10 Neon Drizzle, 11 Prism Flock, and 12 Abyssal Bloom. User archive slots are excluded because they are saved effect configurations, not stable named built-in presets.

## Error Handling

- A disconnected Mineradio uses the existing open/reconnect behavior before dispatch.
- Unknown names, invalid IDs, and unavailable preset runtime return an error and leave the current visual unchanged.
- The random action returns the selected preset name and never chooses the current preset when another built-in option exists.
- Voice commands run only after Jarvis's wake gate has extracted the command, and do not enter Codex conversation history.

## Testing and Acceptance

- Jarvis tests verify preset-name mapping, explicit switch-intent requirements, and the random intent; incidental mentions do not trigger visual changes.
- Jarvis protocol tests accept valid preset actions and reject invalid IDs or arbitrary payload fields.
- Mineradio action tests verify that a requested built-in ID calls `setPreset` and returns the confirmed name, while invalid IDs do not call it.
- Mineradio random selection tests verify the active preset is excluded and the returned ID/name match the applied preset.
- Windows acceptance verifies specific and random voice changes update the playing visualizer and its selected console card without interrupting playback.

## Constraints

- Keep the authenticated current-user named-pipe bridge and its action allowlist.
- Do not expose arbitrary JavaScript, DOM selectors, or generic renderer commands.
- Keep work local; do not push either project to a remote repository.
