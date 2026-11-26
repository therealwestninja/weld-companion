/* Snippets & Skills catalog: a file-tree of two node kinds.
     - code  : Perchance boilerplate that drops into the matching editor pane at the cursor.
     - skill : a ready-to-send prompt that loads into the AI Helper's input (for a chat model
               that cannot use agents: single-shot or multi-run prompts).
   Pure data + tree helpers: no DOM, network or storage. The UI (snippets-ui) and the monolith
   render this tree; the monolith's menu commands look code nodes up by id. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./snippets-skills.js'));
  else root.WeldSnippetsCore = factory(root.WeldSnippetsSkills || { RULES: [], METHODS: [] });
})(typeof window === 'object' ? window : globalThis, function (SKILLS) {
  'use strict';
  const VERSION = 1;

  // ---- code snippets (inserted at the editor cursor; unchanged from the classic Snippets tab) ----
  const CODE = {
    dsl: [
      { id: 'meta', name: '$meta block', desc: 'title / description / tags',
        text: ['$meta', '  title = ', '  description = ', '  tags = ', ''].join('\n') },
      { id: 'imports-core', name: 'Core plugin imports', desc: 'ai-text, text-to-image, upload, super-fetch',
        text: ['aiTextPlugin      = {import:ai-text-plugin}', 'textToImagePlugin = {import:text-to-image-plugin}', 'uploadPlugin      = {import:upload-plugin}', 'superFetch        = {import:super-fetch-plugin}', ''].join('\n') },
      { id: 'imports-weld', name: 'Weld import stack', desc: 'common weld-* plugins',
        text: ['weldUi       = {import:weld-ui-plugin}', 'weldState    = {import:weld-state-plugin}', 'weldToast    = {import:weld-toast-plugin}', 'weldStream   = {import:weld-stream-plugin}', 'weldMarkdown = {import:weld-markdown-plugin}', ''].join('\n') },
      { id: 'import-superfetch', name: 'super-fetch import', desc: 'CORS proxy plugin only',
        text: 'superFetch = {import:super-fetch-plugin}\n' },
      { id: 'meta-dynamic', name: '$meta.dynamic', desc: 'self-contained dynamic title/description',
        text: ['$meta', '  header', '    mode = minimal', '  async dynamic(inputs) =>', '    // must be fully self-contained -- no root.*, no external globals', '    return { title: "...", description: "..." }', ''].join('\n') },
      { id: 'imports-data', name: 'Data / persistence imports', desc: 'kv, remember, url-params',
        text: ['kv        = {import:kv-plugin}', 'remember  = {import:remember-plugin}', 'urlParams = {import:url-params-plugin}', ''].join('\n') }
    ],
    html: [
      { id: 'grab', name: 'grab() helper', desc: 'defensive plugin access (Proxy-safe)',
        text: ['// defensive plugin access -- handles Proxy miss + load race', 'function grab(name) {', '  try { if (typeof root !== "undefined" && root[name] !== undefined) return root[name]; } catch (e) {}', '  try { if (window[name] !== undefined) return window[name]; } catch (e) {}', '  return undefined;', '}', ''].join('\n') },
      { id: 'ai-call', name: 'aiTextPlugin call', desc: 'non-streaming generation',
        text: ['const result = await root.aiTextPlugin({', '  instruction:   "System prompt / task",', '  startWith:     "",', '  stopSequences: ["\\n\\n[[", "\\n[["],', '  hideStartWith: true', '});', 'const text = String(result);            // boxed String -> primitive', 'if (result.stopReason === "error") { /* generatedText is "" */ }', ''].join('\n') },
      { id: 'ai-stream', name: 'aiTextPlugin stream', desc: 'streaming with onChunk',
        text: ['const stream = root.aiTextPlugin({', '  instruction: "...",', '  stopSequences: ["\\n\\n[[", "\\n[["],', '  hideStartWith: true,', '  onChunk: function (o) {', '    if (o.isFromStartWith) return;', '    /* o.textChunk, o.fullTextSoFar */', '  }', '});', 'const result = await stream;            // stream.stop() to abort', 'const text = String(result);', ''].join('\n') },
      { id: 'superfetch-call', name: 'superFetch call', desc: 'CORS-bypass fetch (auth in URL)',
        text: ['// auth via URL params -- custom headers are stripped by the proxy', 'const r = await root.superFetch("https://api.example.com/data?_=" + Date.now());', 'const text = await r.text();', ''].join('\n') },
      { id: 't2i-call', name: 'textToImagePlugin call', desc: 'image gen (await -> dataUrl)',
        text: ['// resolution MUST be one of: 512x512, 512x768, 768x512, 768x768 (others give a 0x0 canvas).', '// weights: use parens like (red:1.5) -- square brackets are eaten by the DSL layer.', '// an empty or inline-only prompt HANGS forever -- always pass real description text.', 'const result = root.textToImagePlugin({', '  prompt:        "a red apple on a wooden table",', '  resolution:    "768x768",', '  guidanceScale: 7', '});', 'const data = await result;        // resolves with canvas, dataUrl, inputs (no iframe key)', 'img.src = String(data.dataUrl);   // String() any boxed values before use', ''].join('\n') },
      { id: 'upload-call', name: 'uploadPlugin call', desc: 'upload a blob (url is boxed)',
        text: ['// result.url is a BOXED String -- always String() it before compare/use.', 'const result = await root.uploadPlugin(blob);     // blob up to 5 MB', 'if (result.error) {', '  // "disallowed_content" -> make the description explicitly state the subject is 18+', '} else {', '  const url = String(result.url);', '  // result.deletionUrl (undocumented): GET it to permanently delete the upload.', '}', ''].join('\n') },
      { id: 'image-hint', name: '<image> tag hint', desc: 'reliably trigger image output',
        text: ['// The model emits images reliably only when told about the tag (see skill section 17).', 'const IMAGE_TAG_HINT =', '  "You can embed an AI-generated image using this exact syntax: " +', '  "<image>a detailed description of the scene</image> -- the text inside the tag is " +', '  "used to generate a real image. Use it when the user asks for one or it would help.";', '// Append IMAGE_TAG_HINT to your aiTextPlugin instruction when images should be available.', ''].join('\n') },
      { id: 'kv-usage', name: 'kv-plugin usage', desc: 'durable async key-value store',
        text: ['// kv-plugin: durable async key-value store. Import kv-plugin in the DSL panel first.', '// Each store name is its own IndexedDB; data persists across reloads.', 'await kv.scores.set("user42", { score: 100, level: 3 });', 'const rec = await kv.scores.get("user42");   // the stored value, or undefined', 'const all = await kv.scores.entries();        // [[key, value], ...]', '// also: .has(key) .keys() .values() .delete(key) .update(key, fn) .clear()', ''].join('\n') }
    ]
  };

  // ---- AI-Helper skill prompts (loaded into the AI Helper input; the model single-shots or
  //      multi-runs them). RULES = the user's working disciplines; METHODS = adapted techniques.
  //      Populated by the build from the authored catalog below. ----
  const RULES = (SKILLS && Array.isArray(SKILLS.RULES)) ? SKILLS.RULES : [];       // the user's working-discipline prompts
  const METHODS = (SKILLS && Array.isArray(SKILLS.METHODS)) ? SKILLS.METHODS : []; // AI-method prompts adapted for Perchance

  const codeNode = n => ({ kind: 'code', id: n.id, name: n.name, desc: n.desc, pane: n.pane, text: n.text });
  const skillNode = s => ({ kind: 'skill', id: s.id, name: s.name, desc: s.desc, run: s.run === 'multi' ? 'multi' : 'single', prompt: s.prompt });

  // The full tree: three top folders, code split by pane.
  function tree() {
    return { id: 'root', name: 'Snippets & Skills', children: [
      { id: 'code', name: 'Code snippets', glyph: '\u{1F4C4}', note: 'Boilerplate that drops into the matching editor pane at your cursor (open a generator’s #edit page).', children: [
        { id: 'code-dsl', name: 'DSL — top panel', children: CODE.dsl.map(n => codeNode(Object.assign({ pane: 'dsl' }, n))) },
        { id: 'code-html', name: 'HTML panel — JS', children: CODE.html.map(n => codeNode(Object.assign({ pane: 'html' }, n))) }
      ] },
      { id: 'rules', name: 'Working rules', glyph: '\u{1F4D0}', note: 'Review and build disciplines. Click to load the prompt into the AI Helper, then send it (single-shot) or work it across messages.', children: RULES.map(skillNode) },
      { id: 'methods', name: 'AI methods', glyph: '\u{1F9E0}', note: 'Design, critique and test techniques adapted for Perchance. Click to load into the AI Helper.', children: METHODS.map(skillNode) }
    ] };
  }

  const isFolder = n => n && Array.isArray(n.children);
  // Depth-first walk of every node (folders + leaves).
  function walk(node, out) { out = out || []; out.push(node); if (isFolder(node)) node.children.forEach(c => walk(c, out)); return out; }
  function leaves() { return walk(tree()).filter(n => !isFolder(n) && n.id !== 'root'); }
  function findById(id) { return leaves().find(n => n.id === id) || null; }
  function codeById(id) { const n = findById(id); return (n && n.kind === 'code') ? n : null; }  // used by the monolith menu commands

  // Filter the tree to folders/leaves whose name/desc match a query (case-insensitive). Empty query -> full tree.
  function search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return tree();
    const match = n => (n.name + ' ' + (n.desc || '')).toLowerCase().indexOf(q) !== -1;
    function prune(node) {
      if (!isFolder(node)) return match(node) ? node : null;
      const kids = node.children.map(prune).filter(Boolean);
      return (kids.length || match(node)) ? Object.assign({}, node, { children: kids }) : null;
    }
    return prune(tree()) || { id: 'root', name: 'Snippets & Skills', children: [] };
  }

  function counts() { const l = leaves(); return { code: l.filter(n => n.kind === 'code').length, skill: l.filter(n => n.kind === 'skill').length, total: l.length }; }

  return { VERSION, tree, walk, leaves, findById, codeById, search, counts, isFolder, RULES, METHODS, CODE };
});
