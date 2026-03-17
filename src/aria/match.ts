import {
  renderNodeLines,
  createAriaKey,
  renderAriaProps,
} from './folk/injected/ariaSnapshot'
import {
  matchesNode,
  matchesTextValue,
  matchesStringOrRegex,
  cachedRegex,
} from './folk/isomorphic/ariaSnapshot'
import type {
  AriaNode,
  AriaRegex,
  AriaTemplateNode,
} from './folk/isomorphic/ariaSnapshot'
import { formatTextValue, formatNameValue } from './template'

// ---------------------------------------------------------------------------
// matchAriaTree — three-way merge matching (vitest-specific)
//
// Uses folk's matchesNode for boolean matching and folk's renderNodeLines
// for actual-side rendering. Only the merge assembly and template rendering
// (which Playwright doesn't need) are implemented here.
//
// Fragment semantics:
//   A fragment node has no semantics of its own — it exists only because
//   APIs must return a single root when the content is multiple siblings.
//   captureAriaTree always returns a fragment root; parseAriaTemplate may
//   or may not (it unwraps single-child fragments, following Playwright).
//
//   We normalize by flattening: fragment = its children. This happens
//   inside mergeChildLists so every recursion level handles it uniformly.
//
//   Playwright takes a different approach: instead of flattening, it treats
//   fragment as a wildcard role (matches any node) and relies on the entry
//   point to walk root.children directly. Both are equally sound because
//   fragment nodes never carry meaningful attributes or containerMode in
//   practice — the parser only sets containerMode on top-level fragments,
//   then unwraps single-child ones, so surviving fragments always have
//   multiple children whose list semantics our flatten preserves correctly.
//   The tradeoff is decomposition: Playwright keeps all match semantics in
//   matchesNode; we split fragment handling into mergeChildLists, which is
//   natural since we need that function anyway for three-way merge.
//   See: vendor/playwright/packages/injected/src/ariaSnapshot.ts
//   (matchesNode, matchesNodeDeep)
//
// Differences from Playwright:
//   - Playwright adds matchesNodeDeep, which walks the entire actual tree
//     trying matchesNode at every node (locator-style "find this pattern
//     anywhere"). We always match from root.
//   - Playwright has no three-way merge — on --update it re-renders the
//     actual DOM with regex heuristics (renderStringsAsRegex /
//     convertToBestGuessRegex) and overwrites the snapshot wholesale.
//     Our merge preserves user-edited patterns from the expected side.
//
// Two-pass pairing in mergeChildLists:
//   Pass 1: O(C) greedy left-to-right, full-depth matchesNode.
//     Determines pass (all templates matched = pass). This is the same
//     algorithm as Playwright's containsList.
//   Pass 2: O(C × T) unordered, full-depth matchesNode (only on failure).
//     Recovers exact pairs that pass 1's greedy scan missed — e.g.
//     template [paragraph "wrong", button /\d+/] vs children [paragraph,
//     button]: pass 1 fails paragraph and advances past it, then can't
//     match button against the paragraph template. Pass 2 scans all
//     children per template and finds the button match, preserving the
//     regex in the merge output instead of dumping a full literal snapshot.
//     pass is already false — pass 2 only improves merge quality.
//
//   Complexity: matchesNode recurses with O(C × T) internally (via
//   containsList) at each tree level, so the total work across the tree
//   is already O(N × T) where N = total actual nodes, T = total template
//   nodes. Pass 2 adds a factor of T at the failing level only (O(C × T)
//   calls instead of O(C)), each recursing O(subtree). This only triggers
//   on failure and sibling lists are small in practice.
// ---------------------------------------------------------------------------

/**
 * The match algorithm produces two resolved views:
 *
 *   actual   — DOM tree rendered through the template's lens (regexes
 *              adopted, names omitted where template omits them).
 *   expected — template filled in with actual DOM values. This is
 *              what gets written on --update.
 *
 * These are NOT raw renderings of the inputs:
 *   rawActual   = renderAriaTree(root)
 *   rawExpected = the original YAML template string before parsing
 * Both are independent of the match algorithm and available to the
 * caller without matchAriaTree.
 *
 * Invariants:
 *   pass: true ⟺ actual === expected
 *                   More precisely:
 *                   rawActual ⋟ actual === expected === rawExpected
 *                   Only the actual side loses specificity (adopting
 *                   template patterns like regexes, omitted names).
 *                   The expected side is unchanged — the template as
 *                   written is already correct when it passes.
 *                   TODO:
 *                   currently we actually don't have `expected === rawExpected` invariant,
 *                   but this is likely a bug. However this case doesn't affect users
 *                   since `pass: true` doesn't cause error diff nor new snapshot.
 *   pass: false ⟹ rawActual ⋟ actual != expected
 *                   paired children are normalized
 *                   through the template's lens, e.g. regex name adopted;
 *                   unpaired children are rendered raw). When no children
 *                   can be paired at all, rawActual = actual.
 *                   expected is written on --update.
 *
 * Diff display (pass: false):
 *   Use actual vs rawExpected. The user wants to see their original
 *   assertion on the right side, not the resolved version. The left
 *   side (actual) normalizes matched regions so the diff highlights
 *   only genuine mismatches, not pattern-vs-literal noise.
 *
 * Snapshot update (pass: false):
 *   Write expected. It preserves user patterns (regexes, omitted names)
 *   while incorporating actual DOM structure.
 *
 * Round-trip invariant:
 *   element → captureAriaTree → renderAriaTree → parseAriaTemplate
 *   → matchAriaTree(captured, parsed) → pass: true.
 *   A rendered snapshot must always match its own source tree.
 *   (Tested via runPipeline in aria.test.ts.)
 */
export interface MatchAriaResult {
  /** Whether the actual tree satisfies the template. */
  pass: boolean
  /** DOM tree resolved through the template's lens. For diff left side. */
  actual: string
  /** Template resolved with actual values. Written on --update. */
  expected: string
}

export function matchAriaTree(
  root: AriaNode,
  template: AriaTemplateNode
): MatchAriaResult {
  const result = mergeChildLists([root], [template], '')

  return {
    pass: result.pass,
    actual: result.actual.join('\n'),
    expected: result.expected.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Merge internals
// ---------------------------------------------------------------------------

interface MergeLines {
  actual: string[]
  expected: string[]
  pass: boolean
}

function isRegexName(name?: AriaRegex | string): name is AriaRegex {
  return typeof name === 'object' && name !== null && 'pattern' in name
}

// --- Actual-side key with name override (for regex-transparent diffing) ---

function renderActualKeyWithName(
  node: AriaNode,
  nameOverride: AriaRegex | string
): string {
  let key = node.role
  if (nameOverride) key += ` ${formatNameValue(nameOverride)}`
  key += renderAriaProps(node)
  return key
}

// --- Pairing + merge ---

function pairChildren(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[]
): Map<number, number> {
  // Greedy left-to-right: advance through children, when child[ci]
  // full-depth matches template[ti], pair them and advance ti.
  // Unmatched children are skipped (contain semantics).
  const pairs = new Map<number, number>()
  let ti = 0
  for (let ci = 0; ci < children.length && ti < templates.length; ci++) {
    if (matchesNode(children[ci], templates[ti], false)) {
      pairs.set(ci, ti)
      ti++
    }
  }
  return pairs
}

/** Pass 2: O(C × T) unordered exact match to recover pairs that pass 1's
 * greedy left-to-right scan missed (e.g. due to ordering differences).
 * Only affects merge output quality, not pass/fail. */
function pairChildrenFull(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[]
): Map<number, number> {
  const pairs = new Map<number, number>()
  const pairedChildren = new Set<number>()
  // For each template, scan all children for a full-depth match.
  for (let ti = 0; ti < templates.length; ti++) {
    for (let ci = 0; ci < children.length; ci++) {
      if (pairedChildren.has(ci)) continue
      if (matchesNode(children[ci], templates[ti], false)) {
        pairs.set(ci, ti)
        pairedChildren.add(ci)
        break
      }
    }
  }
  return pairs
}

function renderChildLines(child: AriaNode | string, indent: string): string[] {
  const lines: string[] = []
  if (typeof child === 'string') {
    lines.push(`${indent}- text: ${child}`)
  } else {
    renderNodeLines(child, indent, lines)
  }
  return lines
}

function mergeChildLists(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[],
  indent: string
): MergeLines {
  // fragment = its children (a fragment has no semantics of its own)
  children = children.flatMap((c) =>
    typeof c !== 'string' && c.role === 'fragment' ? c.children : [c]
  )
  templates = templates.flatMap((t) =>
    t.kind === 'role' && t.role === 'fragment' ? t.children || [] : [t]
  )

  const actual: string[] = []
  const expected: string[] = []

  // we allow matching as subset so it can pass with
  // children.length >= templates.length === pairs.size
  const pairs = pairChildren(children, templates)
  const allTemplatesMatched = templates.length === pairs.size

  if (!allTemplatesMatched) {
    // Pass 2: O(C × T) unordered exact match to recover pairs that
    // pass 1's greedy scan missed. Preserves user patterns (e.g. regexes)
    // in the merge output instead of dumping full actual.
    const recoveredPairs = pairChildrenFull(children, templates)

    for (let ci = 0; ci < children.length; ci++) {
      const ti = recoveredPairs.get(ci)
      if (ti !== undefined) {
        // recursively merge for matched pairs to preserve template pattern on matched branches.
        const r = mergeNode(children[ci], templates[ti], indent)
        actual.push(...r.actual)
        expected.push(...r.expected)
      } else {
        // on unpaired child branch, we fully update with actual dom render.
        const rendered = renderChildLines(children[ci], indent)
        actual.push(...rendered)
        expected.push(...rendered)
      }
    }

    return { actual, expected, pass: false }
  }

  // All templates matched (full-depth) — pass is true.
  // mergeNode is only called here for rendering, not for pass/fail.
  for (let ci = 0; ci < children.length; ci++) {
    const ti = pairs.get(ci)
    if (ti !== undefined) {
      const r = mergeNode(children[ci], templates[ti], indent)
      actual.push(...r.actual)
      expected.push(...r.expected)
    } else {
      // TODO: this is likely "wrong". revisit from invariant principle above.
      actual.push(...renderChildLines(children[ci], indent))
    }
  }

  return { actual, expected, pass: true }
}

// TODO: refactor `indent: string` into `depth: number` and `pad(depth, string)` utils.
function mergeNode(
  node: AriaNode | string,
  template: AriaTemplateNode,
  indent: string
): MergeLines {
  // Text node
  if (typeof node === 'string' && template.kind === 'text') {
    const matched = matchesTextValue(node, template.text)
    if (matched && cachedRegex(template.text)) {
      const patternStr = `${indent}- text: ${formatTextValue(template.text)}`
      return {
        actual: [patternStr],
        expected: [patternStr],
        pass: true,
      }
    }
    if (matched) {
      const line = `${indent}- text: ${node}`
      return { actual: [line], expected: [line], pass: true }
    }
    return {
      actual: [`${indent}- text: ${node}`],
      expected: [`${indent}- text: ${node}`],
      pass: false,
    }
  }

  if (typeof node === 'string' || template.kind !== 'role') {
    const actualLine =
      typeof node === 'string'
        ? `${indent}- text: ${node}`
        : (() => {
            const l: string[] = []
            renderNodeLines(node, indent, l)
            return l.join('\n')
          })()
    return { actual: [actualLine], expected: [actualLine], pass: false }
  }

  const attrPass =
    (template.level === undefined || template.level === node.level) &&
    (template.checked === undefined || template.checked === node.checked) &&
    (template.disabled === undefined || template.disabled === node.disabled) &&
    (template.expanded === undefined || template.expanded === node.expanded) &&
    (template.pressed === undefined || template.pressed === node.pressed) &&
    (template.selected === undefined || template.selected === node.selected)

  let propsPass = true
  if (template.props) {
    for (const [key, tv] of Object.entries(template.props)) {
      if (!matchesTextValue(node.props[key] || '', tv)) {
        propsPass = false
        break
      }
    }
  }

  // Match role (e.g. `- heading`)
  const expectedName = template.name
  let namePass = matchesStringOrRegex(node.name, expectedName)

  // Match key lines (e.g. `- heading "Hello" [level=1]`)
  // TODO: "actual" feels wrong here too. It should adopted through "template" pattern lens.

  // actual: adopts regex from template when matched, otherwise literal
  const actualKey =
    namePass && isRegexName(template.name)
      ? renderActualKeyWithName(node, template.name)
      : createAriaKey(node)
  // expected: preserves template's name exactly (including omission)
  const expectedKey =
    expectedName !== undefined
      ? renderActualKeyWithName(node, expectedName)
      : `${node.role}${renderAriaProps(node)}`

  // Recurse into children
  const childResult = mergeChildLists(
    node.children,
    template.children || [],
    `${indent}  `
  )

  // Build pseudo-child lines for props
  const actualPseudo: string[] = []
  const expectedPseudo: string[] = []

  const allPropKeys = new Set([
    ...Object.keys(node.props),
    ...Object.keys(template.props || {}),
  ])

  for (const prop of allPropKeys) {
    const nodeVal = node.props[prop]
    const tmplVal = template.props?.[prop]
    if (nodeVal !== undefined || tmplVal !== undefined) {
      const matched =
        tmplVal === undefined || matchesTextValue(nodeVal || '', tmplVal)

      if (nodeVal !== undefined) {
        const actualDisplay =
          matched && tmplVal && cachedRegex(tmplVal)
            ? formatTextValue(tmplVal)
            : nodeVal
        actualPseudo.push(`${indent}  - /${prop}: ${actualDisplay}`)
      }
      if (nodeVal !== undefined) {
        const expectedDisplay =
          matched && tmplVal !== undefined ? formatTextValue(tmplVal) : nodeVal
        expectedPseudo.push(`${indent}  - /${prop}: ${expectedDisplay}`)
      }
    }
  }

  const pass = namePass && attrPass && propsPass && childResult.pass

  const actual: string[] = []
  const expected: string[] = []

  const hasActualChildren = childResult.actual.length > 0 || actualPseudo.length > 0
  const hasExpectedChildren =
    childResult.expected.length > 0 || expectedPseudo.length > 0

  if (!hasActualChildren) {
    actual.push(`${indent}- ${actualKey}`)
  } else if (
    childResult.actual.length === 1 &&
    !actualPseudo.length &&
    childResult.actual[0].trimStart().startsWith('- text: ')
  ) {
    const text = childResult.actual[0].trimStart().slice('- text: '.length)
    actual.push(`${indent}- ${actualKey}: ${text}`)
  } else {
    actual.push(`${indent}- ${actualKey}:`)
    actual.push(...childResult.actual)
    actual.push(...actualPseudo)
  }

  if (!hasExpectedChildren) {
    expected.push(`${indent}- ${expectedKey}`)
  } else if (
    childResult.expected.length === 1 &&
    !expectedPseudo.length &&
    childResult.expected[0].trimStart().startsWith('- text: ')
  ) {
    const text = childResult.expected[0].trimStart().slice('- text: '.length)
    expected.push(`${indent}- ${expectedKey}: ${text}`)
  } else {
    expected.push(`${indent}- ${expectedKey}:`)
    expected.push(...childResult.expected)
    expected.push(...expectedPseudo)
  }

  return { actual, expected, pass }
}
