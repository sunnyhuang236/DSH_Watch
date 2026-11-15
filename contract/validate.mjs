// 极简 JSON Schema 子集校验器（零依赖）——只覆盖本仓库契约用到的关键字。
// 支持: type(字符串/数组) const enum required properties additionalProperties items anyOf oneOf
//       minLength maxLength minimum maximum pattern
export function validate(schema, value, path = '$') {
  const errors = [];
  walk(schema, value, path, errors);
  return errors;
}

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function walk(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.const !== undefined && value !== schema.const) errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` });
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const k = kindOf(value);
    const ok = types.some((t) => t === k || (t === 'number' && k === 'integer'));
    if (!ok) { errors.push({ path, message: `expected type ${types.join('|')}, got ${k}` }); return; }
  }
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(s, value, path));
    if (!results.some((r) => r.length === 0)) errors.push({ path, message: 'does not match anyOf' });
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validate(s, value, path).length === 0).length;
    if (matches !== 1) errors.push({ path, message: 'does not match exactly one oneOf' });
  }
  if (kindOf(value) === 'object') {
    for (const key of schema.required || []) if (!(key in value)) errors.push({ path: path + '.' + key, message: 'required' });
    for (const [key, sub] of Object.entries(schema.properties || {})) if (key in value) walk(sub, value[key], path + '.' + key, errors);
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push({ path: path + '.' + key, message: 'additional property not allowed' });
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) walk(schema.additionalProperties, value[key], path + '.' + key, errors);
    }
  }
  if (kindOf(value) === 'array' && schema.items) value.forEach((item, i) => walk(schema.items, item, path + '[' + i + ']', errors));
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push({ path, message: 'minLength' });
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push({ path, message: 'maxLength' });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: 'pattern' });
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push({ path, message: 'minimum' });
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push({ path, message: 'maximum' });
  }
}

export function assertValid(schema, value, label = 'value') {
  const errors = validate(schema, value);
  if (errors.length) {
    const detail = errors.slice(0, 8).map((e) => e.path + ': ' + e.message).join('; ');
    throw new Error(label + ' 不符合契约: ' + detail);
  }
}
