/**
 * Unit tests for the minimal YAML parser.
 *
 * Ported from vendor/yaml/tests/, scoped to the subset we support:
 * sequences, maps, scalars (plain, quoted, numeric, boolean),
 * indentation nesting, error reporting with positions.
 */

import { describe, expect, test } from 'vitest'
import {
  LineCounter,
  parseDocument,
  Scalar,
  YAMLError,
  YAMLMap,
  YAMLSeq,
} from './yaml'

// ---------------------------------------------------------------------------
// LineCounter (ported from vendor/yaml/tests/line-counter.ts)
// ---------------------------------------------------------------------------

describe('LineCounter', () => {
  test('single line — no newlines', () => {
    const lc = new LineCounter()
    parseDocument('- hello', { lineCounter: lc })
    expect(lc.lineStarts).toEqual([0])
    expect(lc.linePos(0)).toEqual({ line: 1, col: 1 })
    expect(lc.linePos(2)).toEqual({ line: 1, col: 3 })
  })

  test('multiple lines', () => {
    const lc = new LineCounter()
    parseDocument('- a\n- b\n- c\n', { lineCounter: lc })
    expect(lc.lineStarts).toEqual([0, 4, 8, 12])
    expect(lc.linePos(0)).toEqual({ line: 1, col: 1 })
    expect(lc.linePos(4)).toEqual({ line: 2, col: 1 })
    expect(lc.linePos(6)).toEqual({ line: 2, col: 3 })
    expect(lc.linePos(8)).toEqual({ line: 3, col: 1 })
  })

  test('linePos for various offsets', () => {
    const lc = new LineCounter()
    parseDocument('- first\n- second\n', { lineCounter: lc })
    // line 1: offsets 0–7, line 2 starts at 8
    expect(lc.linePos(0)).toEqual({ line: 1, col: 1 })
    expect(lc.linePos(7)).toEqual({ line: 1, col: 8 })
    expect(lc.linePos(8)).toEqual({ line: 2, col: 1 })
    expect(lc.linePos(10)).toEqual({ line: 2, col: 3 })
  })
})

// ---------------------------------------------------------------------------
// parseDocument — sequences (YAML spec 2.1)
// ---------------------------------------------------------------------------

describe('sequences', () => {
  test('Example 2.1. Sequence of Scalars', () => {
    const doc = parseDocument('- Mark McGwire\n- Sammy Sosa\n- Ken Griffey')
    expect(doc.errors).toHaveLength(0)
    const seq = doc.contents as YAMLSeq
    expect(seq).toBeInstanceOf(YAMLSeq)
    expect(seq.items).toHaveLength(3)
    expect((seq.items[0] as Scalar).value).toBe('Mark McGwire')
    expect((seq.items[1] as Scalar).value).toBe('Sammy Sosa')
    expect((seq.items[2] as Scalar).value).toBe('Ken Griffey')
  })

  test('sequence with \\r\\n line endings', () => {
    const doc = parseDocument('- a\r\n- b\r\n- c\r\n')
    expect(doc.errors).toHaveLength(0)
    const items = (doc.contents as YAMLSeq).items
    expect(items).toHaveLength(3)
    expect((items[0] as Scalar).value).toBe('a')
    expect((items[1] as Scalar).value).toBe('b')
    expect((items[2] as Scalar).value).toBe('c')
  })

  test('sequence of quoted scalars', () => {
    const doc = parseDocument('- "hello world"\n- "foo \\"bar\\""')
    expect(doc.errors).toHaveLength(0)
    const items = (doc.contents as YAMLSeq).items
    expect((items[0] as Scalar).value).toBe('hello world')
    expect((items[1] as Scalar).value).toBe('foo "bar"')
  })

  test('sequence with numeric and boolean scalars', () => {
    const doc = parseDocument('- 42\n- 3.14\n- true\n- false')
    expect(doc.errors).toHaveLength(0)
    const items = (doc.contents as YAMLSeq).items
    expect((items[0] as Scalar).value).toBe(42)
    expect((items[1] as Scalar).value).toBe(3.14)
    expect((items[2] as Scalar).value).toBe(true)
    expect((items[3] as Scalar).value).toBe(false)
  })

  test('empty input', () => {
    const doc = parseDocument('')
    expect(doc.errors).toHaveLength(0)
    expect(doc.contents).toBeNull()
  })

  test('whitespace-only input', () => {
    const doc = parseDocument('  \n  \n')
    expect(doc.errors).toHaveLength(0)
    expect(doc.contents).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseDocument — maps
// ---------------------------------------------------------------------------

describe('maps', () => {
  test('simple mapping', () => {
    const doc = parseDocument('- key: value')
    expect(doc.errors).toHaveLength(0)
    const map = (doc.contents as YAMLSeq).items[0] as YAMLMap
    expect(map).toBeInstanceOf(YAMLMap)
    expect(map.items).toHaveLength(1)
    expect(map.items[0].key.value).toBe('key')
    expect((map.items[0].value as Scalar).value).toBe('value')
  })

  test('map with quoted value', () => {
    const doc = parseDocument('- text: "hello"')
    expect(doc.errors).toHaveLength(0)
    const map = (doc.contents as YAMLSeq).items[0] as YAMLMap
    expect((map.items[0].value as Scalar).value).toBe('hello')
  })

  test('map with numeric value', () => {
    const doc = parseDocument('- count: 42')
    expect(doc.errors).toHaveLength(0)
    const map = (doc.contents as YAMLSeq).items[0] as YAMLMap
    expect((map.items[0].value as Scalar).value).toBe(42)
  })

  test('map with boolean value', () => {
    const doc = parseDocument('- enabled: true')
    expect(doc.errors).toHaveLength(0)
    const map = (doc.contents as YAMLSeq).items[0] as YAMLMap
    expect((map.items[0].value as Scalar).value).toBe(true)
  })

  test('map with multiple entries (Example 2.2 shape)', () => {
    const doc = parseDocument('- key1: val1\n  key2: val2')
    expect(doc.errors).toHaveLength(0)
    const map = (doc.contents as YAMLSeq).items[0] as YAMLMap
    expect(map.items).toHaveLength(2)
    expect(map.items[0].key.value).toBe('key1')
    expect((map.items[0].value as Scalar).value).toBe('val1')
    expect(map.items[1].key.value).toBe('key2')
    expect((map.items[1].value as Scalar).value).toBe('val2')
  })

  test('top-level mapping', () => {
    const doc = parseDocument('key: value')
    expect(doc.errors).toHaveLength(0)
    expect(doc.contents).toBeInstanceOf(YAMLMap)
    const map = doc.contents as YAMLMap
    expect(map.items[0].key.value).toBe('key')
    expect((map.items[0].value as Scalar).value).toBe('value')
  })
})

// ---------------------------------------------------------------------------
// parseDocument — nested structures (YAML spec 2.3, 2.4)
// ---------------------------------------------------------------------------

describe('nesting', () => {
  test('Example 2.3. Mapping Scalars to Sequences', () => {
    const src = [
      '- american:',
      '  - Boston Red Sox',
      '  - Detroit Tigers',
      '- national:',
      '  - New York Mets',
      '  - Chicago Cubs',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const seq = doc.contents as YAMLSeq
    expect(seq.items).toHaveLength(2)

    const m1 = seq.items[0] as YAMLMap
    expect(m1.items[0].key.value).toBe('american')
    const v1 = m1.items[0].value as YAMLSeq
    expect(v1.items).toHaveLength(2)
    expect((v1.items[0] as Scalar).value).toBe('Boston Red Sox')
    expect((v1.items[1] as Scalar).value).toBe('Detroit Tigers')

    const m2 = seq.items[1] as YAMLMap
    expect(m2.items[0].key.value).toBe('national')
    const v2 = m2.items[0].value as YAMLSeq
    expect(v2.items).toHaveLength(2)
    expect((v2.items[0] as Scalar).value).toBe('New York Mets')
    expect((v2.items[1] as Scalar).value).toBe('Chicago Cubs')
  })

  test('Example 2.4. Sequence of Mappings', () => {
    const src = [
      '-',
      '  name: Mark McGwire',
      '  hr: 65',
      '  avg: 0.278',
      '-',
      '  name: Sammy Sosa',
      '  hr: 63',
      '  avg: 0.288',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const seq = doc.contents as YAMLSeq
    expect(seq.items).toHaveLength(2)

    const m1 = seq.items[0] as YAMLMap
    expect(m1.items).toHaveLength(3)
    expect(m1.items[0].key.value).toBe('name')
    expect((m1.items[0].value as Scalar).value).toBe('Mark McGwire')
    expect((m1.items[1].value as Scalar).value).toBe(65)
    expect((m1.items[2].value as Scalar).value).toBe(0.278)

    const m2 = seq.items[1] as YAMLMap
    expect(m2.items).toHaveLength(3)
    expect((m2.items[0].value as Scalar).value).toBe('Sammy Sosa')
    expect((m2.items[1].value as Scalar).value).toBe(63)
  })

  test('deeply nested sequences and maps', () => {
    const src = [
      '- list:',
      '  - listitem:',
      '    - link "Home"',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const seq = doc.contents as YAMLSeq
    const outerMap = seq.items[0] as YAMLMap
    expect(outerMap.items[0].key.value).toBe('list')
    const innerSeq = outerMap.items[0].value as YAMLSeq
    const innerMap = innerSeq.items[0] as YAMLMap
    expect(innerMap.items[0].key.value).toBe('listitem')
    const deepSeq = innerMap.items[0].value as YAMLSeq
    expect((deepSeq.items[0] as Scalar).value).toBe('link "Home"')
  })

  test('map entry with sequence value containing maps', () => {
    const src = [
      '- button "Submit":',
      '  - text: "Click me"',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const seq = doc.contents as YAMLSeq
    const map = seq.items[0] as YAMLMap
    expect(map.items[0].key.value).toBe('button "Submit"')
    const valSeq = map.items[0].value as YAMLSeq
    const innerMap = valSeq.items[0] as YAMLMap
    expect(innerMap.items[0].key.value).toBe('text')
    expect((innerMap.items[0].value as Scalar).value).toBe('Click me')
  })

  test('multiple map entries in sequence value', () => {
    const src = [
      '- heading "Title":',
      '  - /children: equal',
      '  - text: "hello"',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const seq = doc.contents as YAMLSeq
    const map = seq.items[0] as YAMLMap
    expect(map.items[0].key.value).toBe('heading "Title"')
    const valSeq = map.items[0].value as YAMLSeq
    expect(valSeq.items).toHaveLength(2)
    const entry1 = valSeq.items[0] as YAMLMap
    expect(entry1.items[0].key.value).toBe('/children')
    expect((entry1.items[0].value as Scalar).value).toBe('equal')
    const entry2 = valSeq.items[1] as YAMLMap
    expect(entry2.items[0].key.value).toBe('text')
    expect((entry2.items[0].value as Scalar).value).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// parseDocument — scalars
// ---------------------------------------------------------------------------

describe('scalars', () => {
  test('plain string', () => {
    const doc = parseDocument('- hello world')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe('hello world')
  })

  test('double-quoted with \\n escape', () => {
    const doc = parseDocument('- "hello\\nworld"')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe('hello\nworld')
  })

  test('double-quoted with \\t escape', () => {
    const doc = parseDocument('- "col1\\tcol2"')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe('col1\tcol2')
  })

  test('double-quoted with escaped backslash', () => {
    const doc = parseDocument('- "back\\\\slash"')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe('back\\slash')
  })

  test('double-quoted with escaped quotes', () => {
    const doc = parseDocument('- "say \\"hi\\""')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe('say "hi"')
  })

  test('empty quoted string', () => {
    const doc = parseDocument('- ""')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe('')
  })

  test('null values', () => {
    const doc = parseDocument('- null\n- ~')
    expect(doc.errors).toHaveLength(0)
    const items = (doc.contents as YAMLSeq).items
    expect((items[0] as Scalar).value).toBeNull()
    expect((items[1] as Scalar).value).toBeNull()
  })

  test('negative number', () => {
    const doc = parseDocument('- -7')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe(-7)
  })

  test('float with exponent', () => {
    const doc = parseDocument('- 1.5e3')
    expect(doc.errors).toHaveLength(0)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe(1500)
  })
})

// ---------------------------------------------------------------------------
// parseDocument — range tracking
// ---------------------------------------------------------------------------

describe('ranges', () => {
  test('scalar ranges', () => {
    const lc = new LineCounter()
    const doc = parseDocument('- hello\n- world', { lineCounter: lc })
    expect(doc.errors).toHaveLength(0)
    const items = (doc.contents as YAMLSeq).items
    // "hello" starts at offset 2 (after "- ")
    expect((items[0] as Scalar).range[0]).toBe(2)
    expect((items[0] as Scalar).range[1]).toBe(7)
    // "world" starts at offset 10 (8 + 2)
    expect((items[1] as Scalar).range[0]).toBe(10)
    expect((items[1] as Scalar).range[1]).toBe(15)
  })

  test('map key ranges', () => {
    const doc = parseDocument('- key: value')
    expect(doc.errors).toHaveLength(0)
    const map = (doc.contents as YAMLSeq).items[0] as YAMLMap
    const keyRange = map.items[0].key.range
    // "key" starts at offset 2 (after "- ")
    expect(keyRange[0]).toBe(2)
    expect(keyRange[1]).toBe(5)
  })

  test('sequence range starts at 0', () => {
    const doc = parseDocument('- a\n- b')
    expect(doc.errors).toHaveLength(0)
    expect((doc.contents as YAMLSeq).range[0]).toBe(0)
  })

  test('quoted scalar range includes quotes', () => {
    const doc = parseDocument('- "hi"')
    expect(doc.errors).toHaveLength(0)
    const s = (doc.contents as YAMLSeq).items[0] as Scalar
    // range[0] = 2 (start of quote), range[1] = 6 (after closing quote)
    expect(s.range[0]).toBe(2)
    expect(s.range[1]).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// parseDocument — error reporting
// ---------------------------------------------------------------------------

describe('errors', () => {
  test('YAMLError has message and pos', () => {
    const err = new YAMLError('test error', [5, 6])
    expect(err.message).toBe('test error')
    expect(err.pos).toEqual([5, 6])
    expect(err).toBeInstanceOf(Error)
  })

  test('unterminated quoted string reports error', () => {
    const doc = parseDocument('- "unterminated')
    expect(doc.errors.length).toBeGreaterThan(0)
    expect(doc.errors[0].message).toMatch(/unterminated/i)
  })

  test('bad indentation reports error', () => {
    const doc = parseDocument('- a\n   - b')
    expect(doc.errors.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// instanceof checks (critical for ariaSnapshot.ts)
// ---------------------------------------------------------------------------

describe('instanceof', () => {
  test('Scalar', () => {
    const doc = parseDocument('- hello')
    const item = (doc.contents as YAMLSeq).items[0]
    expect(item).toBeInstanceOf(Scalar)
    expect(item).not.toBeInstanceOf(YAMLMap)
    expect(item).not.toBeInstanceOf(YAMLSeq)
  })

  test('YAMLMap', () => {
    const doc = parseDocument('- key: value')
    const item = (doc.contents as YAMLSeq).items[0]
    expect(item).toBeInstanceOf(YAMLMap)
    expect(item).not.toBeInstanceOf(Scalar)
  })

  test('YAMLSeq', () => {
    const doc = parseDocument('- hello')
    expect(doc.contents).toBeInstanceOf(YAMLSeq)
    expect(doc.contents).not.toBeInstanceOf(YAMLMap)
  })
})

// ---------------------------------------------------------------------------
// Aria template patterns (integration-style)
// ---------------------------------------------------------------------------

describe('aria template patterns', () => {
  test('plain role scalar', () => {
    const doc = parseDocument('- heading "Title" [level=1]')
    expect(doc.errors).toHaveLength(0)
    const items = (doc.contents as YAMLSeq).items
    expect(items).toHaveLength(1)
    expect(items[0]).toBeInstanceOf(Scalar)
    expect((items[0] as Scalar).value).toBe('heading "Title" [level=1]')
  })

  test('complex nav tree', () => {
    const src = [
      '- navigation "Main":',
      '  - list:',
      '    - listitem:',
      '      - link "Home"',
      '    - listitem:',
      '      - link "About"',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const seq = doc.contents as YAMLSeq
    const nav = seq.items[0] as YAMLMap
    expect(nav.items[0].key.value).toBe('navigation "Main"')
    const navChildren = nav.items[0].value as YAMLSeq
    const list = navChildren.items[0] as YAMLMap
    expect(list.items[0].key.value).toBe('list')
    const listChildren = list.items[0].value as YAMLSeq
    expect(listChildren.items).toHaveLength(2)
  })

  test('mixed scalars and maps in sequence', () => {
    const src = [
      '- heading "Title"',
      '- paragraph:',
      '  - text: "Hello world"',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const items = (doc.contents as YAMLSeq).items
    expect(items).toHaveLength(2)
    expect(items[0]).toBeInstanceOf(Scalar)
    expect(items[1]).toBeInstanceOf(YAMLMap)
  })

  test('/children containerMode', () => {
    const src = [
      '- list:',
      '  - /children: equal',
      '  - listitem "one"',
      '  - listitem "two"',
    ].join('\n')
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    const list = (doc.contents as YAMLSeq).items[0] as YAMLMap
    const children = list.items[0].value as YAMLSeq
    expect(children.items).toHaveLength(3)
    const meta = children.items[0] as YAMLMap
    expect(meta.items[0].key.value).toBe('/children')
    expect((meta.items[0].value as Scalar).value).toBe('equal')
  })

  test('key with colon in quoted name', () => {
    const src = '- link "http://example.com"'
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    // The colon is inside quotes, so this is a plain scalar, not a map
    expect((doc.contents as YAMLSeq).items[0]).toBeInstanceOf(Scalar)
    expect(((doc.contents as YAMLSeq).items[0] as Scalar).value).toBe(
      'link "http://example.com"'
    )
  })
})

// ---------------------------------------------------------------------------
// Coverage from test/aria.test.ts — every YAML shape fed to parseAriaTemplate
// ---------------------------------------------------------------------------

describe('aria.test.ts effective coverage', () => {
  // Helper: parse and return contents, asserting no errors
  function parse(src: string) {
    const doc = parseDocument(src)
    expect(doc.errors).toHaveLength(0)
    return doc.contents
  }

  function seqItems(src: string) {
    const seq = parse(src) as YAMLSeq
    expect(seq).toBeInstanceOf(YAMLSeq)
    return seq.items
  }

  // -- indented templates (template-literal style) --------------------------

  test('indented template with leading/trailing whitespace', () => {
    const items = seqItems(`
      - heading [level=1]
      - button
    `)
    expect(items).toHaveLength(2)
    expect((items[0] as Scalar).value).toBe('heading [level=1]')
    expect((items[1] as Scalar).value).toBe('button')
  })

  // -- role with regex pattern name -----------------------------------------

  test('role with regex name', () => {
    const items = seqItems('- button /User \\d+/')
    expect((items[0] as Scalar).value).toBe('button /User \\d+/')
  })

  test('regex name that does not match', () => {
    const items = seqItems('- button /Goodbye/')
    expect((items[0] as Scalar).value).toBe('button /Goodbye/')
  })

  // -- role with inline scalar text child -----------------------------------

  test('role with plain text child', () => {
    const items = seqItems('- listitem: One')
    const map = items[0] as YAMLMap
    expect(map.items[0].key.value).toBe('listitem')
    expect((map.items[0].value as Scalar).value).toBe('One')
  })

  test('role with regex text child', () => {
    const items = seqItems('- paragraph: /You have \\d+ notifications/')
    const map = items[0] as YAMLMap
    expect(map.items[0].key.value).toBe('paragraph')
    expect((map.items[0].value as Scalar).value).toBe('/You have \\d+ notifications/')
  })

  test('role with regex text child (no name)', () => {
    const items = seqItems('- paragraph: /\\d+ errors/')
    const map = items[0] as YAMLMap
    expect((map.items[0].value as Scalar).value).toBe('/\\d+ errors/')
  })

  // -- quoted values escaping YAML special chars ----------------------------

  test('quoted value with colon', () => {
    const items = seqItems('- paragraph: "one: two"')
    const map = items[0] as YAMLMap
    expect((map.items[0].value as Scalar).value).toBe('one: two')
  })

  test('quoted value that looks like boolean', () => {
    const items = seqItems('- paragraph: "true"')
    const map = items[0] as YAMLMap
    // Must be string, not boolean
    expect((map.items[0].value as Scalar).value).toBe('true')
  })

  test('quoted value that looks like number', () => {
    const items = seqItems('- paragraph: "123"')
    const map = items[0] as YAMLMap
    expect((map.items[0].value as Scalar).value).toBe('123')
  })

  // -- /url pseudo-attribute ------------------------------------------------

  test('/url with regex value', () => {
    const items = seqItems(`
      - link:
        - /url: /.*example.com/
    `)
    const map = items[0] as YAMLMap
    expect(map.items[0].key.value).toBe('link')
    const children = map.items[0].value as YAMLSeq
    const urlEntry = children.items[0] as YAMLMap
    expect(urlEntry.items[0].key.value).toBe('/url')
    expect((urlEntry.items[0].value as Scalar).value).toBe('/.*example.com/')
  })

  test('/url with plain value', () => {
    const items = seqItems(`
      - link:
        - /url: https://example.com
    `)
    const urlEntry = ((items[0] as YAMLMap).items[0].value as YAMLSeq)
      .items[0] as YAMLMap
    expect(urlEntry.items[0].key.value).toBe('/url')
    expect((urlEntry.items[0].value as Scalar).value).toBe('https://example.com')
  })

  // -- /placeholder pseudo-attribute ----------------------------------------

  test('/placeholder pseudo-attribute', () => {
    const items = seqItems(`
      - textbox "Label":
        - /placeholder: Enter name
    `)
    const map = items[0] as YAMLMap
    expect(map.items[0].key.value).toBe('textbox "Label"')
    const children = map.items[0].value as YAMLSeq
    const ph = children.items[0] as YAMLMap
    expect(ph.items[0].key.value).toBe('/placeholder')
    expect((ph.items[0].value as Scalar).value).toBe('Enter name')
  })

  // -- link with text children + /url --------------------------------------

  test('link with text children and /url', () => {
    const items = seqItems(`
      - link:
        - text: Click here
        - /url: /.*example.com/
    `)
    const children = (items[0] as YAMLMap).items[0].value as YAMLSeq
    expect(children.items).toHaveLength(2)
    const textEntry = children.items[0] as YAMLMap
    expect(textEntry.items[0].key.value).toBe('text')
    expect((textEntry.items[0].value as Scalar).value).toBe('Click here')
    const urlEntry = children.items[1] as YAMLMap
    expect(urlEntry.items[0].key.value).toBe('/url')
  })

  // -- sibling maps at top level -------------------------------------------

  test('sibling list maps', () => {
    const items = seqItems(`
      - list:
        - listitem: A
      - list:
        - listitem: WRONG
    `)
    expect(items).toHaveLength(2)
    expect(items[0]).toBeInstanceOf(YAMLMap)
    expect(items[1]).toBeInstanceOf(YAMLMap)
    expect((items[0] as YAMLMap).items[0].key.value).toBe('list')
    expect((items[1] as YAMLMap).items[0].key.value).toBe('list')
  })

  // -- multiple top-level items: role-with-value + scalar -------------------

  test('mixed map and scalar at top level', () => {
    const items = seqItems(`
      - button /\\d+/: Pattern
      - paragraph: Original
    `)
    expect(items).toHaveLength(2)
    const m1 = items[0] as YAMLMap
    expect(m1.items[0].key.value).toBe('button /\\d+/')
    expect((m1.items[0].value as Scalar).value).toBe('Pattern')
    const m2 = items[1] as YAMLMap
    expect(m2.items[0].key.value).toBe('paragraph')
    expect((m2.items[0].value as Scalar).value).toBe('Original')
  })

  // -- deep navigation tree (4 levels) -------------------------------------

  test('4-level deep navigation tree', () => {
    const items = seqItems(`
      - navigation "Main":
        - list:
          - listitem:
            - button: Home
    `)
    const nav = items[0] as YAMLMap
    expect(nav.items[0].key.value).toBe('navigation "Main"')
    const list = ((nav.items[0].value as YAMLSeq).items[0] as YAMLMap)
    expect(list.items[0].key.value).toBe('list')
    const listitem = ((list.items[0].value as YAMLSeq).items[0] as YAMLMap)
    expect(listitem.items[0].key.value).toBe('listitem')
    const btn = ((listitem.items[0].value as YAMLSeq).items[0] as YAMLMap)
    expect(btn.items[0].key.value).toBe('button')
    expect((btn.items[0].value as Scalar).value).toBe('Home')
  })

  // -- navigation with /url at leaf ----------------------------------------

  test('navigation tree with /url at leaf', () => {
    const items = seqItems(`
      - navigation "Main":
        - list:
          - listitem:
            - link "Home":
              - /url: /home
          - listitem:
            - link "About":
              - /url: /about
    `)
    const nav = items[0] as YAMLMap
    const list = ((nav.items[0].value as YAMLSeq).items[0] as YAMLMap)
    const listItems = list.items[0].value as YAMLSeq
    expect(listItems.items).toHaveLength(2)
    // First listitem > link "Home" > /url
    const li1 = listItems.items[0] as YAMLMap
    const link1 = (li1.items[0].value as YAMLSeq).items[0] as YAMLMap
    expect(link1.items[0].key.value).toBe('link "Home"')
    const url1 = (link1.items[0].value as YAMLSeq).items[0] as YAMLMap
    expect(url1.items[0].key.value).toBe('/url')
    expect((url1.items[0].value as Scalar).value).toBe('/home')
  })

  // -- attributes: various forms -------------------------------------------

  test('role with single attribute', () => {
    const items = seqItems('- button [disabled]')
    expect((items[0] as Scalar).value).toBe('button [disabled]')
  })

  test('role with attribute=value', () => {
    const items = seqItems('- button [expanded=false]')
    expect((items[0] as Scalar).value).toBe('button [expanded=false]')
  })

  test('role with name and attribute', () => {
    const items = seqItems('- checkbox "A" [checked]')
    expect((items[0] as Scalar).value).toBe('checkbox "A" [checked]')
  })

  test('role with name and attribute=mixed', () => {
    const items = seqItems('- checkbox "A" [checked=mixed]')
    expect((items[0] as Scalar).value).toBe('checkbox "A" [checked=mixed]')
  })

  test('role with name and attribute=false', () => {
    const items = seqItems('- button "Menu" [expanded=false]')
    expect((items[0] as Scalar).value).toBe('button "Menu" [expanded=false]')
  })

  // -- contain semantics: subsequence matching shapes -----------------------

  test('contain semantics — subsequence', () => {
    const items = seqItems(`
      - list:
        - listitem: A
        - listitem: C
    `)
    const list = items[0] as YAMLMap
    const children = list.items[0].value as YAMLSeq
    expect(children.items).toHaveLength(2)
    expect(((children.items[0] as YAMLMap).items[0].value as Scalar).value).toBe('A')
    expect(((children.items[1] as YAMLMap).items[0].value as Scalar).value).toBe('C')
  })

  // -- single item shorthand -----------------------------------------------

  test('single role without value', () => {
    const items = seqItems('- list')
    expect(items).toHaveLength(1)
    expect((items[0] as Scalar).value).toBe('list')
  })

  test('single link without value', () => {
    const items = seqItems('- link')
    expect(items).toHaveLength(1)
    expect((items[0] as Scalar).value).toBe('link')
  })

  // -- regex in map key (role name pattern) ---------------------------------

  test('regex in map key with scalar value', () => {
    const items = seqItems(`
      - button /item-\\d+/: Click
      - button /user-\\d+/: Edit
    `)
    expect(items).toHaveLength(2)
    expect((items[0] as YAMLMap).items[0].key.value).toBe('button /item-\\d+/')
    expect(((items[0] as YAMLMap).items[0].value as Scalar).value).toBe('Click')
    expect((items[1] as YAMLMap).items[0].key.value).toBe('button /user-\\d+/')
    expect(((items[1] as YAMLMap).items[0].value as Scalar).value).toBe('Edit')
  })

  // -- map value with regex pattern ----------------------------------------

  test('map with regex value', () => {
    const items = seqItems(`
      - button: Cancel
      - paragraph: /\\w+/
    `)
    expect(items).toHaveLength(2)
    expect(((items[0] as YAMLMap).items[0].value as Scalar).value).toBe('Cancel')
    expect(((items[1] as YAMLMap).items[0].value as Scalar).value).toBe('/\\w+/')
  })

  // -- heading with quoted name only (no children) --------------------------

  test('heading with quoted name only', () => {
    const items = seqItems('- heading "title"')
    expect(items).toHaveLength(1)
    // YAML sees this as a plain scalar (no colon), not a map
    expect(items[0]).toBeInstanceOf(Scalar)
    expect((items[0] as Scalar).value).toBe('heading "title"')
  })

  // -- textbox without name -------------------------------------------------

  test('textbox without name, /placeholder child', () => {
    const items = seqItems(`
      - textbox:
        - /placeholder: Enter name
    `)
    const map = items[0] as YAMLMap
    expect(map.items[0].key.value).toBe('textbox')
    const children = map.items[0].value as YAMLSeq
    const ph = children.items[0] as YAMLMap
    expect(ph.items[0].key.value).toBe('/placeholder')
    expect((ph.items[0].value as Scalar).value).toBe('Enter name')
  })
})
