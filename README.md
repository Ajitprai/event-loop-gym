# Event Loop Gym

**Predict the output. Then watch why.**

Event Loop Gym is an interactive trainer for the JavaScript event loop. You read a snippet, put its `console.log` outputs in the order you think they'll print, and the app checks you against real execution. Then you can step through the same code line by line and watch every callback move through the **call stack**, **Web APIs**, **microtask queue** and **macrotask queue**.

It's built for anyone who has ever been surprised by `setTimeout(fn, 0)`, `await`, or a promise chain in an interview, or in production.

> **Live app:** https://ajitprai.github.io/event-loop-gym/ *(available once the repository is published and GitHub Pages is enabled)*

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Quick start](#quick-start)
- [How to use it](#how-to-use-it)
- [The event loop in 60 seconds](#the-event-loop-in-60-seconds)
- [Puzzle library](#puzzle-library)
- [How it works](#how-it-works)
- [What step mode supports](#what-step-mode-supports)
- [Known limitations](#known-limitations)
- [Project structure](#project-structure)
- [Running tests](#running-tests)
- [Adding a puzzle](#adding-a-puzzle)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Why this exists

Most explanations of the event loop are either a static diagram or a single pre-recorded animation. Both are good for a first look, but understanding only sticks once you **predict, get it wrong, and see exactly where your mental model broke**.

Event Loop Gym is built around that loop:

1. **Predict:** order the outputs yourself.
2. **Check:** the answer comes from running the code for real, so it's always correct.
3. **Understand:** step through it and see which queue every callback went to, and when.
4. **Repeat:** move on to harder puzzles, or paste your own code.

## Features

### Practice mode
- **17 hand-picked puzzles** in four levels: Warm-up, Promises, async/await, and Interview.
- **Click-to-order prediction:** output chips are shuffled, and you click them in the order you expect.
- **Verified answers:** every answer is produced by executing the code in your browser, not by a hard-coded key.
- **Short "why" explanation** for each puzzle.
- **Progress tracking:** solved puzzles are remembered in your browser.

### Step-through visualizer
- **Current line highlighted** in the code.
- **Five live panels:** call stack, Web APIs (timers with their fire time), microtask queue, macrotask queue, and console.
- **Plain-English narration of every step**, for example *"await pauses demo() and pops it off the call stack. The awaited value is already ready, so resume demo() goes straight into the microtask queue."*
- **Change highlighting:** the panel that changed in the current step is outlined.
- **Phase indicator:** running sync code, draining microtasks, running a macrotask, or event loop checking.
- **Simulated clock** (`t = 0ms`, `t = 100ms`, …) so timer delays make sense.
- **Controls:** Back, Next, Play/Pause, three speeds, a scrubber, and keyboard shortcuts (`←` `→` `Space`).

### Playground
- **Write or paste your own code** in a code box with Tab indentation and `Ctrl/Cmd + Enter` to run.
- **Three modes:**
  - **Step through:** the full visualizer.
  - **Quiz me on this:** turns your own code into a prediction puzzle.
  - **Run and show:** real execution, with every log tagged as sync, microtask or macrotask.
- **Auto-saved:** your code is saved in your browser.

### Cheat sheet
- The one-rule summary of the event loop.
- Which API goes to which queue.
- The many names for the "event queue" (task queue, callback queue, macrotask queue, message queue).
- Node.js event loop phases and `process.nextTick` priority.
- A step-by-step method for solving any ordering puzzle, and common traps.

### Accessibility and theming
- Works with the keyboard alone, with visible focus states.
- Step narration is announced to screen readers through an `aria-live` region.
- Light and dark themes follow your system setting.
- Respects `prefers-reduced-motion`.

---

## Quick start

There is no build step. It's a static page.

```sh
git clone https://github.com/Ajitprai/event-loop-gym.git
cd event-loop-gym
npx serve .
```

Then open the URL that `serve` prints (usually `http://localhost:3000`).

Any static server works (`python3 -m http.server`, VS Code Live Server, and so on). Opening `index.html` directly from disk also works in most browsers.

**Requirements:** a modern browser. Node.js is only needed to run the tests.

---

## How to use it

### 1. Practice
1. Pick a puzzle from the sidebar.
2. Read the code and click the output chips in the order you think they print. Click a placed item to remove it.
3. Press **Check my order**. Correct positions turn green, wrong ones red.
4. Read the **Why**, then press **Step through it visually** to watch it happen.

### 2. Step through
- **Next →** / **← Back** to move one step at a time, or **Play** to auto-advance.
- Watch the **narration bar** first, then whichever panel is outlined.
- Use the **scrubber** to jump to any point.

### 3. Playground
Paste anything, for example:

```js
console.log('start');

setTimeout(() => console.log('timeout'), 0);

fetchLike().then((v) => console.log('got', v));

async function fetchLike() {
  console.log('fetching');
  await new Promise((r) => setTimeout(r, 50));
  return 'data';
}

queueMicrotask(() => console.log('micro'));
console.log('end');
```

Choose **Step through**, **Quiz me on this**, or **Run and show**.

---

## The event loop in 60 seconds

JavaScript runs on a **single call stack**. Async work is handed off and comes back through queues:

| Component | What it holds | Examples |
|---|---|---|
| **Call stack** | The code running right now | Your script, a function call |
| **Web APIs** | Work the browser does outside JS | Timers, `fetch`, DOM events |
| **Microtask queue** | High-priority callbacks | `.then/.catch/.finally`, code after `await`, `queueMicrotask` |
| **Macrotask queue** | One-per-turn callbacks | `setTimeout`, `setInterval`, I/O, UI events |
| **Event loop** | Decides what runs next | — |

The rule the event loop repeats forever:

```
run one macrotask        // the first one is your whole script
drain ALL microtasks     // including ones added while draining
render if needed         // browser only
repeat
```

Two facts that explain most "surprising" outputs:

1. **`setTimeout(fn, 0)` is never immediate.** It waits for the current script and every pending microtask.
2. **An `async` function runs synchronously until its first `await`.** Only the code after the `await` is deferred, as a microtask.

---

## Puzzle library

| Level | Puzzle | What it teaches |
|---|---|---|
| Warm-up | Sync, promise, timeout | The basic priority order |
| Warm-up | queueMicrotask vs then | One microtask queue, FIFO |
| Warm-up | Timer delays | Delay order, not line order |
| Warm-up | Promise executor is sync | `new Promise(fn)` runs `fn` immediately |
| Promises | Two chains interleave | Each `.then` waits one more turn |
| Promises | Microtask inside microtask | The queue drains completely |
| Promises | Microtask inside a timer | Microtasks run between macrotasks |
| Promises | async return value | Async functions always return a promise |
| Promises | Returning a promise from then | The two extra microtask hops |
| async / await | async body runs sync | Code before `await` is synchronous |
| async / await | await another async call | The awaited call starts immediately |
| async / await | Two awaits vs a then | Each `await` is its own microtask turn |
| async / await | await vs then chain | Interleaving `await` and `.then` |
| async / await | await in a loop | Loops and chains taking turns |
| Interview | Timers and promises nested | Queues feeding queues |
| Interview | The classic interview one | `async1` / `async2` / `promise1` |
| Interview | var in a timer loop | Closures plus the event loop |

---

## How it works

The app combines two independent engines and cross-checks them.

### 1. Real execution (the source of truth)
For Practice answers, **Quiz me** and **Run and show**, your code runs for real in the browser with these APIs replaced by instrumented versions:

- `console.log`, to capture output
- `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` and `queueMicrotask`, to tag what happens
- `Promise.prototype.then`, temporarily during the run, to know when a callback is a microtask

Real execution guarantees the **order** is always correct. It's capped at 4 seconds, so endless timers can't hang the page.

### 2. The simulator (`sim.js`, for step-through)
Real JavaScript can't be paused between lines and inspected. The step-through therefore uses a **small JavaScript interpreter**:

- **Parsing:** the [acorn](https://github.com/acornjs/acorn) parser turns your code into an AST.
- **Interpreter:** it walks the AST using generator functions, so `await` can genuinely suspend and resume an async function.
- **Its own Promise implementation** follows the spec's job ordering, including:
  - reactions are queued only when a promise settles
  - resolving a promise with another promise costs **two extra microtask hops** (the `NewPromiseResolveThenableJob`)
  - `await` takes a single hop for native promises (the modern optimized behaviour)
  - `finally` passes values through the way the spec describes
- **Its own timers and event loop** use a simulated clock: macrotask → drain microtasks → move expired timers → repeat.
- **A snapshot after every step** records line, call stack, Web APIs, both queues, console and a narration. The UI just replays the snapshots.

### Cross-checking
Whenever you step through code, the app also runs it for real. If the simulator's output order ever differs from real execution, a warning appears and the real order is the one to trust. The test suite checks this agreement for every puzzle (see [Running tests](#running-tests)).

### Simulated time
In step mode, a timer moves from **Web APIs** to the **macrotask queue** at the moment the event loop goes looking for a macrotask and the timer's time has passed. A browser may expire a 0ms timer slightly earlier while your script is still running. The observable order is the same, but the exact moment the callback appears in the queue is a simplification.

---

## What step mode supports

| Supported | Not supported yet |
|---|---|
| `let`, `const`, `var` (with correct hoisting and per-iteration `let` bindings) | `class`, `new` on your own functions |
| Function declarations, function expressions, arrow functions | Destructuring (`const { a } = obj`, `[x, y] = arr`) |
| `async` functions and `await` | `switch`, `do…while`, `for…in`, labelled statements |
| `new Promise`, `.then`, `.catch`, `.finally` | Generators, `for await…of` |
| `Promise.resolve`, `Promise.reject`, `Promise.all`, `Promise.race` | `Promise.allSettled`, `Promise.any` |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `queueMicrotask` | `fetch`, DOM events, `requestAnimationFrame`, `MutationObserver` |
| `if`, `for`, `for…of`, `while`, `break`, `continue` | Node-only APIs: `process.nextTick`, `setImmediate` |
| `try / catch / finally`, `throw`, uncaught errors | Getters/setters, `Proxy` |
| Objects, arrays, template literals, spread, optional chaining | |
| Built-ins: `Math`, `JSON`, `Object`, `Array`, `String`, `Number`, `Map`, `Set`, array methods like `map` and `filter` | |

If your code uses something unsupported, step mode shows the steps up to that point and names the line it couldn't handle. **Run and show** always works for any browser JavaScript.

Safety limits in step mode: 1,500 steps (catches endless loops), and `setInterval` stops after 10 ticks.

---

## Known limitations

- **Browser semantics only.** Node.js has extra phases (`setImmediate`, `process.nextTick`). They're explained on the Cheat sheet but not simulated.
- **Rendering isn't shown.** The narration marks where the browser *may* render, but paint and `requestAnimationFrame` aren't visualized.
- **Object formatting.** `console.log` of objects and arrays is shown in a readable format that may differ slightly from your browser's DevTools.
- **Progress and playground code live in `localStorage`.** They stay in one browser on one device and are lost if you clear site data.

---

## Project structure

```
event-loop-gym/
├── index.html        # The whole app: React UI, puzzles, real-execution runner, styles
├── sim.js            # Step-through simulator: interpreter, promises, timers, event loop
├── test/
│   └── compare.js    # Checks simulator output against real execution
├── package.json      # Dev dependency (acorn) and the test script
├── LICENSE
└── README.md
```

### Tech choices
- **React 18** and **htm** loaded from a CDN. That's JSX-like syntax without a build step, so the project stays a single static page that anyone can open, read and fork.
- **acorn** to parse JavaScript into an AST for the simulator.
- **No backend, no tracking.** Everything runs in your browser.

---

## Running tests

```sh
npm install
npm test
```

The test runs every puzzle plus extra edge cases (`finally`, `Promise.all`, `setInterval` with `clearInterval`, `try/catch` around a rejected `await`, an `async` function returning a promise, `let` in loops, object formatting) twice: once with real Node.js execution and once through `sim.js`. It fails if the output order differs.

Expected result:

```
OK   basics         steps=15
OK   classic        steps=28
...
All cases match real execution
```

---

## Adding a puzzle

Puzzles live in the `PUZZLES` array in `index.html`:

```js
{
  id: 'my-puzzle',          // unique, kebab-case
  level: 1,                 // 0 Warm-up, 1 Promises, 2 async/await, 3 Interview
  title: 'Short title',
  code: `console.log('A');
setTimeout(() => console.log('B'), 0);`,
  why: 'One to three sentences explaining the order.'
}
```

Then:

1. Run `npm test` to confirm the simulator agrees with real execution. The test picks up new puzzles automatically.
2. Open the app, solve your puzzle, and step through it to check the narration reads well.

Good puzzles teach **one idea**, have **4–8 outputs**, and use short, distinct labels.

---

## Roadmap

Ideas for future versions, roughly in priority order:

- [ ] Node.js mode: `process.nextTick`, `setImmediate`, and the phase-by-phase loop
- [ ] Destructuring and `switch` in step mode
- [ ] Rendering step and `requestAnimationFrame` visualization
- [ ] Shareable links to custom playground code
- [ ] More puzzles: `Promise.allSettled`, `Promise.any`, error handling, microtask starvation
- [ ] Explain-my-mistake: point to the first step where a wrong prediction diverged

---

## Contributing

Issues and pull requests are welcome, especially:

- **New puzzles** that teach something the current set doesn't
- **Simulator coverage** for unsupported syntax
- **Bug reports** where step-through and real execution disagree. Please include the code snippet.

Before opening a PR:

1. Keep the app build-free: plain HTML and JS with CDN libraries pinned to exact versions.
2. Run `npm test` and make sure it passes.
3. Check the change in both light and dark mode.

---

## License

[MIT](LICENSE) © 2026 Ajit

---

*If this helped you finally "get" the event loop, a star on the repo helps others find it.*
