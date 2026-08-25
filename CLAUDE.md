# Code style: imperative & procedural

This codebase follows an imperative-procedural style, inspired by Handmade
Hero / Casey Muratori / Jonathan Blow. Not "no OOP, ever" — a strong default
toward plain data and free functions, with encapsulation used only when it's
actually earning its keep.

- **Data and functions are separate.** A function takes the data it operates
  on as its first argument: `pushCall(tracker, call)`, not `tracker.push(call)`.
  Prefer plain interfaces over classes for anything that's just "a bag of
  fields plus some operations on them."
- **State stays visible.** Module-level `let`s and plain mutable objects are
  fine — often preferable to hiding state behind private class fields. Don't
  reach for encapsulation as a reflex; reach for it when there's a real
  invariant to protect.
- **Classes are fine when they're genuinely the right shape** — a public API
  meant to be instantiated (e.g. `new WGD.Debugger()`, deliberately mirroring
  an existing library's usage contract) or real multi-implementation
  polymorphism. Don't reflexively de-class those; ask first if unsure.
- **No ceremony**: no factories, no DI containers, no interfaces that exist
  for a single implementation, no builder chains where a plain function call
  would do.
- **Straight-line control flow** over cleverness — avoid decorators, Proxies,
  and metaprogramming unless the alternative is meaningfully worse.
- **Don't build for a future you're guessing at.** Solve the concrete problem
  in front of you. Three similar lines beat a shared helper used twice.
- **Small, obvious, verb-first functions** (`registerObject`, `findRedundantCalls`,
  `buildThumbnails`) over deep call chains or chained builder APIs.
- **Comments explain *why*, never *what***. Well-named code doesn't need narration.

Reference implementation: `packages/core` (recorder, state tracker, redundancy
detection) is the exemplar for this style — read it before writing new core code.
