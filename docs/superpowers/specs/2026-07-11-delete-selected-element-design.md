# Delete Selected Element Design

## Goal

When PigeonDeck shows an element selection box, pressing `Delete` removes that page element. The operation participates in the existing history so undo restores the element and redo removes it again.

## Scope

- Applies to selection boxes owned by both move mode and the annotation panel.
- Responds only to the `Delete` key. `Backspace` remains unchanged.
- Does not run while the keyboard event originates from `input`, `textarea`, `select`, or a `contenteditable` element.
- Does not add a confirmation dialog, setting, or configurable shortcut.

## Design

`SelectionBox` owns the behavior because both supported selection flows already use it. Each instance installs one `keydown` listener and removes it during `destroy()`.

On `Delete`, `SelectionBox` verifies that a selected element exists, remains connected, and the event target is not editable. It then captures the element's parent and next sibling, clears the selection box, removes the selected element from the DOM, and removes the annotation whose selector identifies that element, if present.

The history command stores the detached element, its original parent, its next sibling, and the optional annotation snapshot:

- `apply`: remove the element and annotation.
- `revert`: insert the element before its original next sibling when that sibling is still under the original parent; otherwise append it to the original parent. Restore the annotation snapshot.

Undo does not automatically reselect the restored element.

## Interaction Priority

Existing `Esc`, submit, and global undo/redo behavior remains unchanged. Editable-focus protection ensures `Delete` continues to edit text normally in annotation notes, region notes, inline rich text, media URL inputs, copy-text previews, and other editable controls.

## Tests

Unit tests for `SelectionBox` will verify:

1. `Delete` removes a selected element and clears its selection box.
2. Undo restores the element at its original sibling position; redo removes it again.
3. A matching annotation is removed and restored with history.
4. `Delete` is ignored when the event target is editable.
5. `Backspace` does not delete the selected element.

The existing typecheck and test suite must remain green.
