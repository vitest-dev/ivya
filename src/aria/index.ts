/**
 * ARIA snapshot: capture, render, parse, match.
 *
 * Re-exports the Playwright-forked folk/ layer and adds vitest-specific
 * three-way merge matching (matchAriaTree) on top.
 *
 * All types are Playwright's types from folk/isomorphic — no conversion layer.
 */

import { generateAriaTree, renderAriaTree } from './folk/injected/ariaSnapshot'
import {
  parseAriaSnapshotUnsafe,
  matchesNode,
  containsList,
} from './folk/isomorphic/ariaSnapshot'
import type {
  AriaNode,
  AriaRegex,
  AriaTextValue,
  AriaTemplateNode,
  AriaTemplateRoleNode,
  AriaTemplateTextNode,
} from './folk/isomorphic/ariaSnapshot'

// ---------------------------------------------------------------------------
// Re-exports — folk types and functions as public API
// ---------------------------------------------------------------------------

export { generateAriaTree as captureAriaTree, renderAriaTree } from './folk/injected/ariaSnapshot'
export {
  parseAriaSnapshotUnsafe,
  matchesNode,
  containsList,
  KeyParser,
  ParserError,
  textValue,
} from './folk/isomorphic/ariaSnapshot'
export type {
  AriaRole,
  AriaProps,
  AriaBox,
  AriaNode,
  AriaTemplateNode,
  AriaTemplateRoleNode,
  AriaTemplateTextNode,
  AriaRegex,
  AriaTextValue,
  ParsedYamlError,
} from './folk/isomorphic/ariaSnapshot'

// ---------------------------------------------------------------------------
// parseAriaTemplate — wraps folk's YAML-based parser
// ---------------------------------------------------------------------------

export function parseAriaTemplate(text: string, yamlLib: any): AriaTemplateNode {
  return parseAriaSnapshotUnsafe(yamlLib, text)
}

// ---------------------------------------------------------------------------
// matchAriaTree — three-way merge matching (vitest-specific)
// ---------------------------------------------------------------------------

export interface MatchAriaResult {
  pass: boolean
  actual: string
  expected: string
  mergedExpected: string
}

export function matchAriaTree(root: AriaNode, template: AriaTemplateNode): MatchAriaResult {
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
    template.role === 'fragment' ? (template.children || []) : [template],
    '',
  )

  return {
    pass: result.pass,
    actual: result.actual.join('\n'),
    expected: result.expected.join('\n'),
    mergedExpected: result.merged.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Three-way merge internals
//
// All helpers below operate on Playwright's AriaNode / AriaTemplateNode types.
// They use folk's matchesNode for boolean matching and produce three parallel
// line arrays (actual, expected, merged) for diff + partial snapshot update.
// ---------------------------------------------------------------------------

interface MergeLines {
  actual: string[]
  expected: string[]
  merged: string[]
  pass: boolean
}

// --- Text/name matching helpers ---

function matchesTextValue(actual: string, tv: AriaTextValue): boolean {
  if (!tv.normalized) return true
  if (!actual) return false
  if (actual === tv.normalized) return true
  if (actual === tv.raw) return true
  const regex = textValueRegex(tv)
  if (regex) return regex.test(actual)
  return false
}

function textValueRegex(tv: AriaTextValue): RegExp | null {
  const { raw } = tv
  if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 1) {
    try { return new RegExp(raw.slice(1, -1)) }
    catch { return null }
  }
  return null
}

function matchesNameValue(actual: string, template: AriaRegex | string | undefined): boolean {
  if (template === undefined) return true
  if (!actual) return false
  if (typeof template === 'string') return actual === template
  return !!actual.match(new RegExp(template.pattern))
}

function isRegexName(name: AriaRegex | string | undefined): name is AriaRegex {
  return typeof name === 'object' && name !== null && 'pattern' in name
}

// --- Rendering helpers ---

function formatTextValue(tv: AriaTextValue): string {
  const regex = textValueRegex(tv)
  if (regex) return `/${tv.raw.slice(1, -1)}/`
  return tv.normalized
}

function formatNameValue(name: AriaRegex | string): string {
  if (typeof name === 'string') return JSON.stringify(name)
  return `/${name.pattern}/`
}

function renderActualKey(node: AriaNode, nameOverride?: AriaRegex | string): string {
  let key = node.role as string
  const name = nameOverride !== undefined ? nameOverride : node.name
  if (name) {
    key += ` ${typeof name === 'string' ? JSON.stringify(name) : formatNameValue(name)}`
  }
  key += renderAttrSuffix(node)
  return key
}

function renderTemplateKey(tmpl: AriaTemplateRoleNode): string {
  let key = tmpl.role as string
  if (tmpl.name !== undefined) {
    key += ` ${formatNameValue(tmpl.name)}`
  }
  key += renderTemplateAttrSuffix(tmpl)
  return key
}

function renderAttrSuffix(node: { level?: number, checked?: boolean | 'mixed', disabled?: boolean, expanded?: boolean, pressed?: boolean | 'mixed', selected?: boolean }): string {
  let s = ''
  if (node.level) s += ` [level=${node.level}]`
  if (node.checked === true) s += ' [checked]'
  if (node.checked === 'mixed') s += ' [checked=mixed]'
  if (node.disabled) s += ' [disabled]'
  if (node.expanded === true) s += ' [expanded]'
  if (node.expanded === false) s += ' [expanded=false]'
  if (node.pressed === true) s += ' [pressed]'
  if (node.pressed === 'mixed') s += ' [pressed=mixed]'
  if (node.selected) s += ' [selected]'
  return s
}

function renderTemplateAttrSuffix(tmpl: AriaTemplateRoleNode): string {
  return renderAttrSuffix(tmpl)
}

function renderNodeLines(node: AriaNode, indent: string, lines: string[]): void {
  const key = renderActualKey(node)
  const hasProps = Object.keys(node.props).length > 0

  if (!node.children.length && !hasProps) {
    lines.push(`${indent}- ${key}`)
    return
  }

  if (node.children.length === 1 && typeof node.children[0] === 'string' && !hasProps) {
    lines.push(`${indent}- ${key}: ${node.children[0]}`)
    return
  }

  lines.push(`${indent}- ${key}:`)
  for (const [name, value] of Object.entries(node.props))
    lines.push(`${indent}  - /${name}: ${value}`)
  for (const child of node.children) {
    if (typeof child === 'string') {
      lines.push(`${indent}  - text: ${child}`)
    }
    else {
      renderNodeLines(child, `${indent}  `, lines)
    }
  }
}

function renderTemplateNodeLines(tmpl: AriaTemplateRoleNode, indent: string, lines: string[]): void {
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
  if (children.length === 1 && children[0].kind === 'text' && pseudoLines.length === 0) {
    lines.push(`${indent}- ${key}: ${formatTextValue(children[0].text)}`)
    return
  }
  lines.push(`${indent}- ${key}:`)
  for (const child of children) {
    if (child.kind === 'text') {
      lines.push(`${indent}  - text: ${formatTextValue(child.text)}`)
    }
    else {
      renderTemplateNodeLines(child, `${indent}  `, lines)
    }
  }
  lines.push(...pseudoLines)
}

// --- Pairing ---

function pairChildren(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[],
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

// --- Merge ---

function mergeChildLists(
  children: (AriaNode | string)[],
  templates: AriaTemplateNode[],
  indent: string,
): MergeLines {
  const actual: string[] = []
  const expected: string[] = []
  const merged: string[] = []

  const pairs = pairChildren(children, templates)
  const allTemplatesMatched = pairs.size === templates.length

  function renderChild(child: AriaNode | string): string[] {
    const lines: string[] = []
    if (typeof child === 'string') {
      lines.push(`${indent}- text: ${child}`)
    }
    else {
      renderNodeLines(child, indent, lines)
    }
    return lines
  }

  if (!allTemplatesMatched) {
    // BAIL OUT: some template had no match — render full actual (maximally strict).
    const mergeResults = new Map<number, MergeLines>()
    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci]
      const ti = pairs.get(ci)
      if (ti !== undefined) {
        const r = mergeNode(child, templates[ti], indent)
        mergeResults.set(ti, r)
        actual.push(...r.actual)
        merged.push(...r.merged)
      }
      else {
        const rendered = renderChild(child)
        actual.push(...rendered)
        merged.push(...rendered)
      }
    }

    for (let ti = 0; ti < templates.length; ti++) {
      const r = mergeResults.get(ti)
      if (r) {
        expected.push(...r.expected)
      }
      else {
        const tmpl = templates[ti]
        if (tmpl.kind === 'text') {
          expected.push(`${indent}- text: ${formatTextValue(tmpl.text)}`)
        }
        else {
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
    const child = children[ci]
    const ti = pairs.get(ci)

    if (ti !== undefined) {
      const r = mergeNode(child, templates[ti], indent)
      actual.push(...r.actual)
      expected.push(...r.expected)
      merged.push(...r.merged)
      if (!r.pass) {
        allPass = false
      }
    }
    else {
      actual.push(...renderChild(child))
    }
  }

  return { actual, expected, merged, pass: allPass }
}

function mergeNode(
  node: AriaNode | string,
  template: AriaTemplateNode,
  indent: string,
): MergeLines {
  // Text node
  if (typeof node === 'string' && template.kind === 'text') {
    const matched = matchesTextValue(node, template.text)
    if (matched && textValueRegex(template.text)) {
      // Regex matched — show pattern form in all three (cancels in diff)
      const patternStr = `${indent}- text: ${formatTextValue(template.text)}`
      return { actual: [patternStr], expected: [patternStr], merged: [patternStr], pass: true }
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
    const actualLine = typeof node === 'string'
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
      if (matchesNameValue(node.name, template.name)) {
        mergedName = template.name
      }
      else {
        namePass = false
      }
    }
    else {
      if (template.name !== node.name) {
        namePass = false
      }
    }
  }

  const attrPass = (template.level === undefined || template.level === node.level)
    && (template.checked === undefined || template.checked === node.checked)
    && (template.disabled === undefined || template.disabled === node.disabled)
    && (template.expanded === undefined || template.expanded === node.expanded)
    && (template.pressed === undefined || template.pressed === node.pressed)
    && (template.selected === undefined || template.selected === node.selected)

  // Check props match
  let propsPass = true
  if (template.props) {
    for (const [key, tv] of Object.entries(template.props)) {
      if (!matchesTextValue(node.props[key] || '', tv)) {
        propsPass = false
        break
      }
    }
  }

  // Build the key line for each output
  const actualKey = namePass && isRegexName(template.name)
    ? renderActualKey(node, template.name)
    : renderActualKey(node)
  const expectedKey = renderTemplateKey(template)
  const mergedKey = renderActualKey(node, mergedName)

  // Recurse into children
  const childResult = mergeChildLists(
    node.children,
    template.children || [],
    `${indent}  `,
  )

  // Build pseudo-child lines for props (/url, /placeholder, etc.)
  const actualPseudo: string[] = []
  const expectedPseudo: string[] = []
  const mergedPseudo: string[] = []

  // Collect all prop keys from both node and template
  const allPropKeys = new Set([
    ...Object.keys(node.props),
    ...Object.keys(template.props || {}),
  ])

  for (const prop of allPropKeys) {
    const nodeVal = node.props[prop]
    const tmplVal = template.props?.[prop]
    if (nodeVal !== undefined || tmplVal !== undefined) {
      const matched = tmplVal === undefined || matchesTextValue(nodeVal || '', tmplVal)

      if (nodeVal !== undefined) {
        const actualDisplay = matched && tmplVal && textValueRegex(tmplVal) ? formatTextValue(tmplVal) : nodeVal
        actualPseudo.push(`${indent}  - /${prop}: ${actualDisplay}`)
      }
      if (tmplVal !== undefined) {
        expectedPseudo.push(`${indent}  - /${prop}: ${formatTextValue(tmplVal)}`)
      }
      if (nodeVal !== undefined) {
        const mergedDisplay = matched && tmplVal !== undefined ? formatTextValue(tmplVal) : nodeVal
        mergedPseudo.push(`${indent}  - /${prop}: ${mergedDisplay}`)
      }
    }
  }

  const pass = namePass && attrPass && propsPass && childResult.pass

  const actual: string[] = []
  const expected: string[] = []
  const merged: string[] = []

  const hasActualChildren = childResult.actual.length > 0 || actualPseudo.length > 0
  const hasExpectedChildren = childResult.expected.length > 0 || expectedPseudo.length > 0
  const hasMergedChildren = childResult.merged.length > 0 || mergedPseudo.length > 0

  if (!hasActualChildren) {
    actual.push(`${indent}- ${actualKey}`)
  }
  else if (childResult.actual.length === 1 && !actualPseudo.length && childResult.actual[0].trimStart().startsWith('- text: ')) {
    const text = childResult.actual[0].trimStart().slice('- text: '.length)
    actual.push(`${indent}- ${actualKey}: ${text}`)
  }
  else {
    actual.push(`${indent}- ${actualKey}:`)
    actual.push(...childResult.actual)
    actual.push(...actualPseudo)
  }

  if (!hasExpectedChildren) {
    expected.push(`${indent}- ${expectedKey}`)
  }
  else if (childResult.expected.length === 1 && !expectedPseudo.length && childResult.expected[0].trimStart().startsWith('- text: ')) {
    const text = childResult.expected[0].trimStart().slice('- text: '.length)
    expected.push(`${indent}- ${expectedKey}: ${text}`)
  }
  else {
    expected.push(`${indent}- ${expectedKey}:`)
    expected.push(...childResult.expected)
    expected.push(...expectedPseudo)
  }

  if (!hasMergedChildren) {
    merged.push(`${indent}- ${mergedKey}`)
  }
  else if (childResult.merged.length === 1 && !mergedPseudo.length && childResult.merged[0].trimStart().startsWith('- text: ')) {
    const text = childResult.merged[0].trimStart().slice('- text: '.length)
    merged.push(`${indent}- ${mergedKey}: ${text}`)
  }
  else {
    merged.push(`${indent}- ${mergedKey}:`)
    merged.push(...childResult.merged)
    merged.push(...mergedPseudo)
  }

  return { actual, expected, merged, pass }
}
