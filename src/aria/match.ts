import {
  renderNodeLines,
  createAriaKey,
  renderAriaProps,
  renderAriaTree,
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
 * The match algorithm resolves a DOM tree through the template's lens:
 *
 *   resolved — DOM tree rendered through the template's lens. Where the
 *              template uses regexes or omits names, the resolved output
 *              adopts those patterns. Where the template doesn't match,
 *              the resolved output uses literal DOM values.
 *
 * This is NOT a raw rendering of either input:
 *   actual   = renderAriaTree(root)       — DOM as-is
 *   expected = the original YAML string   — template as-is
 * Both are independent of the match algorithm and available to the
 * caller without matchAriaTree.
 *
 * Invariant:
 *   pass = true <=> resolved = expected
 *                   TODO: right? but this doesn't hold yet.
 *                   we only have one direction
 *                     pass = true <= resolved = expected
 *                   or equivalently
 *                     pass = false => resolved != expected
 *                   This shouldn't affect user facing behavior since
 *                   when pass = true, it won't show error diff nor create new snapshot.
 *
 * Diff display (pass: false):
 *   Use resolved vs expected. The user sees their original assertion
 *   on the right side. The left side (resolved) normalizes matched
 *   regions so the diff highlights only genuine mismatches, not
 *   pattern-vs-literal noise.
 *
 * Snapshot update (pass: false):
 *   Write resolved. It preserves user patterns (regexes, omitted names)
 *   from matched regions while incorporating actual DOM structure for
 *   mismatched/unpaired regions.
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
  /** DOM tree resolved through the template's lens. Written on --update. */
  resolved: string
}

export function matchAriaTree(
  root: AriaNode,
  template: AriaTemplateNode
): MatchAriaResult {
  // recurse as lists to normalize top-level fragments
  const result = mergeChildLists([root], [template], '')

  return {
    pass: result.pass,
    resolved: result.resolved.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Merge internals
// ---------------------------------------------------------------------------

interface MergeLines {
  resolved: string[]
  pass: boolean
}

function isRegexName(name?: AriaRegex | string): name is AriaRegex {
  return typeof name === 'object' && name !== null && 'pattern' in name
}

function renderKeyWithName(
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

  const resolved: string[] = []

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
        resolved.push(...r.resolved)
      } else {
        // on unpaired child branch, we fully update with actual dom render.
        resolved.push(...renderChildLines(children[ci], indent))
      }
    }

    return { resolved, pass: false }
  }

  // All templates matched (full-depth) — pass is true.
  // mergeNode is only called here for rendering, not for pass/fail.
  for (let ci = 0; ci < children.length; ci++) {
    const ti = pairs.get(ci)
    if (ti !== undefined) {
      const r = mergeNode(children[ci], templates[ti], indent)
      resolved.push(...r.resolved)
    } else {
      resolved.push(...renderChildLines(children[ci], indent))
    }
  }

  return { resolved, pass: true }
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
    const resolvedText =
      matched && cachedRegex(template.text) ? formatTextValue(template.text) : node
    const line = `${indent}- text: ${resolvedText}`
    return { resolved: [line], pass: matched }
  }

  if (typeof node === 'string' || template.kind === 'text') {
    // TODO: basically renderAriaNode(node) with indent?
    const line =
      typeof node === 'string'
        ? `${indent}- text: ${node}`
        : (() => {
            const l: string[] = []
            renderNodeLines(node, indent, l)
            return l.join('\n')
          })()
    return { resolved: [line], pass: false }
  }

  // Match role name, e.g. `- role`
  let namePass = matchesStringOrRegex(node.name, template.name)

  // Resolved key, e.g. `- role "name" [props]`
  const resolvedKey =
    namePass && isRegexName(template.name)
      ? renderKeyWithName(node, template.name)
      : createAriaKey(node)

  // Recurse into children
  const childResult = mergeChildLists(
    node.children,
    template.children || [],
    `${indent}  `
  )

  // Build pseudo-child lines for props
  const resolvedPseudo: string[] = []

  const allPropKeys = new Set([
    ...Object.keys(node.props),
    ...Object.keys(template.props || {}),
  ])

  for (const prop of allPropKeys) {
    const nodeVal = node.props[prop]
    const tmplVal = template.props?.[prop]
    if (nodeVal !== undefined) {
      const matched = tmplVal === undefined || matchesTextValue(nodeVal, tmplVal)
      const display =
        matched && tmplVal && cachedRegex(tmplVal)
          ? formatTextValue(tmplVal)
          : nodeVal
      resolvedPseudo.push(`${indent}  - /${prop}: ${display}`)
    }
  }

  let propsPass = true
  if (template.props) {
    for (const [key, tv] of Object.entries(template.props)) {
      if (!matchesTextValue(node.props[key] || '', tv)) {
        propsPass = false
        break
      }
    }
  }

  const attrPass =
    (template.level === undefined || template.level === node.level) &&
    (template.checked === undefined || template.checked === node.checked) &&
    (template.disabled === undefined || template.disabled === node.disabled) &&
    (template.expanded === undefined || template.expanded === node.expanded) &&
    (template.pressed === undefined || template.pressed === node.pressed) &&
    (template.selected === undefined || template.selected === node.selected)

  const pass = namePass && attrPass && propsPass && childResult.pass

  const resolved: string[] = []

  if (!childResult.resolved.length && !resolvedPseudo.length) {
    // one liner node with no props, e.g. `- role "name" [props]`
    resolved.push(`${indent}- ${resolvedKey}`)
  } else if (
    childResult.resolved.length === 1 &&
    childResult.resolved[0].trimStart().startsWith('- text: ') &&
    !resolvedPseudo.length
  ) {
    // one liner node with text child, e.g. `- role "name" [props]: text`
    const text = childResult.resolved[0].trimStart().slice('- text: '.length)
    resolved.push(`${indent}- ${resolvedKey}: ${text}`)
  } else {
    // multi-line node with children and/or props, e.g.
    // - role "name" [props]:
    //    - child
    //    - /prop: value
    resolved.push(`${indent}- ${resolvedKey}:`)
    resolved.push(...childResult.resolved)
    resolved.push(...resolvedPseudo)
  }

  return { resolved, pass }
}
