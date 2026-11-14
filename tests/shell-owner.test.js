const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { moduleSource } = require('./support/renderer-bundle');

const source = moduleSource(path.resolve(__dirname, '../src/shell/ShellModel.js'), 'ShellModule');
function harness() {
  const context = {}; vm.runInNewContext(source, context);
  let now = new Date(2026, 0, 1, 12, 0).getTime();
  const intervals = [], timeouts = [], cleared = [];
  const shell = new context.ShellModule.ShellModel({
    now: () => now,
    scheduleInterval: (run, delay) => { const timer = { run, delay }; intervals.push(timer); return timer; },
    cancelInterval: timer => cleared.push(timer),
    scheduleTimeout: (run, delay) => { const timer = { run, delay }; timeouts.push(timer); return timer; },
    cancelTimeout: timer => cleared.push(timer),
  });
  return { shell, intervals, timeouts, cleared, advance: amount => { now += amount; } };
}

test('shell starts one 20-second clock and derives the current display time on every render', () => {
  const { shell, intervals, advance } = harness();
  let renders = 0; shell.subscribe(() => renders++);
  shell.start(); shell.start();
  assert.equal(intervals.length, 1); assert.equal(intervals[0].delay, 20000);
  assert.equal(shell.view().clock, '12:00');
  advance(60000);
  assert.equal(shell.view().clock, '12:01', 'another feature render reads current time between clock ticks');
  intervals[0].run(); assert.equal(renders, 1);
  assert.equal(shell.state.now, shell.view().now);
});

test('a replacement toast expires after 4.2 seconds and an old callback cannot remove it', () => {
  const { shell, timeouts, cleared } = harness();
  shell.notify('Saved');
  assert.equal(shell.state.toast.msg, 'Saved'); assert.equal(shell.state.toast.kind, 'ok');
  assert.equal(timeouts[0].delay, 4200);
  shell.notify('Check the paper', 'warn');
  assert.ok(cleared.includes(timeouts[0]));
  timeouts[0].run(); assert.equal(shell.state.toast.msg, 'Check the paper');
  assert.match(shell.view().toastStyle, /background:#FDE047/);
  timeouts[1].run(); assert.equal(shell.state.toast, null); assert.equal(shell.view().hasToast, false);
  shell.notify('Could not save', 'err'); assert.match(shell.view().toastStyle, /background:#DC2626/);
});

test('disposal cancels timers, removes subscriptions, and ignores late timers and notifications', () => {
  const { shell, intervals, timeouts, cleared } = harness();
  shell.start(); shell.notify('Saved');
  let renders = 0; shell.subscribe(() => renders++);
  shell.dispose(); const state = shell.state;
  assert.ok(cleared.includes(intervals[0])); assert.ok(cleared.includes(timeouts[0]));
  intervals[0].run(); timeouts[0].run(); shell.notify('Late message'); shell.start();
  assert.equal(shell.state, state); assert.equal(renders, 0); assert.equal(shell.listeners.size, 0);
  assert.equal(intervals.length, 1); assert.equal(timeouts.length, 1);
});
