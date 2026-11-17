/**
 * Sample posts shared by the specs. The -spec.ts suffix keeps this file out of
 * the production build (tsconfig excludes *spec.ts) without Jest running it.
 */

/** A curated breakdown that follows every rule in post-rules.ts. */
export const CURATED_POST = `**UI logic is moving out of the framework.**

A recent breakdown on DEV by some_user walks through a cross-framework engine: the widget's state lives in a pure TypeScript state machine, and React, Vue and Svelte each get a thin adapter.

- The core has no framework imports, so one test suite covers every adapter.
- Each adapter only subscribes to state and forwards events, which keeps it small in the author's example.
- The cost is a second mental model: contributors need to know the machine and the framework bindings.
- It is the wrong call for a single-framework app, where the indirection buys nothing.

My read: this pays off once a design system has to ship to more than one framework, and not a day earlier. I'd want to see how the adapters handle server rendering before betting a component library on it.

Which part of a component library would be hardest to pull out of the framework first?`;

export const CURATED_HOOK = 'UI logic is moving out of the framework.';

/** The failure this gate exists for: a third-party article retold as the poster's own story. */
export const FABRICATED_POST = `**We slashed our component churn by 70%.**

When we first tried to share a motion-rich widget across React, Vue and Svelte, every fix had to be made three times.

- We pulled the state into a pure TypeScript state machine.
- We called it the Core Vanilla Engine.
- Our adapters shrank to a few lines each.
- The trade-off is a second mental model for new contributors on the project.

The breakthrough came when the team stopped treating the framework as the place where logic lives. Each adapter now only subscribes to state and forwards events, and one test suite covers all three of them. That single change removed most of the duplicated code and made motion bugs reproducible outside the browser for the first time.

Which part of a component library would be hardest to pull out of the framework first?`;

export const FABRICATED_HOOK = 'We slashed our component churn by 70%.';
