// 校验 /v1 返回的 JSON 是否满足 M3 Swift Codable 模型的实际要求。只读，不改数据。
const base = process.argv[2] || 'http://127.0.0.1:7317';

async function j(path) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
  const t = await r.text();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + t.slice(0, 200));
  return JSON.parse(t);
}

const problems = [];
function check(cond, msg) { if (!cond) problems.push(msg); }
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

const requiredSnapshot = {
  schema_version: 'string', task_id: 'string', state: 'string', state_version: 'number',
  updated_at: 'number', agent_count: 'number', agent_state: 'string', connection: 'string',
  delegation_depth: 'number', capabilities: 'object',
};
const optionalSnapshot = {
  run_id: ['string', 'null'], title: ['string', 'null'], summary: ['string', 'null'],
  started_at: ['number', 'null'], last_activity_at: ['number', 'null'], ended_at: ['number', 'null'],
  cost: ['number', 'null'], token_usage: ['object', 'null'], parent_task_id: ['string', 'null'],
  origin: ['string', 'null'], current_step: ['number', 'null'], current_tool: ['string', 'null'],
  waiting: ['object', 'null'],
};

function checkSnapshot(s, label) {
  for (const [k, t] of Object.entries(requiredSnapshot)) {
    if (s[k] === undefined) { check(false, `${label}: missing required ${k}`); continue; }
    check(typeOf(s[k]) === t, `${label}: ${k} expected ${t} got ${typeOf(s[k])}`);
  }
  for (const [k, ts] of Object.entries(optionalSnapshot)) {
    if (s[k] !== undefined) check(ts.includes(typeOf(s[k])), `${label}: ${k} expected ${ts.join('|')} got ${typeOf(s[k])}`);
  }
  if (s.capabilities) {
    for (const k of ['approval', 'cost', 'agents']) check(typeof s.capabilities[k] === 'boolean', `${label}: capabilities.${k} expected boolean`);
  }
  if (s.token_usage) {
    for (const k of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens', 'messages']) {
      check(typeof s.token_usage[k] === 'number', `${label}: token_usage.${k} expected number`);
    }
  }
}

const list = await j('/v1/tasks?limit=10');
check(Array.isArray(list.tasks), 'tasks must be array');
console.log('tasks=' + (list.tasks || []).length);
for (const s of list.tasks || []) checkSnapshot(s, 'task:' + s.task_id);

if (list.tasks && list.tasks.length) {
  const id = list.tasks[0].task_id;
  checkSnapshot(await j('/v1/tasks/' + encodeURIComponent(id)), 'detail');
  const ev = await j('/v1/tasks/' + encodeURIComponent(id) + '/events?after_seq=-1&limit=20');
  check(Array.isArray(ev.events), 'events must be array');
  for (const e of ev.events || []) {
    for (const k of ['event_id', 'task_id', 'seq', 'type', 'occurred_at']) check(e[k] !== undefined, 'event missing ' + k);
    if (e.run_id !== undefined) check(['string', 'null'].includes(typeOf(e.run_id)), 'event.run_id bad type');
  }
  console.log('events=' + (ev.events || []).length);
}

const actions = await j('/v1/actions');
check(Array.isArray(actions.actions), '/v1/actions must expose array');
for (const a of actions.actions || []) {
  for (const k of ['action_id', 'tool_name', 'created_at', 'expires_at', 'status']) check(a[k] !== undefined, 'action missing ' + k);
  if (a.display_reason !== undefined && a.display_reason !== null) check(typeOf(a.display_reason) === 'object', 'action.display_reason expected object');
}
console.log('actions=' + (actions.actions || []).length);

const questions = await j('/v1/questions');
check(Array.isArray(questions.questions), '/v1/questions must expose array');
for (const q of questions.questions || []) {
  for (const k of ['action_id', 'questions', 'created_at', 'expires_at', 'status']) check(q[k] !== undefined, 'question missing ' + k);
  for (const item of q.questions || []) {
    for (const k of ['id', 'question', 'options', 'multi_select']) check(item[k] !== undefined, 'question item missing ' + k);
    check(typeof item.multi_select === 'boolean', 'multi_select expected boolean');
    check(Array.isArray(item.options), 'options expected array');
  }
}
console.log('questions=' + (questions.questions || []).length);

console.log(problems.length ? '\nPROBLEMS:\n - ' + problems.join('\n - ') : '\nOK: JSON shapes match M3 Swift model');
if (problems.length) process.exitCode = 1;
