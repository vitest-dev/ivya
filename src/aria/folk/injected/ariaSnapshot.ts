/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Forked from https://github.com/microsoft/playwright/blob/v1.58.2/packages/injected/src/ariaSnapshot.ts
// Stripped: AI-mode features (refs, cursor, compareSnapshots, filterSnapshotDiff,
//           convertToBestGuessRegex, textContributesInfo, AriaTreeOptions modes
//           other than 'expect'). Only 'expect' mode is supported.
//
// Required updates to ivya before this compiles:
//   - roleUtils.ts: export kAriaDisabledRoles (currently not exported)
//   - roleUtils.ts: add getCSSContent() (present in Playwright v1.58.2 but
//     missing from ivya's fork — needed for ::before/::after pseudo-element text)

import type * as aria from '../isomorphic/ariaSnapshot'
import { getElementComputedStyle } from '../../../domUtils'
import * as roleUtils from '../../../roleUtils'
import { normalizeWhiteSpace } from '../../../stringUtils'

// Stub box for expect mode — visibility/cursor/inline are not used for matching.
const defaultBox: aria.AriaBox = { visible: true, inline: false }

// ---------------------------------------------------------------------------
// capture – DOM -> AriaNode tree
// ---------------------------------------------------------------------------

export function generateAriaTree(rootElement: Element): aria.AriaNode {
  const visited = new Set<Node>()

  const root: aria.AriaNode = { role: 'fragment', name: '', children: [], props: {}, box: defaultBox, receivesPointerEvents: true }

  const visit = (ariaNode: aria.AriaNode, node: Node, parentElementVisible: boolean) => {
    if (visited.has(node))
      return
    visited.add(node)

    if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
      if (!parentElementVisible)
        return

      const text = node.nodeValue
      // <textarea>AAA</textarea> should not report AAA as a child of the textarea.
      if (ariaNode.role !== 'textbox' && text)
        ariaNode.children.push(node.nodeValue || '')
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE)
      return

    const element = node as Element
    const visible = !roleUtils.isElementHiddenForAria(element)

    // Optimization: if not visible for aria, skip child elements too.
    if (!visible)
      return

    const ariaChildren: Element[] = []
    if (element.hasAttribute('aria-owns')) {
      const ids = element.getAttribute('aria-owns')!.split(/\s+/)
      for (const id of ids) {
        const ownedElement = rootElement.ownerDocument.getElementById(id)
        if (ownedElement)
          ariaChildren.push(ownedElement)
      }
    }

    const childAriaNode = toAriaNode(element)
    if (childAriaNode)
      ariaNode.children.push(childAriaNode)
    processElement(childAriaNode || ariaNode, element, ariaChildren, visible)
  }

  function processElement(ariaNode: aria.AriaNode, element: Element, ariaChildren: Element[], parentElementVisible: boolean) {
    // Surround every element with spaces for the sake of concatenated text nodes.
    const display = getElementComputedStyle(element)?.display || 'inline'
    const treatAsBlock = (display !== 'inline' || element.nodeName === 'BR') ? ' ' : ''
    if (treatAsBlock)
      ariaNode.children.push(treatAsBlock)

    // TODO: uncomment when getCSSContent is added to ivya's roleUtils
    // ariaNode.children.push(roleUtils.getCSSContent(element, '::before') || '')
    const assignedNodes = element.nodeName === 'SLOT' ? (element as HTMLSlotElement).assignedNodes() : []
    if (assignedNodes.length) {
      for (const child of assignedNodes)
        visit(ariaNode, child, parentElementVisible)
    }
    else {
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (!(child as Element | Text).assignedSlot)
          visit(ariaNode, child, parentElementVisible)
      }
      if (element.shadowRoot) {
        for (let child = element.shadowRoot.firstChild; child; child = child.nextSibling)
          visit(ariaNode, child, parentElementVisible)
      }
    }

    for (const child of ariaChildren)
      visit(ariaNode, child, parentElementVisible)

    // TODO: uncomment when getCSSContent is added to ivya's roleUtils
    // ariaNode.children.push(roleUtils.getCSSContent(element, '::after') || '')

    if (treatAsBlock)
      ariaNode.children.push(treatAsBlock)

    if (ariaNode.children.length === 1 && ariaNode.name === ariaNode.children[0])
      ariaNode.children = []

    if (ariaNode.role === 'link' && element.hasAttribute('href')) {
      const href = element.getAttribute('href')!
      ariaNode.props.url = href
    }

    if (ariaNode.role === 'textbox' && element.hasAttribute('placeholder') && element.getAttribute('placeholder') !== ariaNode.name) {
      const placeholder = element.getAttribute('placeholder')!
      ariaNode.props.placeholder = placeholder
    }
  }

  roleUtils.beginAriaCaches()
  try {
    visit(root, rootElement, true)
  }
  finally {
    roleUtils.endAriaCaches()
  }

  normalizeStringChildren(root)
  return root
}

function toAriaNode(element: Element): aria.AriaNode | null {
  const role = roleUtils.getAriaRole(element) ?? null
  if (!role || role === 'presentation' || role === 'none')
    return null

  const name = normalizeWhiteSpace(roleUtils.getElementAccessibleName(element, false) || '')

  const result: aria.AriaNode = {
    role: role as aria.AriaRole,
    name,
    children: [],
    props: {},
    box: defaultBox,
    receivesPointerEvents: true,
  }

  if (roleUtils.kAriaCheckedRoles.includes(role))
    result.checked = roleUtils.getAriaChecked(element)

  // kAriaDisabledRoles is not exported from ivya's roleUtils yet.
  // getAriaDisabled checks the role internally, so calling it unconditionally is safe.
  result.disabled = roleUtils.getAriaDisabled(element) || undefined

  if (roleUtils.kAriaExpandedRoles.includes(role)) {
    const expanded = roleUtils.getAriaExpanded(element)
    // ivya returns 'none' when aria-expanded is absent; normalize to undefined
    result.expanded = expanded === 'none' ? undefined : expanded
  }

  if (roleUtils.kAriaLevelRoles.includes(role))
    result.level = roleUtils.getAriaLevel(element)

  if (roleUtils.kAriaPressedRoles.includes(role))
    result.pressed = roleUtils.getAriaPressed(element)

  if (roleUtils.kAriaSelectedRoles.includes(role))
    result.selected = roleUtils.getAriaSelected(element)

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.type !== 'checkbox' && element.type !== 'radio' && element.type !== 'file')
      result.children = [element.value]
  }

  return result
}

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

function normalizeStringChildren(rootA11yNode: aria.AriaNode) {
  const flushChildren = (buffer: string[], normalizedChildren: (aria.AriaNode | string)[]) => {
    if (!buffer.length)
      return
    const text = normalizeWhiteSpace(buffer.join(''))
    if (text)
      normalizedChildren.push(text)
    buffer.length = 0
  }

  const visit = (ariaNode: aria.AriaNode) => {
    const normalizedChildren: (aria.AriaNode | string)[] = []
    const buffer: string[] = []
    for (const child of ariaNode.children || []) {
      if (typeof child === 'string') {
        buffer.push(child)
      }
      else {
        flushChildren(buffer, normalizedChildren)
        visit(child)
        normalizedChildren.push(child)
      }
    }
    flushChildren(buffer, normalizedChildren)
    ariaNode.children = normalizedChildren.length ? normalizedChildren : []
    if (ariaNode.children.length === 1 && ariaNode.children[0] === ariaNode.name)
      ariaNode.children = []
  }
  visit(rootA11yNode)
}

// ---------------------------------------------------------------------------
// render – AriaNode tree -> YAML-like string
// ---------------------------------------------------------------------------

export function renderAriaTree(root: aria.AriaNode): string {
  const lines: string[] = []

  const nodesToRender = root.role === 'fragment' ? root.children : [root]

  const visitText = (text: string, indent: string) => {
    if (text)
      lines.push(`${indent}- text: ${text}`)
  }

  const createKey = (ariaNode: aria.AriaNode): string => {
    let key = ariaNode.role
    if (ariaNode.name && ariaNode.name.length <= 900) {
      const stringifiedName = JSON.stringify(ariaNode.name)
      key += ` ${stringifiedName}`
    }
    if (ariaNode.checked === 'mixed')
      key += ' [checked=mixed]'
    if (ariaNode.checked === true)
      key += ' [checked]'
    if (ariaNode.disabled)
      key += ' [disabled]'
    if (ariaNode.expanded)
      key += ' [expanded]'
    if (ariaNode.level)
      key += ` [level=${ariaNode.level}]`
    if (ariaNode.pressed === 'mixed')
      key += ' [pressed=mixed]'
    if (ariaNode.pressed === true)
      key += ' [pressed]'
    if (ariaNode.selected === true)
      key += ' [selected]'
    return key
  }

  const visit = (ariaNode: aria.AriaNode, indent: string) => {
    const escapedKey = `${indent}- ${createKey(ariaNode)}`
    const singleTextChild = ariaNode.children.length === 1 && typeof ariaNode.children[0] === 'string' && !Object.keys(ariaNode.props).length
      ? ariaNode.children[0]
      : undefined

    if (!ariaNode.children.length && !Object.keys(ariaNode.props).length) {
      lines.push(escapedKey)
    }
    else if (singleTextChild !== undefined) {
      lines.push(`${escapedKey}: ${singleTextChild}`)
    }
    else {
      lines.push(`${escapedKey}:`)
      for (const [name, value] of Object.entries(ariaNode.props))
        lines.push(`${indent}  - /${name}: ${value}`)

      const childIndent = `${indent}  `
      for (const child of ariaNode.children) {
        if (typeof child === 'string')
          visitText(child, childIndent)
        else
          visit(child, childIndent)
      }
    }
  }

  for (const nodeToRender of nodesToRender) {
    if (typeof nodeToRender === 'string')
      visitText(nodeToRender, '')
    else
      visit(nodeToRender, '')
  }
  return lines.join('\n')
}
