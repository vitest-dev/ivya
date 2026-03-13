/**
 * ARIA snapshot: capture, render, parse, match.
 *
 * Re-exports the Playwright-forked folk/ layer and adds vitest-specific
 * three-way merge matching (matchAriaTree) on top.
 *
 * All types are Playwright's types from folk/isomorphic — no conversion layer.
 */

import {
  generateAriaTree,
  renderAriaTree,
  renderNodeLines,
  createAriaKey,
} from './folk/injected/ariaSnapshot'
import {
  parseAriaSnapshotUnsafe,
  matchesNode,
  matchesTextValue,
  matchesStringOrRegex,
  cachedRegex,
} from './folk/isomorphic/ariaSnapshot'
import type {
  AriaNode,
  AriaRegex,
  AriaTextValue,
  AriaTemplateNode,
  AriaTemplateRoleNode,
  AriaTemplateTextNode,
} from './folk/isomorphic/ariaSnapshot'

// Simple re-export for
//   dom -> aria tree        (generateAriaTree)
//   aria tree -> yaml text  (renderAriaTree)
//   yaml text -> aria tree  (parseAriaTemplate)

export { generateAriaTree, renderAriaTree }

export function parseAriaTemplate(yamlLib: any, text: string): AriaTemplateNode {
  return parseAriaSnapshotUnsafe(yamlLib, text)
}

// ---------------------------------------------------------------------------
// matchAriaTree — three-way merge matching (vitest-specific)
//
// Uses folk's matchesNode for boolean matching and folk's renderNodeLines
// for actual-side rendering. Only the merge assembly and template rendering
// (which Playwright doesn't need) are implemented here.
// ---------------------------------------------------------------------------

export interface MatchAriaResult {
  pass: boolean
  actual: string
  expected: string
  mergedExpected: string
}

export function matchAriaTree(
  root: AriaNode,
  template: AriaTemplateNode
): MatchAriaResult {
  if (template.kind !== 'role') {
    const rendered = renderAriaTree(root)
    return {
      pass: false,
      actual: rendered,
      expected: formatTextValue((template as AriaTemplateTextNode).text),
      mergedExpected: rendered,
    }
  }

  const result = mergeChildLists(
    root.role === 'fragment' ? root.children : [root],
    template.role === 'fragment' ? template.children || [] : [template],
    ''
  )

  return {
    pass: result.pass,
    actual: result.actual.join('\n'),
    expected: result.expected.join('\n'),
    mergedExpected: result.merged.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Merge internals
// ---------------------------------------------------------------------------

interface MergeLines {
  actual: string[]
  expected: string[]
  merged: string[]
  pass: boolean
}

// --- Format helpers (merge-specific, no folk equivalent) ---

function formatTextValue(tv: AriaTextValue): string {
  if (cachedRegex(tv)) return `/${tv.raw.slice(1, -1)}/`
  return tv.normalized
}

function formatNameValue(name: AriaRegex | string): string {
  if (typeof name === 'string') return JSON.stringify(name)
  return `/${name.pattern}/`
}

function isRegexName(name: AriaRegex | string | undefined): name is AriaRegex {
  return typeof name === 'object' && name !== null && 'pattern' in name
}

// --- Template rendering (Playwright doesn't render templates back to text) ---

function renderTemplateKey(tmpl: AriaTemplateRoleNode): string {
  let key = tmpl.role as string
  if (tmpl.name !== undefined) key += ` ${formatNameValue(tmpl.name)}`
  if (tmpl.level) key += ` [level=${tmpl.level}]`
  if (tmpl.checked === true) key += ' [checked]'
  if (tmpl.checked === 'mixed') key += ' [checked=mixed]'
  if (tmpl.disabled) key += ' [disabled]'
  if (tmpl.expanded === true) key += ' [expanded]'
  if (tmpl.expanded === false) key += ' [expanded=false]'
  if (tmpl.pressed === true) key += ' [pressed]'
  if (tmpl.pressed === 'mixed') key += ' [pressed=mixed]'
  if (tmpl.selected) key += ' [selected]'
  return key
}

function renderTemplateNodeLines(
  tmpl: AriaTemplateRoleNode,
  indent: string,
  lines: string[]
): void {
  const key = renderTemplateKey(tmpl)
  const children = tmpl.children || []

  const pseudoLines: string[] = []
  if (tmpl.props) {
    for (const [name, tv] of Object.entries(tmpl.props))
      pseudoLines.push(`${indent}  - /${name}: ${formatTextValue(tv)}`)
  }

  if (children.length === 0 && pseudoLines.length === 0) {
    lines.push(`${indent}- ${key}`)
    return
  }
  if (
    children.length === 1 &&
    children[0].kind === 'text' &&
    pseudoLines.length === 0
  ) {
    lines.push(`${indent}- ${key}: ${formatTextValue(children[0].text)}`)
    return
  }
  lines.push(`${indent}- ${key}:`)
  for (const child of children) {
    if (child.kind === 'text') {
      lines.push(`${indent}  - text: ${formatTextValue(child.text)}`)
    } else {
      renderTemplateNodeLines(child, `${indent}  `, lines)
    }
  }
  lines.push(...pseudoLines)
}

// --- Actual-side key with name override (for regex-transparent diffing) ---

function renderActualKeyWithName(
  node: AriaNode,
  nameOverride: AriaRegex | string
): string {
  let key = node.role as string
  if (nameOverride) key += ` ${formatNameValue(nameOverride)}`
  if (node.level) key += ` [level=${node.level}]`
  if (node.checked === true) key += ' [checked]'
  if (node.checked === 'mixed') key += ' [checked=mixed]'
  if (node.disabled) key += ' [disabled]'
  if (node.expanded === true) key += ' [expanded]'
  if (node.expanded === false) key += ' [expanded=false]'
  if (node.pressed === true) key += ' [pressed]'
  if (node.pressed === 'mixed') key += ' [pressed=mixed]'
  if (node.selected) key += ' [selected]'
  return key
}

// --- Pairing + merge ---

function pairChildren(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[]
): Map<number, number> {
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
  const actual: string[] = []
  const expected: string[] = []
  const merged: string[] = []

  const pairs = pairChildren(children, templates)
  const allTemplatesMatched = pairs.size === templates.length

  if (!allTemplatesMatched) {
    // BAIL OUT: some template had no match — render full actual (maximally strict).
    const mergeResults = new Map<number, MergeLines>()
    for (let ci = 0; ci < children.length; ci++) {
      const ti = pairs.get(ci)
      if (ti !== undefined) {
        const r = mergeNode(children[ci], templates[ti], indent)
        mergeResults.set(ti, r)
        actual.push(...r.actual)
        merged.push(...r.merged)
      } else {
        const rendered = renderChildLines(children[ci], indent)
        actual.push(...rendered)
        merged.push(...rendered)
      }
    }

    for (let ti = 0; ti < templates.length; ti++) {
      const r = mergeResults.get(ti)
      if (r) {
        expected.push(...r.expected)
      } else {
        const tmpl = templates[ti]
        if (tmpl.kind === 'text') {
          expected.push(`${indent}- text: ${formatTextValue(tmpl.text)}`)
        } else {
          const tmplLines: string[] = []
          renderTemplateNodeLines(tmpl, indent, tmplLines)
          expected.push(...tmplLines)
        }
      }
    }

    return { actual, expected, merged, pass: false }
  }

  // PARTIAL MERGE: all templates matched — preserve partial structure.
  let allPass = true
  for (let ci = 0; ci < children.length; ci++) {
    const ti = pairs.get(ci)
    if (ti !== undefined) {
      const r = mergeNode(children[ci], templates[ti], indent)
      actual.push(...r.actual)
      expected.push(...r.expected)
      merged.push(...r.merged)
      if (!r.pass) allPass = false
    } else {
      actual.push(...renderChildLines(children[ci], indent))
    }
  }

  return { actual, expected, merged, pass: allPass }
}

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
        merged: [patternStr],
        pass: true,
      }
    }
    if (matched) {
      const line = `${indent}- text: ${node}`
      return { actual: [line], expected: [line], merged: [line], pass: true }
    }
    return {
      actual: [`${indent}- text: ${node}`],
      expected: [`${indent}- text: ${formatTextValue(template.text)}`],
      merged: [`${indent}- text: ${node}`],
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
    return { actual: [actualLine], expected: [], merged: [actualLine], pass: false }
  }

  // Role node — determine the name to show
  let namePass = true
  let mergedName: AriaRegex | string = node.name
  if (template.name !== undefined) {
    if (isRegexName(template.name)) {
      if (matchesStringOrRegex(node.name, template.name)) {
        mergedName = template.name
      } else {
        namePass = false
      }
    } else if (template.name !== node.name) {
      namePass = false
    }
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

  // Build key lines — use createAriaKey for plain actual, renderActualKeyWithName for overrides
  const actualKey =
    namePass && isRegexName(template.name)
      ? renderActualKeyWithName(node, template.name)
      : createAriaKey(node)
  const expectedKey = renderTemplateKey(template)
  const mergedKey =
    mergedName === node.name
      ? createAriaKey(node)
      : renderActualKeyWithName(node, mergedName)

  // Recurse into children
  const childResult = mergeChildLists(
    node.children,
    template.children || [],
    `${indent}  `
  )

  // Build pseudo-child lines for props
  const actualPseudo: string[] = []
  const expectedPseudo: string[] = []
  const mergedPseudo: string[] = []

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
      if (tmplVal !== undefined) {
        expectedPseudo.push(`${indent}  - /${prop}: ${formatTextValue(tmplVal)}`)
      }
      if (nodeVal !== undefined) {
        const mergedDisplay =
          matched && tmplVal !== undefined ? formatTextValue(tmplVal) : nodeVal
        mergedPseudo.push(`${indent}  - /${prop}: ${mergedDisplay}`)
      }
    }
  }

  const pass = namePass && attrPass && propsPass && childResult.pass

  const actual: string[] = []
  const expected: string[] = []
  const merged: string[] = []

  const hasActualChildren = childResult.actual.length > 0 || actualPseudo.length > 0
  const hasExpectedChildren =
    childResult.expected.length > 0 || expectedPseudo.length > 0
  const hasMergedChildren = childResult.merged.length > 0 || mergedPseudo.length > 0

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

  if (!hasMergedChildren) {
    merged.push(`${indent}- ${mergedKey}`)
  } else if (
    childResult.merged.length === 1 &&
    !mergedPseudo.length &&
    childResult.merged[0].trimStart().startsWith('- text: ')
  ) {
    const text = childResult.merged[0].trimStart().slice('- text: '.length)
    merged.push(`${indent}- ${mergedKey}: ${text}`)
  } else {
    merged.push(`${indent}- ${mergedKey}:`)
    merged.push(...childResult.merged)
    merged.push(...mergedPseudo)
  }

  return { actual, expected, merged, pass }
}
