# Event Loop Gym

Learn the JavaScript event loop by doing: guess the output order, then watch the code run step by step.

**Try it:** https://ajitprai.github.io/event-loop-gym/

## What you can do

- **Practice:** 17 puzzles from easy to interview level. Put the outputs in order, then check your answer.
- **Step through:** watch each line move through the call stack, timers, microtask queue and macrotask queue.
- **Playground:** paste your own code and step through it, or quiz yourself on it.
- **Cheat sheet:** a one-page summary of the rules.

## The one rule

```
run one task (your script is the first)
→ run ALL microtasks (promises, await)
→ run the next task (setTimeout, events)
→ repeat
```

## Run it locally

No build step. It's a single static page.

```sh
git clone https://github.com/Ajitprai/event-loop-gym.git
cd event-loop-gym
npx serve .
```

## How the step-through works

`sim.js` is a small JavaScript interpreter with its own promises, timers and event loop, so it can pause after every step. The app also runs your code for real and warns you if the two ever disagree.

Step mode supports functions, async/await, promises, timers, loops and try/catch. Classes and destructuring aren't supported yet. Use "Run and show" for those.

## Tests

```sh
npm install
npm test
```

This checks that the simulator gives the same output order as real JavaScript for every puzzle.

## Contributing

New puzzles and bug reports are welcome. Puzzles live in the `PUZZLES` array in `index.html`. Run `npm test` before opening a pull request.

## License

MIT
