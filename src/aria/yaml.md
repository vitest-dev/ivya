# Minimal YAML parser — design notes

API-compatible subset of the [`yaml`](https://github.com/eemeli/yaml) package
by Eemeli Aro. Clean-room implementation — not a fork — covering only the
narrow YAML subset that aria snapshot templates use, to avoid the full
dependency (~97 KB min).

## Supported subset

- Sequences (`- item`)
- Maps (`key: value`)
- Scalars (plain strings, double-quoted strings, numbers, booleans, null)
- Indentation-based nesting

**Not supported:** anchors, aliases, tags, merge keys, block scalars (`|`, `>`),
single-quoted scalars, flow collections (`[]`, `{}`), multi-document, comments.

## Architecture comparison

### Original: 3-stage pipeline

```
Source string
    │
    ▼
  Lexer (lexer.ts)          character cursor → flat string[] of lexemes
    │
    ▼
  CST Parser (parser.ts)    event-driven state machine (stack + dispatch)
    │                        feeds lexemes one at a time via next()
    ▼
  Composer (compose/*.ts)    shape-preserving tree walk → AST nodes
    │
    ▼
  Document (Scalar / YAMLMap / YAMLSeq)
```

### This implementation: single-pass line-based parser

```
Source string
    │
    ▼
  Split into lines (constructor)
    │
    ▼
  Recursive descent (parseNode / parseSequence / parseMap / ...)
    │  decides structure per-line, builds AST nodes directly
    ▼
  Document (Scalar / YAMLMap / YAMLSeq)
```

## Why the original needs three stages

### The lexer's job: boundary detection

In full YAML, you can't know where a value ends without tracking indentation
context. For example:

```yaml
key: value with: colon
  still part of value
next: key
```

Is `with: colon` a nested map or part of a plain scalar? The answer depends on
indentation — the `:` after `with` isn't at a valid indicator position, so the
entire `value with: colon\nstill part of value` is a single plain scalar.

The lexer resolves this with two variables:

- **`indentValue`** — leading spaces on the current line
- **`indentNext`** — minimum indent for continuation lines (set by block
  indicators like `-`, `:`, `?`)

When the lexer encounters `-` or `:` followed by whitespace, it bumps
`indentNext = indentValue + 1`. Then `continueScalar()` checks whether the
next line's indent >= `indentNext` — if yes, the line is part of the current
scalar; if no, the scalar ends.

This decouples "where tokens end" from "what tokens mean," which also enables
streaming/incremental parsing.

### The CST parser's job: structure from events

The parser receives a flat stream of lexemes (one at a time via `next()`) and
builds a nested CST tree using a **stack-based state machine**:

```ts
parse(source: string): Token[] {
  for (const lexeme of lex(source)) this.next(lexeme)
  return this.end()
}
```

Each `next()` call classifies the lexeme (`seq-item-ind`, `map-value-ind`,
`scalar`, `space`, `newline`, ...) then calls `step()`, which dispatches based
on the top of `this.stack`:

- Stack top is `block-seq` → `blockSequence()` handles `-` items
- Stack top is `block-map` → `blockMap()` handles `key: value` pairs
- Stack top is empty → `stream()` starts a new document

Key mechanic — **retroactive reclassification**: when the parser receives a
plain scalar like `key`, it doesn't know yet if it's a map key or a standalone
value. It provisionally pushes a `FlowScalar`. When the _next_ lexeme is `:`,
`scalar()` retroactively promotes it to a `BlockMap` key. This is necessary
because the parser processes one token at a time without lookahead.

Indent comparison decides push/pop:

- `this.indent > node.indent` → child content, push onto stack
- `this.indent === node.indent` → sibling item
- `this.indent < node.indent` → pop (end of node)

### The composer's job: type conversion

The composer does a shape-preserving recursive walk over the finished CST:

- `BlockMap` → `YAMLMap` with `Pair` items
- `BlockSequence` → `YAMLSeq`
- `FlowScalar` → `Scalar` (with escape processing, type resolution)

No nodes are added, removed, reordered, or re-parented. The tree structure is
identical between CST and AST. The composer extracts props (anchors, tags,
comments) from `start`/`sep` token bags into named fields, and resolves raw
scalar strings into typed values (via schema tags).

## Why our implementation doesn't need the three stages

The supported subset avoids every case that makes the lexer necessary:

- **No multi-line scalars** — each value fits on one line, so line-splitting
  is sufficient for boundary detection
- **No block scalars** (`|`, `>`) — no need for `continueScalar()` or
  `indentNext` tracking
- **No flow collections** (`[]`, `{}`) — no flow-level state machine
- **No retroactive reclassification** — we see the whole line at once, so
  `isMapEntry()` can scan for `: ` before committing to a node type

This means we can collapse all three stages into a single recursive-descent
parser that splits lines, decides structure per-line, and builds AST nodes
directly.

### Why the line-based approach is correct for this subset

The supported subset has a property that makes it structurally simple:

> **Every value fits on a single line, and nesting is signaled solely by
> indentation on subsequent lines.**

This makes the subset **recursive-descent friendly**, much like JSON. Compare
the grammar:

```
node     = sequence | map | scalar
sequence = (INDENT '- ' node NEWLINE)+        at same indent
map      = (INDENT key ': ' value NEWLINE)+   at same indent
scalar   = plain-string | quoted-string | number | boolean | null
```

Each production can be decided by inspecting the current line: does it start
with `- `? Does it contain `: ` (outside quotes)? Otherwise it's a scalar.
Nesting is handled by recursive calls with an increased indent requirement.
This is the same pattern as a JSON parser checking for `[`, `{`, or a literal
to dispatch into `parseArray`, `parseObject`, or `parseValue`.

Full YAML breaks this property — plain scalars can span multiple lines, quoted
strings can contain newlines, block scalars (`|`, `>`) are multi-line by
definition, and flow collections (`[]`, `{}`) introduce non-indentation-based
nesting. These require cross-line state that a simple recursive descent over
lines can't express. Our subset has none of them.

#### Tokenize on the fly and decide

The parser doesn't produce tokens as an intermediate data structure. Instead,
tokenization and structural decision are fused into single string-match
expressions:

```ts
// tokenize (is there a - indicator?) + decide (parse as sequence) — one shot:
if (line.content.startsWith('- ')) return this.parseSequence(line.indent)

// tokenize (find : indicator) + decide (parse as map) — one shot:
if (this.isMapEntry(line.content)) return this.parseMap(line.indent)

// fallthrough — implicitly tokenized as scalar by not matching above:
return this.parseScalarValue(line.content, line.offset, line)
```

In the original, these are separate steps with intermediate data between them:

```
lexer emits '-'          →  data: string '-'
tokenType('-')           →  data: 'seq-item-ind'
blockSequence() matches  →  decision: push BlockSeq
```

There's no intermediate `'seq-item-ind'` value in our implementation. The
`startsWith('- ')` call simultaneously recognizes the indicator and branches
into the sequence path. This is valid because for single-line values, there's
no ambiguity that a token boundary would help resolve — the match _is_ the
decision.

The full set of on-the-fly tokenize-and-decide operations:

| Token              | Recognition                                     | Decision                                               |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------ |
| Sequence indicator | `content.startsWith('- ')`                      | → `parseSequence()`                                    |
| Map colon          | `findMapColon()` — scan for `: ` outside quotes | → `parseMap()`                                         |
| Quoted scalar      | `content.startsWith('"')`                       | → `parseQuotedScalar()`                                |
| Plain scalar       | Fallthrough — none of the above matched         | → `parseScalarValue()`                                 |
| Indent level       | `line.indent` (precomputed from leading spaces) | → compare against `baseIndent` for nesting/sibling/end |

A formal lexer would produce the same information per line — `seq-item-ind`,
`map-value-ind`, `scalar`, etc. We just skip the intermediate representation
and match directly against the line string, because for single-line values
there's no ambiguity that a token boundary would help resolve.

#### Comparison to the original's state requirements

The original parser needs cross-line state (stack, flags, accumulated indent)
precisely for the features the subset excludes:

| Cross-line state                       | What it handles                                        | Why unnecessary here                               |
| -------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `indentNext` floor (lexer)             | Multi-line scalar continuation                         | Every scalar is one line                           |
| Open-quote tracking (lexer)            | Multi-line quoted strings                              | Every quoted string is one line                    |
| `atScalar` flag (parser)               | Two-token scalar protocol (`\x1f` + source)            | Scalar source visible inline on the line           |
| `onKeyLine` flag (parser)              | Whether `:` can start a nested map on same line as key | Full line visible — `isMapEntry()` decides upfront |
| `flowLevel` counter (lexer)            | `[]`/`{}` change indicator rules                       | No flow collections                                |
| Stack for retroactive reclassification | Scalar promoted to map key when `:` arrives later      | `findMapColon()` scans line before committing      |

### How parsing decisions are made

The two implementations make the same structural decisions (sequence vs map vs
scalar, nesting depth, node boundaries), but derive them from different data at
different times.

#### Original: accumulated state from token stream

The parser has **zero lookahead** into the token stream. Each `next()` call
receives one lexeme and must decide what to do using only:

1. **The token type** — classified from the lexeme string (`seq-item-ind`,
   `map-value-ind`, `scalar`, `space`, `newline`, ...)
2. **The stack** — `this.stack` holds the nodes being built. `peek(1)` is the
   stack top (the node currently being assembled), `peek(2)` is its parent.
   The stack encodes "where we are" in the tree.
3. **Accumulated indent** — `this.indent` is built incrementally: `newline`
   resets to 0, `space` tokens add their length, indicators (`-`, `:`, `?`)
   add their length. This is compared against `node.indent` (stamped when the
   node was pushed) to decide sibling vs child vs pop.
4. **Flags** — `atNewLine` (are we at the start of a line?), `onKeyLine`
   (on the same line as a block map key?), `atScalar` (was the previous token
   a `\x1f` scalar marker?).

Because the parser can't see ahead, it sometimes commits provisionally and
fixes up later. The main example: when it receives a plain scalar like `name`,
it pushes a `FlowScalar` onto the stack. Only when the _next_ token arrives as
`:` does `scalar()` retroactively replace the `FlowScalar` with a `BlockMap`
entry where that scalar becomes the key.

The dispatch pattern is: **stack top + token type → handler**. For example,
if the stack top is a `BlockSeq` and the token is `seq-item-ind` at the
sequence's indent, that's a new sibling item. If it's a scalar at a deeper
indent, that's a child value.

#### This implementation: line content + recursion depth

The parser sees the **entire current line** before committing to any decision.
The information available is:

1. **Line content** — `line.content` is the trimmed text of the current line.
   The parser inspects it directly: `startsWith('- ')` → sequence,
   `findMapColon()` finds `: ` → map, otherwise → scalar. All decided in one
   shot, no provisional commits needed.
2. **Line indent** — `line.indent` is the count of leading spaces, computed
   upfront when lines are split. Compared against the `baseIndent` or
   `minIndent` parameter to decide same-level vs nested vs end-of-node.
3. **Recursion depth** — the call stack itself encodes "where we are."
   `parseSequence()` calls `parseInlineMap()` calls `parseScalarValue()` —
   the nesting is implicit in the function calls rather than explicit in a
   stack data structure.
4. **No flags** — no `atNewLine`, `onKeyLine`, `atScalar`. These are
   unnecessary because the line-based approach never needs to track
   cross-token state.

The dispatch pattern is: **line content + indent vs parameter → recursive
call**. For example, `parseSequence(baseIndent=0)` loops while
`line.indent === baseIndent && line.content.startsWith('- ')`, then for each
item inspects the content after `- ` to decide: `isMapEntry()` → inline map,
or scalar.

#### Summary

|                      | Original                                                    | This implementation                                            |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Data for decisions   | Token type + stack + accumulated indent + flags             | Line content + line indent + recursion depth                   |
| When decided         | Incrementally, one token at a time; sometimes retroactively | All at once per line, before committing                        |
| Lookahead            | None (purely reactive)                                      | Full line visible (scan for `: `, `- `, etc.)                  |
| "Where are we" state | Explicit stack (`this.stack`)                               | Implicit call stack (recursion)                                |
| Indent tracking      | Built token by token (newline→0, space→add, indicator→add)  | Computed upfront per line (`stripped.length - trimmed.length`) |

## Worked example: `- name: Alice`

Tracing how the same input produces the same AST through the two approaches.

**Final AST (identical for both):**

```
YAMLSeq [
  YAMLMap [
    { key: Scalar("name"), value: Scalar("Alice") }
  ]
]
```

### Original: lexer → parser → composer

**Stage 1 — Lexer** scans characters left to right, emits flat string tokens:

```
'\x02'      doc-mode        (start of document)
'-'         seq-item-ind    (the - character)
' '         space
'\x1f'      scalar marker   (next token is a scalar value)
'name'      scalar source
':'         map-value-ind   (the : character)
' '         space
'\x1f'      scalar marker
'Alice'     scalar source
```

The lexer recognized `-` and `:` as indicators (each followed by space),
and wrapped the plain text in `\x1f` + source pairs. At this point there's
no tree — just a flat list of 9 strings.

**Stage 2 — CST Parser** feeds lexemes into `next()` one at a time:

```
next('\x02')  → stream(): push Document onto stack
                stack: [Document]

next('-')     → document(): calls startBlockValue()
               sees seq-item-ind, pushes BlockSeq{indent:0, items:[{start:['-']}]}
                stack: [Document, BlockSeq]

next(' ')     → blockSequence(): appends space to current item.start
                stack: [Document, BlockSeq]

next('\x1f')  → sets atScalar = true (next token will be a scalar value)

next('name')  → blockSequence(): calls startBlockValue()
               sees scalar type, pushes FlowScalar{source:'name'}
                stack: [Document, BlockSeq, FlowScalar('name')]

next(':')     → scalar(): sees map-value-ind while top is FlowScalar
               retroactive promotion: replaces FlowScalar with
               BlockMap{indent:2, items:[{key:FlowScalar('name'), sep:[':']}]}
                stack: [Document, BlockSeq, BlockMap]

next(' ')     → blockMap(): appends space to current item.sep
                stack: [Document, BlockSeq, BlockMap]

next('\x1f')  → sets atScalar = true

next('Alice') → blockMap(): calls startBlockValue()
               sees scalar type, pushes FlowScalar{source:'Alice'}
                stack: [Document, BlockSeq, BlockMap, FlowScalar('Alice')]

end()         → pops FlowScalar('Alice') into BlockMap item.value
               pops BlockMap into BlockSeq item.value
               pops BlockSeq into Document.value
               pops Document into tokens[]
```

Result: a CST tree with the structure already resolved.

**Stage 3 — Composer** walks the CST tree (no cursor, no advancing):

```
composeDoc(Document)
  └─ composeNode(BlockSeq)           → YAMLSeq
       └─ resolveBlockSeq()
            └─ composeNode(BlockMap)  → YAMLMap
                 └─ resolveBlockMap()
                      key:   composeNode(FlowScalar('name'))  → Scalar('name')
                      value: composeNode(FlowScalar('Alice')) → Scalar('Alice')
                      → Pair(Scalar('name'), Scalar('Alice'))
```

### This implementation: line-based recursive descent

**Setup — Constructor** splits input into one line:

```
lines = [{ indent: 0, content: '- name: Alice', offset: 0 }]
pos = 0
```

**Parsing — single pass through the call stack:**

```
parseRoot()
  line.content starts with '- '  →  parseSequence(baseIndent=0)
    ┌─ content after '- ' is 'name: Alice'
    │  isMapEntry('name: Alice')?
    │    findMapColon() scans: n...a...m...e... ':' followed by ' ' → yes, at index 4
    │
    └─ parseInlineMap('name: Alice', offset=2, contentIndent=2)
         splitMapEntry('name: Alice')
           → key='name', colonOffset=6, valueStr='Alice', valueOffset=8
         keyScalar = Scalar('name', range=[2,6,6])
         parseScalarValue('Alice', offset=8)
           → not quoted, not bool/null/number → Scalar('Alice', range=[8,13,13])
         map.items.push({ key: Scalar('name'), value: Scalar('Alice') })
         return YAMLMap

    seq.items.push(YAMLMap)
    return YAMLSeq
```

### Side by side

| Step                       | Original                                                                                   | This implementation                                                |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Split input                | Lexer scans chars → 9 lexemes                                                              | Constructor splits → 1 line                                        |
| Detect `- `                | Parser receives `-` token, pushes `BlockSeq`                                               | `parseNode()` checks `content.startsWith('- ')`                    |
| Detect `name` is a map key | Parser receives `name` as scalar, **then** `:` promotes it to `BlockMap` key (retroactive) | `isMapEntry()` scans the whole line for `: ` **before** committing |
| Build map                  | `BlockMap` assembled token by token on the stack                                           | `parseInlineMap()` + `splitMapEntry()` in one call                 |
| Resolve scalar type        | Composer's `composeScalar()` → schema tag matching                                         | `parseScalarValue()` → inline if/else (bool, null, number, string) |
| Result                     | `YAMLSeq [ YAMLMap [ Pair(Scalar('name'), Scalar('Alice')) ] ]`                            | `YAMLSeq [ { key: Scalar('name'), value: Scalar('Alice') } ]`      |

## Code mapping

For reviewing comparable logic between the two implementations:

| This file                         | Original (`yaml` package)                                                                | Notes                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `parseDocument()`                 | `src/public-api.ts` → `parseDocument()`                                                  |                                                                               |
| `Parser` constructor (line split) | `src/parse/lexer.ts` → `lex()`                                                           |                                                                               |
| `Parser.parseRoot()`              | `src/parse/parser.ts` → `parse()`                                                        |                                                                               |
| `Parser.parseNode()`              | `src/parse/parser.ts` → `startBlockValue()`                                              | Dispatch by node type                                                         |
| `Parser.parseSequence()`          | `src/parse/parser.ts` → `blockSequence()`                                                |                                                                               |
| `Parser.parseMap()`               | `src/parse/parser.ts` → `blockMap()`                                                     |                                                                               |
| `Parser.parseInlineMap()`         | `src/parse/parser.ts` → `blockMap()`                                                     | Triggered within a seq item                                                   |
| `Parser.findMapColon()`           | `src/parse/lexer.ts` → `plainScalar()` + `parser.ts` → `scalar()`                        | Lexer detects colon boundary; parser promotes scalar to block-map key on `: ` |
| `Parser.parseScalarValue()`       | `src/parse/lexer.ts` → `plainScalar()` / `quotedScalar()` + `parser.ts` → `flowScalar()` |                                                                               |
| `Parser.parseQuotedScalar()`      | `src/parse/lexer.ts` → `quotedScalar()`                                                  |                                                                               |
| `Parser.skipEmpty()`              | `parser.ts` → `blockSequence()` / `blockMap()`                                           | Newline/space token handling                                                  |
| `LineCounter`                     | `src/parse/line-counter.ts`                                                              |                                                                               |
| `Scalar` / `YAMLMap` / `YAMLSeq`  | `src/nodes/{Scalar,YAMLMap,YAMLSeq}.ts`                                                  |                                                                               |
| `YAMLError`                       | `src/errors.ts` → `YAMLParseError`                                                       |                                                                               |
| _(no equivalent)_                 | `src/compose/*.ts`                                                                       | Shape-preserving CST→AST tree walk; our parser builds AST directly            |
