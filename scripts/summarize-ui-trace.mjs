import fs from 'node:fs';
const filename = process.argv[2];
if (!filename) throw new Error('Usage: node scripts/summarize-ui-trace.mjs <trace.json>');
const trace = JSON.parse(fs.readFileSync(filename, 'utf8'));
const events = trace.traceEvents ?? trace;
const threads = new Set(events.filter(e => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map(e => `${e.pid}:${e.tid}`));
const tasks = events.filter(e => threads.has(`${e.pid}:${e.tid}`) && e.ph === 'X' && /(^RunTask$|ThreadControllerImpl::RunTask|ThreadPool_RunTask)/.test(e.name) && Number.isFinite(e.dur));
const durations = tasks.map(e => e.dur / 1000).sort((a, b) => a - b);
const bounds = tasks.reduce((range, event) => ({ start: Math.min(range.start, event.ts), end: Math.max(range.end, event.ts + event.dur) }), { start: Infinity, end: -Infinity });
const totalDurationMs = tasks.length ? (bounds.end - bounds.start) / 1000 : null;
console.log(JSON.stringify({
  rendererThreads: threads.size, taskCount: tasks.length, observedTaskSpanMs: totalDurationMs,
  taskP95Ms: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null,
  longestTaskMs: durations.at(-1) ?? null, tasksOver50Ms: durations.filter(ms => ms > 50).length,
  longTasks: tasks.filter(event => event.dur > 50000).map(task => ({
    sinceStartMs: (task.ts - bounds.start) / 1000, durationMs: task.dur / 1000,
    work: events.filter(event => event.ph === 'X' && event.pid === task.pid && event.tid === task.tid && event !== task && event.ts >= task.ts && event.ts + event.dur <= task.ts + task.dur)
      .sort((a, b) => b.dur - a.dur).slice(0, 4).map(event => ({ name: event.name, durationMs: event.dur / 1000 })),
  })),
  note: 'Whole trace includes startup. Task duration is not input latency or frame time. No before/after comparison implied.',
}, null, 2));
