# Voice-Triggered Armor Inspection

## Goal

Keep the original Jarvis helmet as the normal desktop appearance. When the user says “检查一下战甲” after waking Jarvis, show the full Iron Man model and let the user disperse and reassemble its named body regions with local hand gestures. Saying “结束检查” returns to the original helmet.

## User Experience

- Normal startup shows the original helmet image; the full-body model remains loaded but hidden.
- After wake, the exact voice command “检查一下战甲” is intercepted locally and does not start a Codex task. Wake and command may arrive in the same recognized utterance.
- Entering inspection displays the full model and starts video-only hand tracking. Windows owns camera permission; a denial leaves the full model visible and offers retry through the existing gesture button.
- The left hand selects one of three latched interaction modes by showing one, two, or three fingers. Every mode change first reassembles all armor, then announces “切换至模式 N”.
- Mode 1 uses the 47 source meshes as small fragments: an open right hand disperses them, horizontal hand movement rotates the scattered model, and a fist reassembles them.
- Mode 2 moves the source meshes as seven named groups (head, chest, abdomen, left/right arms, and left/right legs). An open right hand separates these groups in a tidy, repeatable arrangement; horizontal hand movement rotates the model, and a fist reassembles it.
- Mode 3 lets the right index finger move selection one adjacent part up, down, left, or right in screen space. Bending the index finger confirms the highlighted part; pinching thumb and index finger drags it; an open palm disperses that part's small meshes and a fist reassembles them. The left hand can rotate the selected part horizontally, and further index gestures can select another part.
- The selected mode-3 part has a clearly visible colored silhouette outline and a part-name label. The outline follows selection changes and remains visible while dragging.
- Bringing both hands together reassembles the entire armor from any mode. Tracking loss preserves the current model state and selection.
- While inspection is active, “结束检查” is recognized as a local exit command without requiring another wake phrase. It stops camera tracks immediately, restores the assembled state, hides the full model, and shows the original helmet.
- Existing gesture-button behavior remains available for retry, and the assistant's microphone, text commands, wake animation, and Codex approvals keep their existing roles.

## Architecture

- Electron main recognizes the enter command after wake and the exit command whenever inspection is active, then emits typed renderer signals instead of forwarding either command to Codex.
- The renderer owns the inspection-mode transition, fallback-image visibility, camera lifecycle, and gesture target.
- `HelmetScene` keeps the loaded MK46 model hidden until inspection starts, preserves all 47 source meshes, and supports both individual-fragment animation and seven parent-group animations.
- The gesture controller uses handedness to route left-hand mode selection/rotation separately from right-hand part selection and manipulation. Selection navigation uses the screen-projected positions of the seven named groups.
- Selection feedback outlines the active group and displays its name; hand tracking loss retains the active group and current transforms.
- Gesture-camera startup failure does not cancel inspection mode; the full model remains visible and the existing button can retry.
- Leaving inspection is idempotent and always stops camera tracks before restoring the fallback helmet.

## Validation

- Unit tests cover command normalization/matching and inspection enter/exit state transitions.
- Unit tests verify mode switching always assembles before switching and emits the matching spoken mode announcement.
- Gesture tests cover handedness routing, directional group selection, bend-to-confirm, pinch dragging, mode-specific palm/fist behavior, two-hand reset, and tracking loss.
- Electron visual checks verify all 47 source meshes remain present, the seven groups can separate and reassemble, and mode-3 selection outline and label follow the active group.
- Existing inspection tests continue to cover camera permission failure, exit behavior, and track cleanup.
