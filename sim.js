function simulateEventLoop(code, acorn, opts) {
  opts = opts || {};
  const MAX_STEPS = opts.maxSteps || 1500, MAX_OPS = 300000, INTERVAL_LIMIT = 10;
  let ast;
  try { ast = acorn.parse(code, { ecmaVersion: 2022, locations: true, sourceType: 'script' }); }
  catch (e) { return { error: 'Syntax error: ' + e.message, steps: [], out: [] }; }

  const S = { stack: [], web: [], micro: [], macro: [], out: [], clock: 0, phase: 'sync', line: 0 };
  const steps = [];
  let ops = 0, timerSeq = 0, pid = 0, truncated = false, curLine = 0;
  class Stop extends Error {}
  class ThrowSignal { constructor(v) { this.value = v; } }
  class Unsupported extends Error { constructor(m, line) { super(m); this.line = line; } }

  function snap(desc, kind) {
    kind = kind || 'event';
    const s = {
      desc, kind, line: S.line, phase: S.phase, clock: S.clock,
      stack: S.stack.slice().reverse(),
      web: S.web.slice().sort((a, b) => a.due - b.due || a.id - b.id).map(t => t.label + ' · fires at ' + t.due + 'ms'),
      micro: S.micro.map(j => j.label), macro: S.macro.map(j => j.label), out: S.out.slice()
    };
    const last = steps[steps.length - 1];
    if (last && last.kind === 'stmt' && kind !== 'stmt' && last.line === s.line) steps.pop();
    steps.push(s);
    if (steps.length > MAX_STEPS) { truncated = true; throw new Stop(); }
  }

  // ---------- values ----------
  class Env {
    constructor(parent, isFn) { this.vars = new Map(); this.parent = parent; this.isFn = isFn; this.consts = null; }
    find(n) { let e = this; while (e) { if (e.vars.has(n)) return e; e = e.parent; } return null; }
    get(n) { const e = this.find(n); if (!e) throw new ThrowSignal(new ReferenceError(n + ' is not defined')); return e.vars.get(n); }
    has(n) { return !!this.find(n); }
    set(n, v) { const e = this.find(n); if (!e) { globalEnv.vars.set(n, v); return; } if (e.consts && e.consts.has(n)) throw new ThrowSignal(new TypeError('Assignment to constant variable.')); e.vars.set(n, v); }
    declare(n, v, kind) { if (kind === 'const') (this.consts || (this.consts = new Set())).add(n); this.vars.set(n, v); }
    fnScope() { let e = this; while (!e.isFn) e = e.parent; return e; }
    copy() { const e = new Env(this.parent, this.isFn); this.vars.forEach((v, k) => e.vars.set(k, v)); e.consts = this.consts; return e; }
  }
  class Closure {
    constructor(node, env, name) {
      this.node = node; this.env = env; this.isAsync = !!node.async; this.isArrow = node.type === 'ArrowFunctionExpression';
      this.name = (node.id && node.id.name) || name || null; this.line = node.loc.start.line;
    }
    label() { return this.name ? this.name : (this.isArrow ? 'arrow fn' : 'function') + ' (line ' + this.line + ')'; }
  }
  class Native { constructor(name, fn, isCtor) { this.name = name; this.fn = fn; this.isCtor = isCtor; } }
  class MP { constructor() { this.state = 'pending'; this.value = undefined; this.reactions = []; this.id = ++pid; this.handled = false; } }

  function fmt(v, inner) {
    if (typeof v === 'string') return inner ? JSON.stringify(v) : v;
    if (v instanceof MP) return 'Promise {' + (v.state === 'pending' ? '<pending>' : v.state === 'fulfilled' ? fmt(v.value, true) : '<rejected> ' + fmt(v.value, true)) + '}';
    if (v instanceof Closure) return 'ƒ ' + (v.name || 'anonymous');
    if (v instanceof Native) return 'ƒ ' + v.name;
    if (typeof v === 'function') return 'ƒ ' + (v.name || 'anonymous');
    if (v instanceof Error) return v.name + ': ' + v.message;
    if (Array.isArray(v)) return '[' + v.map(x => fmt(x, true)).join(', ') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).map(k => k + ': ' + fmt(v[k], true)).join(', ') + '}';
    return String(v);
  }
  function toStr(v) { if (v instanceof MP) return '[object Promise]'; if (v instanceof Closure || v instanceof Native) return fmt(v); return String(v); }
  function toReal(v) {
    if (v instanceof Closure) {
      if (!v._real) { const c = v; v._real = function (...a) { return runSync(callFn(c, a, this, c.label(), 'Call ' + c.label())); }; }
      return v._real;
    }
    return v;
  }
  function isCallable(f) { return f instanceof Closure || f instanceof Native || typeof f === 'function'; }

  // ---------- microtasks & promises ----------
  function enqueueMicro(label, job, desc) { S.micro.push({ label, job }); snap(desc || label + ' added to the microtask queue', 'queue'); }
  function settle(p, state, v) {
    if (p.state !== 'pending') return;
    p.state = state; p.value = v;
    const rs = p.reactions; p.reactions = [];
    rs.forEach(r => enqueueMicro(r.label, r.job(state, v), 'Promise ' + (state === 'fulfilled' ? 'resolves' : 'rejects') + ', so its waiting callback "' + r.label + '" moves to the microtask queue'));
  }
  function resolveValue(p, x) {
    if (x === p) return settle(p, 'rejected', new TypeError('Chaining cycle'));
    if (x instanceof MP) {
      enqueueMicro('adopt inner promise', function (announce) {
        snap('Run microtask: ' + announce + ' (an extra hop, because a promise was resolved with another promise)', 'run');
        const r = makeResolvers(p); thenNative(x, r.res, r.rej, 'pass value to outer promise');
      }, 'Resolving a promise with another promise costs an extra microtask hop');
      return;
    }
    settle(p, 'fulfilled', x);
  }
  function makeResolvers(p) {
    let done = false;
    return { res: x => { if (done) return; done = true; resolveValue(p, x); }, rej: e => { if (done) return; done = true; settle(p, 'rejected', e); } };
  }
  function thenNative(p, onF, onR, label) {
    p.handled = true;
    const r = { label, job: (st, v) => function () { (st === 'fulfilled' ? onF : onR)(v); } };
    if (p.state === 'pending') p.reactions.push(r);
    else enqueueMicro(label, r.job(p.state, p.value));
  }
  function promiseResolve(x) { if (x instanceof MP) return x; const p = new MP(); makeResolvers(p).res(x); return p; }
  function userThen(p, onF, onR, kind) {
    p.handled = true;
    const d = new MP(), rs = makeResolvers(d), line = curLine;
    const label = '.' + kind + ' callback (line ' + line + ')';
    const job = (st, v) => function (announce) {
      const h = st === 'fulfilled' ? onF : onR;
      if (!isCallable(h)) { snap('Run microtask: ' + announce + ' (no handler for this outcome, value passes through)', 'run'); st === 'fulfilled' ? rs.res(v) : rs.rej(v); return; }
      try { const out = runSync(callFn(h, [v], undefined, label, 'Event loop runs microtask: ' + label)); rs.res(out); }
      catch (e) { if (e instanceof ThrowSignal) rs.rej(e.value); else throw e; }
    };
    const r = { label, job };
    if (p.state === 'pending') { p.reactions.push(r); snap('Promise is still pending, so the .' + kind + ' callback is registered on it and waits (not queued yet)', 'event'); }
    else enqueueMicro(label, job(p.state, p.value), 'Promise is already settled, so the .' + kind + ' callback goes straight into the microtask queue');
    return d;
  }
  function promiseMember(p, prop) {
    if (prop === 'then') return new Native('then', a => userThen(p, a[0], a[1], 'then'));
    if (prop === 'catch') return new Native('catch', a => userThen(p, undefined, a[0], 'catch'));
    if (prop === 'finally') return new Native('finally', a => {
      const f = a[0];
      if (!isCallable(f)) return userThen(p, undefined, undefined, 'finally');
      const after = (r, ok, v) => { const q = new MP(); thenNative(promiseResolve(r), () => settle(q, ok ? 'fulfilled' : 'rejected', v), e => settle(q, 'rejected', e), 'finally passes value on'); return q; };
      const onF = new Native('finally', ([v]) => after(runSync(callFn(f, [], undefined, 'finally callback')), true, v));
      const onR = new Native('finally', ([e]) => after(runSync(callFn(f, [], undefined, 'finally callback')), false, e));
      return userThen(p, onF, onR, 'finally');
    });
    return undefined;
  }
  const PromiseCtor = new Native('Promise', null, true);
  const promiseStatics = {
    resolve: new Native('Promise.resolve', a => promiseResolve(a[0])),
    reject: new Native('Promise.reject', a => { const p = new MP(); settle(p, 'rejected', a[0]); return p; }),
    all: new Native('Promise.all', a => {
      const items = Array.from(a[0] || []), p = new MP(), rs = makeResolvers(p), vals = []; let left = items.length;
      if (!left) rs.res(vals);
      items.forEach((it, i) => thenNative(promiseResolve(it), v => { vals[i] = v; if (--left === 0) rs.res(vals); }, rs.rej, 'Promise.all item ' + (i + 1)));
      return p;
    }),
    race: new Native('Promise.race', a => { const p = new MP(), rs = makeResolvers(p); Array.from(a[0] || []).forEach((it, i) => thenNative(promiseResolve(it), rs.res, rs.rej, 'Promise.race item ' + (i + 1))); return p; })
  };

  // ---------- timers ----------
  function addTimer(cb, ms, args, interval, id) {
    ms = Math.max(0, Math.floor(Number(ms) || 0));
    const t = { id: id || ++timerSeq, cb, args, ms, interval, due: S.clock + ms, runs: 0, label: (interval ? 'setInterval' : 'setTimeout') + ' cb #' + (id || timerSeq) + (cb instanceof Closure ? ' (line ' + cb.line + ')' : '') };
    S.web.push(t);
    return t;
  }
  const cleared = new Set();
  function clearTimer(id) {
    cleared.add(id);
    const before = S.web.length + S.macro.length;
    S.web = S.web.filter(t => t.id !== id); S.macro = S.macro.filter(t => !t.timer || t.timer.id !== id);
    snap(before !== S.web.length + S.macro.length ? 'Timer #' + id + ' cleared: its callback will never run' : 'clearTimeout: nothing to clear', 'event');
  }

  // ---------- globals ----------
  const globalEnv = new Env(null, true);
  const logFn = new Native('console.log', a => { const t = a.map(x => fmt(x)).join(' '); S.out.push(t); snap('console.log prints "' + t + '"', 'log'); });
  globalEnv.declare('console', { log: logFn, info: logFn, warn: logFn, error: logFn, debug: logFn });
  globalEnv.declare('setTimeout', new Native('setTimeout', a => { const t = addTimer(a[0], a[1], a.slice(2), false); snap('setTimeout hands ' + t.label + ' to the browser timer (Web API) for ' + t.ms + 'ms, then returns immediately', 'web'); return t.id; }));
  globalEnv.declare('setInterval', new Native('setInterval', a => { const t = addTimer(a[0], a[1], a.slice(2), true); snap('setInterval registers a repeating timer every ' + t.ms + 'ms (Web API)', 'web'); return t.id; }));
  globalEnv.declare('clearTimeout', new Native('clearTimeout', a => clearTimer(a[0])));
  globalEnv.declare('clearInterval', new Native('clearInterval', a => clearTimer(a[0])));
  globalEnv.declare('queueMicrotask', new Native('queueMicrotask', a => {
    const cb = a[0], label = 'queueMicrotask cb (line ' + curLine + ')';
    enqueueMicro(label, function () { runSync(callFn(cb, [], undefined, label, 'Event loop runs microtask: ' + label)); }, 'queueMicrotask puts the callback straight into the microtask queue');
  }));
  globalEnv.declare('Promise', PromiseCtor);
  ['Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'TypeError', 'RangeError', 'ReferenceError', 'parseInt', 'parseFloat', 'isNaN', 'Map', 'Set', 'Symbol', 'Infinity', 'NaN', 'undefined'].forEach(n => globalEnv.declare(n, globalThis[n]));

  // ---------- calling ----------
  function* callFn(f, args, thisArg, frame, announce) {
    if (f instanceof Native) {
      if (f === PromiseCtor) throw new ThrowSignal(new TypeError("Promise constructor cannot be invoked without 'new'"));
      return f.fn(args, thisArg);
    }
    if (typeof f === 'function') {
      try { return f.apply(thisArg, args.map(toReal)); }
      catch (e) { if (e instanceof Stop || e instanceof ThrowSignal || e instanceof Unsupported) throw e; throw new ThrowSignal(e); }
    }
    if (!(f instanceof Closure)) throw new ThrowSignal(new TypeError(fmt(f) + ' is not a function'));
    const name = frame || f.label();
    if (f.isAsync) return startAsync(f, args, thisArg, name, announce);
    S.stack.push(name);
    snap(announce || 'Call ' + name + ': pushed onto the call stack', 'push');
    try { return yield* runBody(f, args, thisArg); }
    finally { S.stack.pop(); if (!stopping) snap(name + ' returns: popped off the call stack', 'pop'); }
  }
  let stopping = false;
  function runSync(gen) {
    const r = gen.next();
    if (!r.done) throw new Unsupported('await can only be used inside an async function', curLine);
    return r.value;
  }
  function bindParams(f, args, env) {
    f.node.params.forEach((p, i) => {
      if (p.type === 'Identifier') env.declare(p.name, args[i]);
      else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') env.declare(p.left.name, args[i] === undefined ? runSync(ev(p.right, env)) : args[i]);
      else if (p.type === 'RestElement' && p.argument.type === 'Identifier') env.declare(p.argument.name, args.slice(i));
      else throw new Unsupported('Destructured parameters are not supported in step mode', p.loc.start.line);
    });
  }
  function* runBody(f, args, thisArg) {
    const env = new Env(f.env, true);
    if (!f.isArrow) { env.thisVal = thisArg; env.hasThis = true; }
    bindParams(f, args, env);
    const body = f.node.body;
    if (body.type !== 'BlockStatement') { S.line = body.loc.start.line; return yield* ev(body, env); }
    hoist(body.body, env);
    const c = yield* execList(body.body, env);
    return c && c.type === 'return' ? c.value : undefined;
  }
  function startAsync(f, args, thisArg, name, announce) {
    const p = new MP();
    const gen = runBody(f, args, thisArg);
    S.stack.push(name);
    snap(announce ? announce + ' (async function: its body starts running synchronously)' : 'Call ' + name + ': an async function runs synchronously until its first await', 'push');
    stepAsync(gen, p, name, undefined, false);
    return p;
  }
  function stepAsync(gen, p, name, input, isThrow) {
    let r;
    try { r = isThrow ? gen.throw(new ThrowSignal(input)) : gen.next(input); }
    catch (e) {
      if (!(e instanceof ThrowSignal)) throw e;
      S.stack.pop(); settle(p, 'rejected', e.value); snap(name + ' threw, so its promise rejects. Popped off the call stack', 'pop'); return;
    }
    if (r.done) {
      S.stack.pop();
      if (r.value instanceof MP) { snap(name + ' returned a promise: popped off the stack, its own promise will adopt it', 'pop'); makeResolvers(p).res(r.value); }
      else { snap(name + ' finished: popped off the stack', 'pop'); makeResolvers(p).res(r.value); }
      return;
    }
    const awaited = promiseResolve(r.value.value);
    S.stack.pop();
    thenNative(awaited,
      v => { S.stack.push(name); snap('Event loop runs microtask: ' + name + ' resumes after await', 'run'); stepAsync(gen, p, name, v, false); },
      e => { S.stack.push(name); snap('Event loop runs microtask: ' + name + ' resumes after await, which throws', 'run'); stepAsync(gen, p, name, e, true); },
      'resume ' + name + ' after await (line ' + r.value.line + ')');
    if (awaited.state === 'pending') snap('await pauses ' + name + ' and pops it off the call stack. It will resume as a microtask once the awaited promise settles', 'await');
    else steps[steps.length - 1].desc = 'await pauses ' + name + ' and pops it off the call stack. The awaited value is already ready, so "resume ' + name + '" goes straight into the microtask queue';
  }

  // ---------- statements ----------
  function hoist(list, env) {
    const fnEnv = env.fnScope();
    const scanVar = n => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'VariableDeclaration' && n.kind === 'var') n.declarations.forEach(d => { if (d.id.type === 'Identifier' && !fnEnv.vars.has(d.id.name)) fnEnv.declare(d.id.name, undefined); });
      if (/Function/.test(n.type)) return;
      for (const k in n) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(scanVar); else if (v && typeof v.type === 'string') scanVar(v); }
    };
    list.forEach(scanVar);
    list.forEach(s => { if (s.type === 'FunctionDeclaration') env.declare(s.id.name, new Closure(s, env)); });
  }
  function* execList(list, env) {
    for (const s of list) { const c = yield* exec(s, env); if (c) return c; }
    return null;
  }
  const SRC = code.split('\n');
  function stmtSnap(s) { S.line = s.loc.start.line; snap('Line ' + S.line + ': ' + SRC[S.line - 1].trim(), 'stmt'); }
  function* exec(s, env) {
    if (++ops > MAX_OPS) { truncated = true; throw new Stop(); }
    switch (s.type) {
      case 'ExpressionStatement': stmtSnap(s); yield* ev(s.expression, env); return null;
      case 'VariableDeclaration':
        stmtSnap(s);
        for (const d of s.declarations) {
          if (d.id.type !== 'Identifier') throw new Unsupported('Destructuring is not supported in step mode', d.loc.start.line);
          const v = d.init ? yield* ev(d.init, env, d.id.name) : undefined;
          if (s.kind === 'var') { if (d.init) env.set(d.id.name, v); } else env.declare(d.id.name, v, s.kind);
        }
        return null;
      case 'FunctionDeclaration': return null;
      case 'EmptyStatement': return null;
      case 'ReturnStatement': stmtSnap(s); return { type: 'return', value: s.argument ? yield* ev(s.argument, env) : undefined };
      case 'BlockStatement': { const e = new Env(env, false); hoist(s.body, e); return yield* execList(s.body, e); }
      case 'IfStatement': stmtSnap(s); if (yield* ev(s.test, env)) return yield* exec(s.consequent, env); else if (s.alternate) return yield* exec(s.alternate, env); return null;
      case 'ThrowStatement': stmtSnap(s); throw new ThrowSignal(yield* ev(s.argument, env));
      case 'BreakStatement': return { type: 'break' };
      case 'ContinueStatement': return { type: 'continue' };
      case 'WhileStatement': {
        while (true) { S.line = s.loc.start.line; if (!(yield* ev(s.test, env))) break; const c = yield* exec(s.body, env); if (c) { if (c.type === 'break') break; if (c.type === 'continue') continue; return c; } }
        return null;
      }
      case 'ForStatement': {
        stmtSnap(s);
        let loopEnv = new Env(env, false);
        const isLet = s.init && s.init.type === 'VariableDeclaration' && s.init.kind !== 'var';
        if (s.init) { if (s.init.type === 'VariableDeclaration') { for (const d of s.init.declarations) { const v = d.init ? yield* ev(d.init, loopEnv) : undefined; if (s.init.kind === 'var') env.set(d.id.name, v); else loopEnv.declare(d.id.name, v); } } else yield* ev(s.init, loopEnv); }
        let iter = isLet ? loopEnv.copy() : loopEnv;
        while (true) {
          S.line = s.loc.start.line;
          if (s.test && !(yield* ev(s.test, iter))) break;
          const c = yield* exec(s.body, iter);
          if (c && c.type === 'break') break;
          if (c && c.type === 'return') return c;
          if (isLet) iter = iter.copy();
          S.line = s.loc.start.line;
          if (s.update) yield* ev(s.update, iter);
        }
        return null;
      }
      case 'ForOfStatement': {
        stmtSnap(s);
        const it = Array.from(yield* ev(s.right, env));
        for (const v of it) {
          const e = new Env(env, false);
          if (s.left.type === 'VariableDeclaration') { const id = s.left.declarations[0].id; if (id.type !== 'Identifier') throw new Unsupported('Destructuring is not supported in step mode', s.loc.start.line); if (s.left.kind === 'var') env.set(id.name, v); else e.declare(id.name, v); }
          else env.set(s.left.name, v);
          const c = yield* exec(s.body, e);
          if (c && c.type === 'break') break;
          if (c && c.type === 'return') return c;
        }
        return null;
      }
      case 'TryStatement': {
        let result = null;
        try { result = yield* exec(s.block, env); }
        catch (e) {
          if (!(e instanceof ThrowSignal) || !s.handler) { if (s.finalizer) { const f = yield* exec(s.finalizer, env); if (f) return f; } throw e; }
          const ce = new Env(env, false);
          if (s.handler.param) ce.declare(s.handler.param.name, e.value);
          S.line = s.handler.loc.start.line;
          try { result = yield* exec(s.handler.body, ce); }
          catch (e2) { if (s.finalizer) { const f = yield* exec(s.finalizer, env); if (f) return f; } throw e2; }
        }
        if (s.finalizer) { const f = yield* exec(s.finalizer, env); if (f) return f; }
        return result;
      }
      default: throw new Unsupported(s.type + ' is not supported in step mode', s.loc.start.line);
    }
  }

  // ---------- expressions ----------
  function* evArgs(list, env) {
    const out = [];
    for (const a of list) { if (a.type === 'SpreadElement') out.push(...Array.from(yield* ev(a.argument, env))); else out.push(yield* ev(a, env)); }
    return out;
  }
  function getMember(obj, prop) {
    if (obj === null || obj === undefined) throw new ThrowSignal(new TypeError("Cannot read properties of " + obj + " (reading '" + String(prop) + "')"));
    if (obj instanceof MP) return promiseMember(obj, prop);
    if (obj === PromiseCtor) return promiseStatics[prop];
    if (obj instanceof Closure) return prop === 'name' ? obj.name : undefined;
    return obj[prop];
  }
  function* memberParts(node, env) {
    const obj = yield* ev(node.object, env);
    const prop = node.computed ? yield* ev(node.property, env) : node.property.name;
    return [obj, prop];
  }
  function* assignTo(target, value, env) {
    if (target.type === 'Identifier') { env.set(target.name, value); return value; }
    if (target.type === 'MemberExpression') { const [o, p] = yield* memberParts(target, env); o[p] = value; return value; }
    throw new Unsupported('Destructuring assignment is not supported in step mode', target.loc.start.line);
  }
  const BIN = {
    '+': (a, b) => (typeof a === 'string' || typeof b === 'string') ? toStr(a) + toStr(b) : a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b, '**': (a, b) => a ** b,
    '==': (a, b) => a == b, '!=': (a, b) => a != b, '===': (a, b) => a === b, '!==': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b,
    '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b, '<<': (a, b) => a << b, '>>': (a, b) => a >> b, 'in': (a, b) => a in b,
    'instanceof': (a, b) => b === PromiseCtor ? a instanceof MP : (typeof b === 'function' ? a instanceof b : false)
  };
  function* ev(n, env, nameHint) {
    if (++ops > MAX_OPS) { truncated = true; throw new Stop(); }
    switch (n.type) {
      case 'Literal': return n.regex ? new RegExp(n.regex.pattern, n.regex.flags) : n.value;
      case 'Identifier': return n.name === 'undefined' && !env.has('undefined') ? undefined : env.get(n.name);
      case 'TemplateLiteral': { let s = ''; for (let i = 0; i < n.quasis.length; i++) { s += n.quasis[i].value.cooked; if (i < n.expressions.length) s += toStr(yield* ev(n.expressions[i], env)); } return s; }
      case 'ArrayExpression': { const out = []; for (const e of n.elements) { if (!e) out.push(undefined); else if (e.type === 'SpreadElement') out.push(...Array.from(yield* ev(e.argument, env))); else out.push(yield* ev(e, env)); } return out; }
      case 'ObjectExpression': {
        const o = {};
        for (const p of n.properties) {
          if (p.type === 'SpreadElement') { Object.assign(o, yield* ev(p.argument, env)); continue; }
          const k = p.computed ? yield* ev(p.key, env) : (p.key.type === 'Identifier' ? p.key.name : p.key.value);
          o[k] = yield* ev(p.value, env, String(k));
        }
        return o;
      }
      case 'FunctionExpression': case 'ArrowFunctionExpression': return new Closure(n, env, nameHint);
      case 'ThisExpression': { let e = env; while (e && !e.hasThis) e = e.parent; return e ? e.thisVal : undefined; }
      case 'UnaryExpression': {
        if (n.operator === 'typeof') {
          if (n.argument.type === 'Identifier' && !env.has(n.argument.name)) return 'undefined';
          const v = yield* ev(n.argument, env);
          return (v instanceof Closure || v instanceof Native) ? 'function' : v instanceof MP ? 'object' : typeof v;
        }
        if (n.operator === 'delete') { if (n.argument.type === 'MemberExpression') { const [o, p] = yield* memberParts(n.argument, env); return delete o[p]; } return true; }
        const v = yield* ev(n.argument, env);
        return { '!': x => !x, '-': x => -x, '+': x => +x, '~': x => ~x, 'void': () => undefined }[n.operator](v);
      }
      case 'BinaryExpression': { const a = yield* ev(n.left, env), b = yield* ev(n.right, env); return BIN[n.operator](a, b); }
      case 'LogicalExpression': { const a = yield* ev(n.left, env); if (n.operator === '&&') return a ? yield* ev(n.right, env) : a; if (n.operator === '||') return a ? a : yield* ev(n.right, env); return (a === null || a === undefined) ? yield* ev(n.right, env) : a; }
      case 'ConditionalExpression': return (yield* ev(n.test, env)) ? yield* ev(n.consequent, env) : yield* ev(n.alternate, env);
      case 'SequenceExpression': { let v; for (const e of n.expressions) v = yield* ev(e, env); return v; }
      case 'AssignmentExpression': {
        if (n.operator === '=') return yield* assignTo(n.left, yield* ev(n.right, env, n.left.name), env);
        const cur = yield* ev(n.left, env), r = yield* ev(n.right, env);
        const op = n.operator.slice(0, -1);
        const v = op === '&&' ? (cur && r) : op === '||' ? (cur || r) : op === '??' ? (cur ?? r) : BIN[op](cur, r);
        return yield* assignTo(n.left, v, env);
      }
      case 'UpdateExpression': { const cur = Number(yield* ev(n.argument, env)); const nv = n.operator === '++' ? cur + 1 : cur - 1; yield* assignTo(n.argument, nv, env); return n.prefix ? nv : cur; }
      case 'MemberExpression': { const [o, p] = yield* memberParts(n, env); if (n.optional && (o === null || o === undefined)) return undefined; return getMember(o, p); }
      case 'ChainExpression': return yield* ev(n.expression, env);
      case 'AwaitExpression': { const v = yield* ev(n.argument, env); return yield { value: v, line: n.loc.start.line }; }
      case 'NewExpression': {
        const C = yield* ev(n.callee, env), args = yield* evArgs(n.arguments, env);
        curLine = n.loc.start.line;
        if (C === PromiseCtor) {
          const p = new MP(), rs = makeResolvers(p);
          const res = new Native('resolve', a => rs.res(a[0])), rej = new Native('reject', a => rs.rej(a[0]));
          if (!isCallable(args[0])) throw new ThrowSignal(new TypeError('Promise resolver is not a function'));
          try { yield* callFn(args[0], [res, rej], undefined, 'Promise executor', 'new Promise calls the executor immediately (synchronously)'); }
          catch (e) { if (e instanceof ThrowSignal) rs.rej(e.value); else throw e; }
          return p;
        }
        if (typeof C === 'function') { try { return new C(...args.map(toReal)); } catch (e) { throw new ThrowSignal(e); } }
        throw new Unsupported('new with your own functions or classes is not supported in step mode', n.loc.start.line);
      }
      case 'CallExpression': {
        let fn, thisArg, name;
        if (n.callee.type === 'MemberExpression') {
          const [o, p] = yield* memberParts(n.callee, env);
          if (n.callee.optional && (o === null || o === undefined)) return undefined;
          fn = getMember(o, p); thisArg = o; name = (n.callee.object.name || '') + '.' + String(p);
        } else { fn = yield* ev(n.callee, env); name = n.callee.name; }
        if (n.optional && (fn === null || fn === undefined)) return undefined;
        const args = yield* evArgs(n.arguments, env);
        curLine = n.loc.start.line;
        if (!isCallable(fn)) throw new ThrowSignal(new TypeError((name || 'expression') + ' is not a function'));
        const frame = fn instanceof Closure ? (fn.name || name || fn.label()) + '()' : name;
        return yield* callFn(fn, args, thisArg, frame);
      }
      case 'ClassExpression': case 'ClassDeclaration': throw new Unsupported('Classes are not supported in step mode', n.loc.start.line);
      default: throw new Unsupported(n.type + ' is not supported in step mode', n.loc.start.line);
    }
  }

  // ---------- event loop ----------
  let fatal = null;
  function uncaught(e) {
    if (e instanceof ThrowSignal) { const t = 'Uncaught ' + fmt(e.value); S.out.push(t); snap('Uncaught error: ' + fmt(e.value) + '. The rest of this task is abandoned', 'log'); S.stack.length = 0; return; }
    throw e;
  }
  function moveExpired() {
    const due = S.web.filter(t => t.due <= S.clock).sort((a, b) => a.due - b.due || a.id - b.id);
    for (const t of due) {
      S.web = S.web.filter(x => x !== t);
      S.macro.push({ label: t.label, timer: t });
      snap('Timer #' + t.id + ' is done (' + t.ms + 'ms). The browser moves its callback into the macrotask queue', 'queue');
    }
  }
  try {
    S.stack.push('main (script)');
    snap('Your whole script runs as the first macrotask. "main" is pushed onto the call stack', 'push');
    hoist(ast.body, globalEnv);
    try { runSync(execList(ast.body, globalEnv)); } catch (e) { uncaught(e); }
    S.stack.length = 0; S.line = 0; S.phase = 'loop';
    snap('Script finished. The call stack is empty, so the event loop checks the microtask queue first', 'loop');
    let guard = 0;
    while (guard++ < 2000) {
      if (S.micro.length) {
        S.phase = 'micro';
        while (S.micro.length) {
          const j = S.micro.shift();
          try { j.job(j.label); } catch (e) { uncaught(e); }
          S.stack.length = 0;
        }
        S.line = 0; S.phase = 'loop';
        snap('Microtask queue is empty. Only now can the event loop look at macrotasks (the browser may also render here)', 'loop');
      }
      moveExpired();
      if (!S.macro.length) {
        if (!S.web.length) break;
        const next = Math.min(...S.web.map(t => t.due));
        S.clock = next; snap('Nothing to run. Time passes until the next timer: ' + next + 'ms', 'loop');
        moveExpired();
      }
      const task = S.macro.shift(), t = task.timer;
      S.phase = 'macro';
      try { runSync(callFn(t.cb, t.args || [], undefined, t.label, 'Event loop takes ONE macrotask: ' + t.label + ', pushed onto the call stack')); }
      catch (e) { uncaught(e); }
      S.stack.length = 0; S.line = 0;
      if (t.interval && !cleared.has(t.id)) {
        t.runs++;
        if (t.runs < INTERVAL_LIMIT) { addTimer(t.cb, t.ms, t.args, true, t.id); S.web[S.web.length - 1].runs = t.runs; S.phase = 'loop'; snap('Interval re-arms its timer for another ' + t.ms + 'ms', 'web'); }
        else { S.phase = 'loop'; snap('Stopped the interval after ' + INTERVAL_LIMIT + ' runs to keep things readable', 'loop'); }
      }
      S.phase = 'loop';
    }
    S.phase = 'done'; S.line = 0;
    snap('All queues are empty. Program complete', 'done');
  } catch (e) {
    stopping = true;
    if (e instanceof Stop) { /* truncated */ }
    else if (e instanceof Unsupported) fatal = e.message + (e.line ? ' (line ' + e.line + ')' : '');
    else fatal = 'Simulator error: ' + (e && e.message ? e.message : String(e));
  }
  return { steps, out: S.out, error: fatal, truncated };
}
if (typeof module !== 'undefined') module.exports = simulateEventLoop;
