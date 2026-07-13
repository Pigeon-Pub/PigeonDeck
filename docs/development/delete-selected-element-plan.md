# Delete Selected Element Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the element represented by either PigeonDeck selection box with `Delete`, while preserving editable controls and supporting undo/redo.

**Architecture:** Put the keyboard behavior in the existing shared `SelectionBox`. The history command retains the detached DOM node, its insertion anchors, and its optional annotation snapshot.

**Tech Stack:** TypeScript, DOM APIs, Vitest, jsdom

## Global Constraints

- Only `Delete` triggers element deletion; `Backspace` remains unchanged.
- Ignore events from `input`, `textarea`, `select`, and `contenteditable` targets.
- Do not add confirmation UI, settings, dependencies, or unrelated refactors.

---

### Task 1: Selection Box Delete Command

**Files:**
- Create: `src/content/selection-box.test.ts`
- Modify: `src/content/selection-box.ts`

**Interfaces:**
- Consumes: `SelectionBox.select(el)`, `History.undo()`, `History.redo()`, `AnnotationStore.getBySelector()`, `AnnotationStore.remove()`, `AnnotationStore.restore()`.
- Produces: internal `SelectionBox.onKeyDown(event: KeyboardEvent): void` behavior; no new public API.

- [x] **Step 1: Write failing behavior tests**

Create a real `SelectionBox` with a jsdom page element and overlay. Select the element, dispatch `Delete`, and assert the element and selection box are removed. Add assertions that `history.undo()` restores the original sibling order and matching annotation, `history.redo()` removes both again, editable targets ignore `Delete`, and `Backspace` is ignored.

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/content/selection-box.test.ts`

Expected: FAIL because `SelectionBox` does not yet react to `Delete`.

- [x] **Step 3: Implement the minimal command**

In `SelectionBox`, register a window capture-phase `keydown` listener in the constructor and remove it in `destroy()`. For `Delete`, require a connected selected element and a non-editable event target. Capture `parentNode`, `nextSibling`, selector, and matching annotation; clear selection; remove the element and annotation; then push one `delete:element` history command whose `revert` restores the original DOM position and annotation and whose `apply` removes them again.

- [x] **Step 4: Verify GREEN and project gates**

Run:

```text
npx vitest run src/content/selection-box.test.ts
npm run typecheck
npm test
```

Expected: all commands exit 0 with no test failures.

- [x] **Step 5: Review the diff**

Run: `git diff --check` and inspect `git diff -- src/content/selection-box.ts src/content/selection-box.test.ts` to confirm every production change traces to the approved behavior.
