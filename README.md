# Event Loop Gym

Practice the JavaScript event loop until execution order feels obvious.

**[Open the app →](https://OWNER.github.io/event-loop-gym/)**

## What's inside

- **Practice:** 17 puzzles from warm-up to classic interview questions. Click the outputs in the order you think they print, then check. The answer comes from actually running the code in your browser.
- **Step through:** watch your code line by line, with the call stack, Web APIs (timers), microtask queue, macrotask queue and console updating at every step.
- **Playground:** paste your own code and step through it, quiz yourself on it, or just run it.
- **Cheat sheet:** which API goes to which queue, Node.js differences, and common traps.

## How the step-through works

`sim.js` is a small JavaScript interpreter built on the [acorn](https://github.com/acornjs/acorn) parser. It has its own promises (following the spec's job ordering, including the extra hops when a promise resolves with another promise), timers and event loop, and records a snapshot after every step.

The app also runs your code for real and warns you if the simulation's order differs from real execution.

Step mode supports functions, async/await, promises (`then`, `catch`, `finally`, `all`, `race`), `setTimeout`, `setInterval`, `queueMicrotask`, loops and `try/catch`. Not supported yet: classes, destructuring, `switch`, `for…in`, generators, DOM and Node-only APIs. "Run and show" handles any browser JavaScript.

## Run locally

It's a static page with no build step. Open `index.html` through any static server:

```sh
npx serve .
```

## Tests

The test compares the simulator's output against real execution for every puzzle plus edge cases:

```sh
npm install
npm test
```

## Contributing

New puzzles are welcome. Add them to the `PUZZLES` array in `index.html` with a short explanation, and run `npm test` to confirm the simulator agrees with real execution.

## License

MIT
