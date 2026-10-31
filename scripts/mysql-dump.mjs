// Read literal mysqldump INSERTs without executing source SQL or losing escapes.
// Unsafe integers and unsupported expressions fail closed, without echoing data.
const BACKTICK = String.fromCharCode(96);

export function* sqlStatements(sql) {
  let buffer = '', quote = null, lineComment = false, blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (lineComment) {
      if (ch === '\n') { lineComment = false; buffer += '\n'; }
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; buffer += ' '; }
      continue;
    }
    if (quote) {
      buffer += ch;
      if (ch === '\\' && quote !== BACKTICK) {
        if (next === undefined) throw new Error('Unterminated SQL escape');
        buffer += next; i++;
      } else if (ch === quote) {
        if (next === quote) { buffer += next; i++; } else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === BACKTICK) { quote = ch; buffer += ch; }
    else if (ch === '#' || (ch === '-' && next === '-' && /\s|$/.test(sql[i + 2] || ''))) {
      lineComment = true; if (ch === '-') i++;
    } else if (ch === '/' && next === '*') { blockComment = true; i++; }
    else if (ch === ';') { if (buffer.trim()) yield buffer.trim(); buffer = ''; }
    else buffer += ch;
  }
  if (quote || blockComment) throw new Error('Unterminated SQL string or comment');
  if (buffer.trim()) yield buffer.trim();
}

class Cursor {
  constructor(text) { this.text = text; this.i = 0; }
  space() { while (/\s/.test(this.text[this.i] || '') && this.i < this.text.length) this.i++; }
  take(ch) {
    this.space();
    if (this.text[this.i] !== ch) throw new Error('Unexpected SQL syntax at offset ' + this.i);
    this.i++;
  }
  word(expected) {
    this.space();
    const m = this.text.slice(this.i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if (!m || (expected && m[0].toUpperCase() !== expected)) throw new Error('Unexpected SQL keyword at offset ' + this.i);
    this.i += m[0].length; return m[0];
  }
  identifier() {
    this.space();
    if (this.text[this.i] !== BACKTICK) {
      const m = this.text.slice(this.i).match(/^[A-Za-z_$][A-Za-z_$0-9]*/);
      if (!m) throw new Error('Invalid SQL identifier at offset ' + this.i);
      this.i += m[0].length; return m[0];
    }
    this.i++;
    let result = '';
    while (this.i < this.text.length) {
      const ch = this.text[this.i++];
      if (ch !== BACKTICK) result += ch;
      else if (this.text[this.i] === BACKTICK) { result += BACKTICK; this.i++; }
      else return result;
    }
    throw new Error('Unterminated SQL identifier');
  }
  table() {
    let table = this.identifier(); this.space();
    if (this.text[this.i] === '.') { this.i++; table = this.identifier(); }
    return table;
  }
  string() {
    this.space();
    const quote = this.text[this.i++];
    if (quote !== "'" && quote !== '"') throw new Error('Expected SQL string');
    let value = '';
    const escapes = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
    while (this.i < this.text.length) {
      const ch = this.text[this.i++];
      if (ch === quote) {
        if (this.text[this.i] === quote) { value += quote; this.i++; }
        else return value;
      } else if (ch === '\\') {
        if (this.i === this.text.length) throw new Error('Unterminated SQL escape');
        const next = this.text[this.i++];
        value += next === '%' || next === '_' ? '\\' + next : escapes[next] ?? next;
      } else value += ch;
    }
    throw new Error('Unterminated SQL string');
  }
  value() {
    this.space();
    const ch = this.text[this.i];
    if (ch === "'" || ch === '"') return this.string();
    const introducer = this.text.slice(this.i).match(/^_(?:binary|utf8mb4|utf8|latin1)\b\s*/i);
    if (introducer) { this.i += introducer[0].length; return this.string(); }
    const m = this.text.slice(this.i).match(/^[^,\s)]+/);
    if (!m) throw new Error('Missing SQL value at offset ' + this.i);
    const token = m[0]; this.i += token.length;
    if (/^NULL$/i.test(token)) return null;
    if (/^[+-]?\d+$/.test(token)) {
      const value = Number(token);
      if (!Number.isSafeInteger(value)) throw new Error('SQL integer exceeds the safe conversion range');
      return value;
    }
    // Decimal/exponent literals remain exact text rather than binary floating point.
    if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?$/i.test(token)) return token;
    throw new Error('Unsupported SQL value expression at offset ' + (this.i - token.length));
  }
}

function createColumns(statement) {
  const cursor = new Cursor(statement);
  cursor.word('CREATE'); cursor.word('TABLE');
  cursor.space();
  if (/^IF\b/i.test(cursor.text.slice(cursor.i))) { cursor.word('IF'); cursor.word('NOT'); cursor.word('EXISTS'); }
  const name = cursor.table(); cursor.take('(');
  const start = cursor.i;
  let depth = 1, quote = null, segments = [], segmentStart = start;
  for (; cursor.i < statement.length; cursor.i++) {
    const ch = statement[cursor.i], next = statement[cursor.i + 1];
    if (quote) {
      if (ch === '\\' && quote !== BACKTICK) cursor.i++;
      else if (ch === quote) { if (next === quote) cursor.i++; else quote = null; }
    } else if (ch === "'" || ch === '"' || ch === BACKTICK) quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      if (--depth === 0) { segments.push(statement.slice(segmentStart, cursor.i)); break; }
    } else if (ch === ',' && depth === 1) { segments.push(statement.slice(segmentStart, cursor.i)); segmentStart = cursor.i + 1; }
  }
  if (depth !== 0 || quote) throw new Error('Unterminated CREATE TABLE definition');
  const columns = segments.map(s => s.trim()).filter(s => !/^(?:PRIMARY|KEY|UNIQUE|CONSTRAINT|CHECK|FOREIGN|FULLTEXT|SPATIAL)\b/i.test(s))
    .map(s => new Cursor(s).identifier());
  return { name, columns };
}

export function parseMysqlDump(sql, { includeTables } = {}) {
  const allowed = includeTables ? new Set(includeTables) : null;
  const tables = new Map();
  for (const statement of sqlStatements(sql.replace(/^\uFEFF/, ''))) {
    if (/^CREATE\s+TABLE\b/i.test(statement)) {
      const { name, columns } = createColumns(statement);
      if (!allowed || allowed.has(name)) {
        if (tables.has(name)) throw new Error('Duplicate source table definition');
        tables.set(name, { columns, rows: [] });
      }
      continue;
    }
    if (!/^INSERT(?:\s+IGNORE)?\s+INTO\b/i.test(statement)) continue;
    const cursor = new Cursor(statement);
    cursor.word('INSERT'); cursor.space();
    if (/^IGNORE\b/i.test(cursor.text.slice(cursor.i))) cursor.word('IGNORE');
    cursor.word('INTO');
    const name = cursor.table();
    if (allowed && !allowed.has(name)) continue;
    const table = tables.get(name);
    if (!table) throw new Error('INSERT table has no source column definition');
    cursor.space();
    let columns = table.columns;
    if (statement[cursor.i] === '(') {
      columns = []; cursor.i++;
      do {
        columns.push(cursor.identifier()); cursor.space();
        if (statement[cursor.i] !== ',') break;
        cursor.i++;
      } while (true);
      cursor.take(')');
      if (columns.some(c => !table.columns.includes(c)) || new Set(columns).size !== columns.length) throw new Error('Invalid INSERT columns');
    }
    cursor.word('VALUES');
    do {
      cursor.take('(');
      const values = [];
      cursor.space();
      if (statement[cursor.i] !== ')') {
        do {
          values.push(cursor.value()); cursor.space();
          if (statement[cursor.i] !== ',') break;
          cursor.i++;
        } while (true);
      }
      cursor.take(')');
      if (values.length !== columns.length) throw new Error('Source INSERT column count mismatch');
      table.rows.push(Object.fromEntries(columns.map((column, i) => [column, values[i]])));
      cursor.space();
      if (statement[cursor.i] !== ',') break;
      cursor.i++;
    } while (true);
    cursor.space();
    if (cursor.i !== statement.length) throw new Error('Unsupported trailing INSERT clause');
  }
  return tables;
}
