/* Dev workflow logic: Perchance primer, read-only tools for AI, refactoring, edit proposals,
   folder-sync planning and agent hand-off. Pure; no DOM, no network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./project-core.js'));
  else root.WeldDevCore = factory(root.WeldProjectCore);
})(typeof window === 'object' ? window : globalThis, function (P) {
  'use strict';
  const VERSION = 1;
  const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };   // finding severity order, shared by get_findings and the push gate

  // ------------------------------------------------------------------ primer
  // Condensed from Perchance's tutorial and known-bugs list. Given to models so they write
  // Perchance, not generic JavaScript or a guessed dialect.
  const PRIMER = [
    'PERCHANCE REFERENCE (follow it exactly)',
    '',
    'Lists panel (the DSL):',
    '- A list is a name at column 0 with its items indented by one tab or two spaces (never mix them). "//" starts a comment. Names use letters, digits and underscores, are case-sensitive and cannot start with a digit.',
    '- "name = value" is a one-item shorthand. Imports look like: alias = {import:generator-name}.',
    '- [list] picks a random item. Odds: "item ^2", "^1/10", or dynamic "^[x == 1]" (false means never selected).',
    '- Curly shorthand: {a|b|c}, weights {a^3|b}, numbers {1-20}, letters {a-f}, {a} for a/an, {s} for plurals. Inside [square blocks] braces are JavaScript, not shorthand.',
    '- Square blocks hold JavaScript. Commas run several statements and only the last is shown: [a = animal.selectOne, b = a.pluralForm, a]. [x, ""] runs x without showing anything.',
    '- selectOne does not resolve random parts inside the chosen item. To store a selection for reuse write [f = fruit.evaluateItem] and then [f]. A missing .evaluateItem is the most common bug: reusing the variable re-randomizes it.',
    '- A list mentioned before the last statement of a block does nothing: use .evaluateItem or make it last. if/else must be in its own square block.',
    '- Useful: selectMany(n), selectUnique(n), joinItems(", "), consumableList, getLength, pluralForm, singularForm, titleCase, upperCase, pastTense.',
    '- Indented lists inside items are properties; "this" is the parent. "$output = ..." inside a list changes what it prints. A top-level $output is the generator\'s public export for importers. A $meta block sets title, description and tags.',
    '- Functions: "name(args) =>" followed by an indented JavaScript body; "async" is allowed.',
    '',
    'HTML panel:',
    '- An ordinary HTML page. [blocks] are evaluated after scripts run. update() re-runs all blocks, update(el) only those inside el. Element ids become globals and must not equal list names.',
    '- Inputs write variables: oninput="name = this.value" (use Number() for numbers and give the variable a default in the lists panel).',
    '- Never put an HTML tag inside a square block in the HTML panel (write \\u003c instead). In <script type="module"> reach lists as root.listName and plugins as root.alias.',
    '- Do not put {import:...}, \\u{...} or brace/bracket HTML entities inside script code: the template parser still reads them.',
    '',
    'Editing rules:',
    '- Keep existing list names, element ids and $output (other generators may import them). Keep two-space indentation.',
    '- Do not add content filters, refusals or tone changes that were not requested, and match the generator\'s existing register.'
  ].join('\n');

  const PRIMER_SHORT = [
    'Perchance reminders: lists are indented items under a column-0 name; [list] picks randomly; store a pick for reuse with .evaluateItem;',
    'if/else needs its own [block]; keep list names, element ids and $output unchanged; never add HTML tags inside [blocks] in the HTML panel;',
    'do not add content filters or tone changes that were not requested.'
  ].join(' ');

  // ------------------------------------------------------- read-only toolbox
  // One implementation behind three consumers: the AI helper's "investigate" mode, the local
  // agent bridge (MCP), and the tests. getSource() returns { name, dsl, html, deps }.
  const MAX_TEXT = 60000, MAX_LINES = 400;
  function clip(text, n) { text = String(text); return text.length > n ? text.slice(0, n) + '\n… [truncated ' + (text.length - n) + ' characters]' : text; }
  function num(v, d) { v = Math.floor(Number(v)); return isFinite(v) ? v : d; }
  function paneText(src, pane) {
    if (pane === 'html') { if (src.html == null) throw new Error('The HTML panel is not loaded.'); return String(src.html); }
    return String(src.dsl);
  }
  function numbered(text, start, end) {
    const lines = P.lines(text), total = lines.length;
    const from = Math.max(1, Math.min(total, num(start, 1))), to = Math.max(from, Math.min(total, num(end, from + MAX_LINES - 1)));
    const cap = Math.min(to, from + MAX_LINES - 1);
    let body = lines.slice(from - 1, cap).map((l, i) => (from + i) + ': ' + l).join('\n');
    body = clip(body, MAX_TEXT);
    return { total_lines: total, start_line: from, end_line: cap, text: body, more: cap < to || cap < total };
  }
  function makeToolbox(getSource) {
    const src = () => { const s = getSource(); if (!s || s.dsl == null) throw new Error('No generator is loaded.'); return s; };
    const analysisOf = s => P.analyze({ name: s.name, dsl: s.dsl, html: s.html, deps: s.deps || null });
    const tools = {
      get_primer: () => PRIMER,
      get_outline: () => {
        const a = analysisOf(src());
        return { lists: a.lists.map(l => ({ name: l.name, line: l.line, items: l.items, import: l.imported ? (l.alias || true) : undefined })), functions: a.functions, imports: a.imports,
          distinct_outputs: a.outputSpace ? a.outputSpace.text : null, stats: a.stats };
      },
      get_findings: args => {
        const a = analysisOf(src()), rank = SEVERITY_RANK, max = rank[(args && args.min_severity) || 'warn'];
        const list = a.findings.filter(f => rank[f.severity] <= (max == null ? 1 : max));
        return { counts: a.counts, findings: list.slice(0, 60).map(f => ({ severity: f.severity, pane: f.pane, line: f.line, message: f.message, hint: f.hint || undefined })), truncated: list.length > 60 };
      },
      get_lines: args => {
        const s = src(), pane = (args && args.pane) === 'html' ? 'html' : 'dsl';
        const r = numbered(paneText(s, pane), args && args.start, args && args.end);
        return Object.assign({ pane }, r);
      },
      get_source: args => {
        const s = src(), want = (args && args.pane) || 'both';
        if (want === 'both') return { dsl: tools.get_lines({ pane: 'dsl', start: args && args.start_line, end: args && args.end_line }), html: s.html == null ? null : tools.get_lines({ pane: 'html', start: args && args.start_line, end: args && args.end_line }) };
        return tools.get_lines({ pane: want, start: args && args.start_line, end: args && args.end_line });
      },
      search: args => {
        const s = src(), q = String((args && args.query) || '').toLowerCase();
        if (!q) throw new Error('query is required');
        const out = [];
        [['dsl', s.dsl], ['html', s.html]].forEach(([pane, text]) => {
          if (text == null || (args && args.pane && args.pane !== pane)) return;
          const ls = P.lines(text);
          for (let i = 0; i < ls.length && out.length < 80; i++) if (ls[i].toLowerCase().includes(q)) out.push({ pane, line: i + 1, text: ls[i].trim().slice(0, 200) });
        });
        return { matches: out, truncated: out.length >= 80 };
      },
      find_usages: args => {
        const name = String((args && args.name) || '');
        if (!validName(name)) return { name: args && args.name, error: '"' + name + '" is not a valid list name.', uses: [], count: 0, truncated: false };
        const s = src(), r = scanName(s.dsl, s.html, name, null);
        return { name: args && args.name, uses: r.hits.slice(0, 100), count: r.hits.length, truncated: r.hits.length > 100 };
      },
      get_imports: () => {
        const s = src(), a = analysisOf(s);
        if (!s.deps) return { imports: a.imports, note: 'The import tree is not loaded. Names only.' };
        const st = P.dependencyStats(s.deps, s.name);
        return { imports: a.imports, pulled_in: st.names.map(n => ({ name: n, bytes: s.deps.nodes[n] ? s.deps.nodes[n].bytes : 0 })), total_bytes: st.bytes, unfound: s.deps.unfound };
      },
      get_html_map: () => { const s = src(); if (s.html == null) throw new Error('The HTML panel is not loaded.'); return P.htmlMap(s.html); }
    };
    return {
      tools, names: Object.keys(tools),
      call(name, args) {
        if (!Object.prototype.hasOwnProperty.call(tools, name)) throw new Error('Unknown tool: ' + name);
        return tools[name](args || {});
      }
    };
  }

  // -------------------------------------------- "investigate" protocol for any model
  // Works with every provider (even local models without native tool calling): the model asks
  // for read-only lookups in a fenced weld-tool block, Weld answers, the model continues.
  const INVESTIGATE_TOOLS = [
    ['get_outline', 'no args: lists with item counts, functions, imports'],
    ['get_findings', '{"min_severity":"warn"|"info"}: automatic findings'],
    ['get_lines', '{"pane":"dsl"|"html","start":1,"end":60}: numbered source lines (max 400 per call)'],
    ['search', '{"query":"text","pane":"dsl"|"html"}: matching lines'],
    ['find_usages', '{"name":"listName"}: every definition and use of a name'],
    ['get_imports', 'no args: imported generators and sizes'],
    ['get_html_map', 'no args: structure of the HTML panel (ids, functions, root.* use)']
  ];
  const INVESTIGATE_PROTOCOL = [
    'You may look things up before answering. To run lookups reply with ONLY one or more fenced blocks, each holding one JSON request:',
    '```weld-tool',
    '{"tool":"get_lines","args":{"pane":"dsl","start":1,"end":40}}',
    '```',
    'Weld runs them (read-only) and replies with the results, then you continue. Available tools:',
    INVESTIGATE_TOOLS.map(t => '- ' + t[0] + ' ' + t[1]).join('\n'),
    'When you have enough information, give your final answer with no weld-tool block. You can never change anything with these tools.'
  ].join('\n');
  function parseToolCalls(reply) {
    const calls = [], errors = [], re = /```weld-tool[^\n]*\n([\s\S]*?)```/g; let m;
    while ((m = re.exec(String(reply || '')))) {
      try {
        const j = JSON.parse(m[1].trim());
        if (!j || typeof j.tool !== 'string') throw new Error('missing "tool"');
        calls.push({ tool: j.tool, args: (j.args && typeof j.args === 'object') ? j.args : {} });
      } catch (e) { errors.push('Could not read a weld-tool block: ' + e.message); }
    }
    return { calls: calls.slice(0, 6), errors };
  }
  function formatToolResults(results) {
    return results.map(r => 'RESULT of ' + r.tool + ' ' + JSON.stringify(r.args) + ':\n' + (r.error ? 'ERROR: ' + r.error : clip(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 1), 14000))).join('\n\n');
  }
  // ask(system, user) -> Promise<string>. Never calls a tool outside INVESTIGATE_TOOLS.
  async function investigate(o) {
    const allowed = new Set(INVESTIGATE_TOOLS.map(t => t[0])), maxRounds = o.maxRounds || 4, steps = [];
    const system = o.system + '\n\n' + INVESTIGATE_PROTOCOL;
    let transcript = o.user, reply = '';
    for (let round = 0; round <= maxRounds; round++) {
      if (o.isCancelled && o.isCancelled()) throw new Error('Stopped.');
      reply = await o.ask(system, transcript);
      const { calls, errors } = parseToolCalls(reply);
      if (!calls.length && !errors.length) return { reply, steps };
      if (round === maxRounds) return { reply: reply.replace(/```weld-tool[\s\S]*?```/g, '').trim() || 'The model kept asking for lookups. Ask a narrower question.', steps, exhausted: true };
      const results = calls.map(c => {
        if (!allowed.has(c.tool)) return { tool: c.tool, args: c.args, error: 'Tool not available' };
        try { return { tool: c.tool, args: c.args, result: o.toolbox.call(c.tool, c.args) }; } catch (e) { return { tool: c.tool, args: c.args, error: e.message }; }
      });
      errors.forEach(e => results.push({ tool: 'parse', args: {}, error: e }));
      steps.push(results.map(r => r.tool + (r.error ? ' (error)' : '')).join(', '));
      if (o.onStep) o.onStep(steps[steps.length - 1]);
      transcript += '\n\nYOUR PREVIOUS REPLY:\n' + reply + '\n\n' + formatToolResults(results) + '\n\nContinue. Give the final answer when ready.';
    }
    return { reply, steps };
  }

  // --------------------------------------------------- find usages and rename
  const KEYWORDS = new Set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield await async of true false null undefined NaN Infinity root update'.split(' '));
  const ID_START = /[A-Za-z_$]/, ID_PART = /[\w$]/;
  // Replace identifier tokens equal to `old` in a JavaScript-ish fragment, skipping strings, comments,
  // property names after ".", and object keys. Returns { text, count }.
  function replaceIdentifiers(code, old, next) {
    let out = '', i = 0, count = 0, prev = '', braces = 0;
    const n = code.length;
    while (i < n) {
      const c = code[i];
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1; while (j < n && code[j] !== c) { if (code[j] === '\\') j++; j++; }
        out += code.slice(i, j + 1); i = j + 1; prev = '"'; continue;
      }
      if (c === '/' && code[i + 1] === '/') { const e = code.indexOf('\n', i); const j = e === -1 ? n : e; out += code.slice(i, j); i = j; continue; }
      if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); const j = e === -1 ? n : e + 2; out += code.slice(i, j); i = j; continue; }
      if (ID_START.test(c)) {
        let j = i + 1; while (j < n && ID_PART.test(code[j])) j++;
        const id = code.slice(i, j), rest = code.slice(j);
        const isKey = braces > 0 && (prev === '{' || prev === ',') && /^\s*:/.test(rest);
        if (id === old && prev !== '.' && !isKey) { out += next; count++; } else out += id;
        prev = 'a'; i = j; continue;
      }
      if (/\d/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(code[j])) j++; out += code.slice(i, j); i = j; prev = '0'; continue; }
      if (c === '{') braces++; else if (c === '}') braces--;
      if (!/\s/.test(c)) prev = c;
      out += c; i++;
    }
    return { text: out, count };
  }
  function validName(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name); }
  function mapBlocks(body, old, next) {
    // Rewrites identifiers inside every top-level [square block] of a line body.
    const sq = P.squareBlocks(body); let out = '', last = 0, count = 0;
    sq.blocks.forEach(b => {
      const r = replaceIdentifiers(b.content, old, next);
      out += body.slice(last, b.start + 1) + r.text; last = b.end; count += r.count;
    });
    return { text: out + body.slice(last), count };
  }
  // The single traversal behind both "find usages" and "rename". next === null only collects hits.
  function scanName(dsl, html, old, next, opts) {
    opts = opts || {};
    const hits = [], dslLines = P.lines(dsl), htmlLines = html == null ? null : P.lines(html);
    const parsed = P.parseDsl(dsl), outDsl = dslLines.slice();
    const edit = (pane, lineNo, line, replaced, kind) => {
      if (replaced === line) return line;
      hits.push({ pane, line: lineNo, kind, text: line.trim().slice(0, 160), after: replaced.trim().slice(0, 160) });
      return replaced;
    };
    const note = (pane, lineNo, line, kind) => hits.push({ pane, line: lineNo, kind, text: line.trim().slice(0, 160) });
    const want = next != null;
    // lists panel
    parsed.nodes.forEach(n => {
      const idx = n.line - 1, raw = dslLines[idx];
      if (n.kind === 'comment') return;
      const indent = raw.length - raw.replace(/^[\t ]+/, '').length, body = raw.slice(indent);
      if ((n.kind === 'list' || n.kind === 'assign' || n.kind === 'function') && n.top && n.name === old) {
        const rest = body.slice(old.length);
        if (want) outDsl[idx] = edit('dsl', n.line, raw, raw.slice(0, indent) + next + rest, 'definition'); else note('dsl', n.line, raw, 'definition');
      }
      if (n.kind === 'function') {
        if (n.name !== old || !n.top) { /* function header parameters are not references */ }
        n.codeLines.forEach(cl => {
          const cr = dslLines[cl - 1], r = replaceIdentifiers(cr, old, want ? next : old);
          if (r.count) { if (want) outDsl[cl - 1] = edit('dsl', cl, cr, r.text, 'code'); else note('dsl', cl, cr, 'code'); }
        });
        // inline body after "=>"
        const arrow = body.indexOf('=>');
        if (arrow !== -1 && n.value) {
          const head = body.slice(0, arrow + 2), tail = body.slice(arrow + 2), r = replaceIdentifiers(tail, old, want ? next : old);
          if (r.count) { if (want) outDsl[idx] = edit('dsl', n.line, outDsl[idx], raw.slice(0, indent) + head + r.text, 'code'); else note('dsl', n.line, raw, 'code'); }
        }
        return;
      }
      if (n.kind === 'item' || n.kind === 'assign' || (n.kind === 'special' && n.name === '$output')) {
        const cur = want ? outDsl[idx] : raw, curBody = cur.slice(indent);
        const r = mapBlocks(curBody, old, want ? next : old);
        if (r.count) { if (want) outDsl[idx] = edit('dsl', n.line, cur, raw.slice(0, indent) + r.text, 'reference'); else note('dsl', n.line, raw, 'reference'); }
      }
    });
    // HTML panel
    let outHtml = html;
    if (htmlLines) {
      const reg = htmlRegionsFor(html), out = htmlLines.slice();
      // markup: square blocks outside script/style
      const maskedLines = P.lines(reg.masked);
      maskedLines.forEach((ml, i) => {
        if (ml.indexOf('[') === -1) return;
        const orig = htmlLines[i], sq = P.squareBlocks(ml);
        if (!sq.blocks.length) return;
        let res = '', last = 0, cnt = 0;
        sq.blocks.forEach(b => { const r = replaceIdentifiers(b.content, old, want ? next : old); res += orig.slice(last, b.start + 1) + r.text; last = b.end; cnt += r.count; });
        if (cnt) { if (want) out[i] = edit('html', i + 1, orig, res + orig.slice(last), 'reference'); else note('html', i + 1, orig, 'reference'); }
      });
      // scripts: root.old always; bare identifiers only when allowed
      reg.scripts.forEach(s => {
        if (!/^(|text\/javascript|application\/javascript|module)$/.test(s.type)) return;
        const startLine = s.line, codeLines = P.lines(s.code), lastK = codeLines.length - 1;
        codeLines.forEach((cl, k) => {
          const lineNo = startLine + k, cur = want ? out[lineNo - 1] : htmlLines[lineNo - 1];
          if (cur == null) return;
          // Only the part inside the script: the first line may carry the <script> tag, the last the </script>.
          let from = 0, to = cur.length;
          if (k === 0) { const tag = /<script\b[^>]*>/gi; let t, end = 0; while ((t = tag.exec(cur))) end = t.index + t[0].length; from = end; }
          if (k === lastK) { const e = cur.toLowerCase().indexOf('</script', from); if (e !== -1) to = e; }
          const mid = cur.slice(from, to), target = want ? next : old;
          let r = mid.replace(new RegExp('(\\broot\\s*\\.\\s*)' + old + '(?![\\w$])', 'g'), (m0, p1) => p1 + target)
            .replace(new RegExp('(\\broot\\s*\\[\\s*)(["\'])' + old + '\\2(\\s*\\])', 'g'), (m0, p1, q, p2) => p1 + q + target + q + p2);
          let changed = new RegExp('\\broot\\s*\\.\\s*' + old + '(?![\\w$])').test(mid) || new RegExp('\\broot\\s*\\[\\s*["\']' + old + '["\']').test(mid);
          if (opts.scriptBare !== false) {
            const rb = replaceIdentifiers(r, old, target);
            if (rb.count) { r = rb.text; changed = true; }
          }
          if (changed) {
            const rebuilt = cur.slice(0, from) + r + cur.slice(to);
            if (want) { if (rebuilt !== cur) out[lineNo - 1] = edit('html', lineNo, cur, rebuilt, 'code'); } else note('html', lineNo, cur, 'code');
          }
        });
      });
      // inline handlers
      const attrRe = /(\son[a-z]+\s*=\s*)("([^"]*)"|'([^']*)')/gi;
      reg.masked.split('\n').forEach((ml, i) => {
        if (!/\son[a-z]+\s*=/i.test(ml)) return;
        const cur = want ? out[i] : htmlLines[i];
        let touched = false;
        const res = cur.replace(attrRe, (m0, pre, q, d1, d2) => {
          const val = d1 != null ? d1 : d2, r = replaceIdentifiers(val, old, want ? next : old);
          if (!r.count) return m0; touched = true; const quote = d1 != null ? '"' : "'"; return pre + quote + r.text + quote;
        });
        if (touched) { if (want) { if (res !== cur) out[i] = edit('html', i + 1, cur, res, 'code'); } else note('html', i + 1, cur, 'code'); }
      });
      outHtml = out.join('\n');
    }
    // de-duplicate hits per pane+line+kind
    const seen = new Set(), uniqHits = hits.filter(h => { const k = h.pane + ':' + h.line + ':' + h.kind; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a.pane === b.pane ? 0 : a.pane === 'dsl' ? -1 : 1) || a.line - b.line);
    return { hits: uniqHits, dsl: outDsl.join('\n'), html: outHtml };
  }
  function htmlRegionsFor(html) {
    const scripts = [], re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi; let m, masked = String(html);
    while ((m = re.exec(html))) {
      const bodyStart = m.index + m[0].indexOf('>') + 1, code = m[3], typeM = /\btype\s*=\s*["']?([^\s"'>]+)/i.exec(m[2] || '');
      if (m[1].toLowerCase() === 'script') scripts.push({ start: bodyStart, code, line: P.lineOf(html, bodyStart), type: typeM ? typeM[1].toLowerCase() : '' });
      masked = masked.slice(0, bodyStart) + code.replace(/[^\n]/g, ' ') + masked.slice(bodyStart + code.length);
    }
    return { scripts, masked };
  }
  function findUsages(dsl, html, name) {
    if (!validName(name)) return { error: '"' + name + '" is not a valid list name.', hits: [] };
    return scanName(dsl, html, name, null);
  }
  function rename(dsl, html, oldName, newName, opts) {
    if (!validName(oldName)) return { error: '"' + oldName + '" is not a valid list name.' };
    if (!validName(newName)) return { error: '"' + newName + '" is not a valid name: use letters, digits and underscores, not starting with a digit, and not a JavaScript keyword.' };
    if (oldName === newName) return { error: 'The new name is the same as the old one.' };
    const a = P.analyze({ dsl, html });
    const defined = new Set(a.lists.map(l => l.name).concat(a.functions.map(f => f.name)));
    if (!defined.has(oldName)) return { error: '"' + oldName + '" is not defined as a list, import or function at the top level.' };
    if (defined.has(newName)) return { error: 'A list, import or function named "' + newName + '" already exists.' };
    if (a.html && a.html.ids.indexOf(newName) !== -1) return { error: 'An element in the HTML panel already has the id "' + newName + '".' };
    const r = scanName(dsl, html, oldName, newName, opts);
    const counts = { definition: 0, reference: 0, code: 0 }; r.hits.forEach(h => { counts[h.kind] = (counts[h.kind] || 0) + 1; });
    return { dsl: r.dsl, html: r.html, changes: r.hits, counts, total: r.hits.length };
  }

  // ------------------------------------------------------------ sampling diffs
  function compareSamples(base, cur) {
    const bs = P.sampleStats(base), cs = P.sampleStats(cur);
    if (!bs.n || !cs.n) return { error: 'Both runs need at least one result.' };
    const presence = list => { const m = new Map(); list.forEach(s => { new Set((String(s).toLowerCase().match(/[a-zÀ-ɏ']{3,}/g) || [])).forEach(w => m.set(w, (m.get(w) || 0) + 1)); }); return m; };
    const bp = presence(base), cp = presence(cur), lost = [], gained = [];
    bp.forEach((c, w) => { if (c / bs.n >= 0.05 && !cp.has(w)) lost.push({ word: w, share: Math.round(100 * c / bs.n) }); });
    cp.forEach((c, w) => { if (c / cs.n >= 0.05 && !bp.has(w)) gained.push({ word: w, share: Math.round(100 * c / cs.n) }); });
    lost.sort((a, b) => b.share - a.share); gained.sort((a, b) => b.share - a.share);
    const lines = [];
    const lenChange = (cs.avgLen - bs.avgLen) / Math.max(1, bs.avgLen);
    if (Math.abs(lenChange) >= 0.2) lines.push('Typical length ' + (lenChange > 0 ? 'grew' : 'shrank') + ' by ' + Math.round(Math.abs(lenChange) * 100) + '% (' + bs.avgLen + ' → ' + cs.avgLen + ').');
    const dupDelta = cs.duplicateRate - bs.duplicateRate;
    if (Math.abs(dupDelta) >= 0.1) lines.push('Repeats ' + (dupDelta > 0 ? 'increased' : 'decreased') + ' from ' + Math.round(bs.duplicateRate * 100) + '% to ' + Math.round(cs.duplicateRate * 100) + '%.');
    if (lost.length) lines.push(lost.length + ' common word(s) no longer appear: ' + lost.slice(0, 6).map(w => w.word + ' (' + w.share + '%)').join(', ') + '.');
    if (gained.length) lines.push(gained.length + ' new common word(s): ' + gained.slice(0, 6).map(w => w.word + ' (' + w.share + '%)').join(', ') + '.');
    if (!lines.length) lines.push('No meaningful change in length, variety or vocabulary.');
    return { base: bs, current: cs, lost, gained, lengthChange: lenChange, duplicateDelta: dupDelta, lines, changed: lines.length > 1 || !/^No meaningful/.test(lines[0]) };
  }

  // ------------------------------------------------------------ edit proposals
  const MAX_DOC = 2 * 1048576;
  function norm(text) { return String(text == null ? '' : text).replace(/\r\n?/g, '\n'); }
  // edits: [{ start_line, end_line, text }] replace lines start..end (1-based, inclusive).
  // end_line = start_line - 1 inserts before start_line. Ranges must not overlap.
  function applyLineEdits(text, edits) {
    const lines = norm(text).split('\n');
    if (!Array.isArray(edits) || !edits.length) throw new Error('edits must be a non-empty array.');
    if (edits.length > 200) throw new Error('Too many edits in one proposal.');
    const list = edits.map((e, i) => {
      const s = Math.floor(Number(e.start_line)), en = Math.floor(Number(e.end_line));
      if (!isFinite(s) || !isFinite(en)) throw new Error('Edit ' + (i + 1) + ' needs start_line and end_line numbers.');
      if (s < 1 || s > lines.length + 1) throw new Error('Edit ' + (i + 1) + ': start_line ' + s + ' is outside the document (1-' + (lines.length + 1) + ').');
      if (en < s - 1 || en > lines.length) throw new Error('Edit ' + (i + 1) + ': end_line ' + en + ' is invalid (use ' + (s - 1) + ' to insert before line ' + s + ').');
      return { s, en, text: norm(e.text) };
    }).sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) if (list[i].s <= list[i - 1].en) throw new Error('Edits overlap near line ' + list[i].s + '.');
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], repl = e.text === '' ? [] : e.text.replace(/\n$/, '').split('\n');
      lines.splice(e.s - 1, e.en - e.s + 1, ...repl);
    }
    const out = lines.join('\n');
    if (out.length > MAX_DOC) throw new Error('The result would exceed the size limit.');
    return out;
  }
  function makeProposal(o) {
    const pane = o.pane === 'html' ? 'html' : 'dsl', current = norm(o.current);
    let after;
    if (o.new_text != null && o.edits != null) throw new Error('Send either new_text or edits, not both.');
    if (o.new_text == null && o.edits == null) throw new Error('Send new_text (the whole new panel) or edits (line ranges to replace).');
    if (o.new_text != null) { after = norm(o.new_text); if (after.length > MAX_DOC) throw new Error('new_text exceeds the size limit.'); }
    else after = applyLineEdits(current, o.edits);
    if (after === current) throw new Error('The proposal does not change anything.');
    return { id: o.id, pane, base: P.hash(current), before: current, after, note: String(o.note || '').slice(0, 500), agent: String(o.agent || 'agent').slice(0, 60), createdAt: o.now || Date.now(), status: 'pending' };
  }
  function proposalState(p, currentText) {
    // Is the editor still what the proposal was written against?
    return P.hash(norm(currentText)) === p.base ? 'fresh' : 'stale';
  }

  // ------------------------------------------------------------- folder sync
  function safeSlug(slug) { return /^[A-Za-z0-9_-]{1,100}$/.test(String(slug || '')) ? String(slug) : null; }
  function folderPaths(slug, cfg) {
    const s = safeSlug(slug); if (!s) throw new Error('"' + slug + '" is not a safe folder name.');
    cfg = cfg || {};
    const fill = t => String(t).replace(/\{name\}/g, () => s);
    const dsl = fill(cfg.dslPath || '{name}/{name}-top-panel.txt'), html = fill(cfg.htmlPath || '{name}/{name}-html-panel.html');
    [dsl, html].forEach(p => { if (/(^|\/)\.\.?(\/|$)/.test(p) || /^\/|^[A-Za-z]:|\\/.test(p)) throw new Error('Unsafe path in the folder template: ' + p); });
    return { dsl, html };
  }
  const normForCompare = t => norm(t).replace(/\n+$/, '');
  function same(a, b) { return normForCompare(a) === normForCompare(b); }
  // editor/disk/base: { dsl, html } | null. Returns what changed since the last sync point.
  function syncPlan(editor, disk, base) {
    if (!editor) return { state: 'no-editor' };
    if (!disk || disk.dsl == null) return { state: 'no-disk', action: 'write' };
    const eq = same(editor.dsl, disk.dsl) && (editor.html == null || disk.html == null || same(editor.html, disk.html));
    if (eq) return { state: 'in-sync' };
    if (!base) return { state: 'unknown' };
    const diskSame = same(disk.dsl, base.dsl) && (disk.html == null || base.html == null || same(disk.html, base.html));
    const editorSame = same(editor.dsl, base.dsl) && (editor.html == null || base.html == null || same(editor.html, base.html));
    if (diskSame) return { state: 'editor-ahead' };
    if (editorSame) return { state: 'disk-ahead' };
    return { state: 'conflict' };
  }

  // ----------------------------------------------------------- agent hand-off
  const AGENTS = {
    copilot: { label: 'GitHub Copilot cloud agent', how: 'Assigns the issue to Copilot. The issue instructions specify whether to report findings or make changes.' },
    claude: { label: 'Claude (Claude Code GitHub Action)', how: 'Comments "@claude ..." on the issue. Needs the Claude GitHub app/action in the repo.' },
    codex: { label: 'Codex cloud', how: 'Comments "@codex ..." on the issue. Needs Codex cloud connected to the repo.' },
    plain: { label: 'Plain issue (no agent)', how: 'Just creates the issue.' }
  };
  function oneLine(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function agentTaskMode(request, mode) {
    mode = mode || 'auto';
    if (!['auto', 'analysis', 'change'].includes(mode)) throw new Error('Choose a valid task mode.');
    if (mode !== 'auto') return mode;
    const req = String(request || '').trim();
    // Uncertain requests stay read-only; the user can explicitly choose Change code.
    if (/\bread[ -]only\b|\b(?:do not|don't|without)\s+(?:edit(?:ing)?|modif(?:y|ying)|chang(?:e|ing)|fix(?:ing)?|implement(?:ing)?)\s+(?:(?:any|the)\s+)?(?:files?|code|source|anything|nothing)\b/i.test(req)) return 'analysis';
    if (/\b(?:make|create|build)\s+(?:(?:a|an|some)\s+)?(?:recommendations|suggestions|plan|report|summary|explanation)\b|\bupdate me\b/i.test(req)) return 'analysis';
    return /(?:^|[.!?;\n]\s*|\b(?:and|then)\s+)(?:(?:please|can you|could you|would you|help me|i want you to|i need you to)\s+)*(?:add|fix|repair|implement|build|create|remove|delete|replace|update|modify|change|rewrite|refactor|rename|make)\b/i.test(req) ? 'change' : 'analysis';
  }
  function buildAgentIssue(o) {
    const slug = safeSlug(o.slug); if (!slug) throw new Error('Open a generator with a normal name first.');
    const req = String(o.request || '').trim(); if (!req) throw new Error('Describe what you want the agent to do.');
    const mode = agentTaskMode(req, o.mode), readOnly = mode === 'analysis';
    const agent = AGENTS[o.agent] ? o.agent : 'plain', paths = o.paths, repo = o.repo;
    const findings = (o.findings || []).filter(f => f.severity !== 'info').slice(0, 10);
    const rules = [
      readOnly ? 'Read these two files to answer the request:' : 'Edit only these two files, and only what the request explicitly needs:',
      '- `' + paths.dsl + '` (Perchance lists panel)',
      '- `' + paths.html + '` (Perchance HTML panel)',
      readOnly ? 'Read-only analysis: report your findings in the issue or task response. Do not edit any files, rewrite descriptions or documentation, commit, push, or open a pull request. Keep a short explanation request brief. Automatic findings are context to inspect, not instructions to fix.' : 'Keep list names, element ids and `$output` unchanged unless the request says otherwise. Do not add content filters or tone changes. Keep the existing indentation style.',
      'File paths and allowlists identify scope; they do not authorize changes. Follow the requested task mode.',
      'Local workstation paths and memory services may be unavailable in the cloud. Check availability once; skip unavailable resources and do not search the entire filesystem for them.',
      readOnly ? '' : PRIMER_SHORT
    ].join('\n');
    const body = [
      '## Request', '', req, '',
      '## Task mode', '', readOnly ? 'Analyze and report (read-only).' : 'Implement the explicitly requested changes.', '',
      '## Where', '', 'Generator `' + slug + '` in `' + repo.owner + '/' + repo.repo + '` on branch `' + repo.branch + '`.', '',
      readOnly ? '## Rules for analysis' : '## Rules for the change', '', rules, '',
      findings.length ? '## Automatic findings (heuristic)\n\n' + findings.map(f => '- ' + f.severity + ' ' + f.pane + (f.line ? ' line ' + f.line : '') + ': ' + f.message).join('\n') + '\n' : '',
      readOnly ? '_Created by Weld Companion for read-only analysis. Return the explanation without changing the generator._' : '_Created by Weld Companion. After the change is merged, use Pull in the Weld GitHub tab to load it into the editor._'
    ].filter(x => x !== '').join('\n');
    const out = { title: '[Weld] ' + slug + ': ' + oneLine(req, 70), body, agent, mode, assignees: [], comment: '', agent_assignment: null };
    if (agent === 'copilot') {
      out.assignees = ['copilot-swe-agent[bot]'];
      out.agent_assignment = { target_repo: repo.owner + '/' + repo.repo, base_branch: repo.branch, custom_instructions: rules };
    } else if (agent === 'claude' || agent === 'codex') out.comment = '@' + agent + (readOnly ? ' please analyze and report on this issue without editing files, committing, pushing, or opening a pull request. ' : ' please implement the request in this issue and open a pull request. ') + oneLine(req, 300);
    return out;
  }
  function pushBranchName(slug, when) {
    const d = new Date(when || Date.now()), p = n => String(n).padStart(2, '0');
    return 'weld/' + (safeSlug(slug) || 'generator') + '-' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes());
  }

  // ------------------------------------------------------------- push gate
  function gateReport(analysis, level) {
    const rank = SEVERITY_RANK, max = rank[level || 'warn'];
    const list = analysis.findings.filter(f => rank[f.severity] <= max);
    return { count: list.length, lines: list.slice(0, 6).map(f => '• ' + f.pane + (f.line ? ' line ' + f.line : '') + ': ' + f.message), more: Math.max(0, list.length - 6) };
  }

  // --------------------------------------------------- bridge tool definitions
  const paneEnum = { type: 'string', enum: ['dsl', 'html'], description: 'dsl = the lists panel, html = the HTML panel' };
  const BRIDGE_TOOLS = [
    { name: 'weld_status', description: 'Which Weld tab(s) are connected, which generator each has open, and whether its editor is open (writable) or not.', inputSchema: { type: 'object', properties: {} }, readOnly: true },
    { name: 'weld_get_primer', description: 'Perchance syntax reference and editing rules. Read this before writing Perchance code.', inputSchema: { type: 'object', properties: {} }, readOnly: true, run: 'get_primer' },
    { name: 'weld_get_source', description: 'Read the open generator\'s source with line numbers (live editor contents, including unsaved edits). Reads up to 400 lines per call; use start_line/end_line for more.', inputSchema: { type: 'object', properties: { pane: { type: 'string', enum: ['dsl', 'html', 'both'] }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } } }, readOnly: true, run: 'get_source' },
    { name: 'weld_get_findings', description: 'Automatic findings for the open generator (undefined names, silent no-ops, re-randomizing stored selections, id collisions, ...). Heuristic: verify before acting.', inputSchema: { type: 'object', properties: { min_severity: { type: 'string', enum: ['error', 'warn', 'info'] } } }, readOnly: true, run: 'get_findings' },
    { name: 'weld_get_outline', description: 'Lists with item counts, functions, imports and an estimate of how many distinct outputs the generator can make.', inputSchema: { type: 'object', properties: {} }, readOnly: true, run: 'get_outline' },
    { name: 'weld_find_usages', description: 'Every definition and use of a list/function name across both panels.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, readOnly: true, run: 'find_usages' },
    { name: 'weld_search', description: 'Case-insensitive text search across the panels.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, pane: paneEnum }, required: ['query'] }, readOnly: true, run: 'search' },
    { name: 'weld_get_imports', description: 'Imported generators and their sizes (full tree only if it has been loaded in Weld).', inputSchema: { type: 'object', properties: {} }, readOnly: true, run: 'get_imports' },
    { name: 'weld_get_html_map', description: 'Structure of the HTML panel: element ids, functions, root.* use, storage, hosts. Useful when the panel is too big to read.', inputSchema: { type: 'object', properties: {} }, readOnly: true, run: 'get_html_map' },
    { name: 'weld_sample', description: 'Re-roll the generator through its own update() and return the results plus variety statistics. Only runs when the user has the generator open in Weld; may be refused for chat/AI generators.', inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 5, maximum: 100 } } }, readOnly: true },
    { name: 'weld_propose_edit', description: 'Propose a change to one panel. NOTHING is applied: the user reviews a diff in Weld and accepts or rejects it. Send either new_text (the complete new panel) or edits (line ranges to replace; end_line = start_line-1 inserts). The editor must be open.', inputSchema: { type: 'object', properties: { pane: paneEnum, new_text: { type: 'string' }, edits: { type: 'array', items: { type: 'object', properties: { start_line: { type: 'integer' }, end_line: { type: 'integer' }, text: { type: 'string' } }, required: ['start_line', 'end_line', 'text'] } }, note: { type: 'string', description: 'Why, in one or two sentences, shown to the user.' } }, required: ['pane'] }, readOnly: false },
    { name: 'weld_proposal_status', description: 'Check a proposal: pending, applied, rejected or stale.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, readOnly: true }
  ];

  return {
    VERSION, PRIMER, PRIMER_SHORT, INVESTIGATE_TOOLS, INVESTIGATE_PROTOCOL, BRIDGE_TOOLS, AGENTS,
    makeToolbox, parseToolCalls, formatToolResults, investigate,
    findUsages, rename, replaceIdentifiers, validName, compareSamples,
    applyLineEdits, makeProposal, proposalState,
    safeSlug, folderPaths, syncPlan, normForCompare,
    agentTaskMode, buildAgentIssue, pushBranchName, gateReport
  };
});
