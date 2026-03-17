/**
 * ARIA snapshot: capture, render, parse, match.
 *
 * Re-exports the Playwright-forked folk/ layer and adds vitest-specific
 * three-way merge matching (matchAriaTree) on top.
 *
 */

import {
  type AriaTemplateNode,
  parseAriaSnapshotUnsafe,
} from './folk/isomorphic/ariaSnapshot'

export type { AriaNode, AriaTemplateNode } from './folk/isomorphic/ariaSnapshot'

export { generateAriaTree, renderAriaTree } from './folk/injected/ariaSnapshot'

export { renderAriaTemplate } from './template'

export { matchAriaTree } from './match'

export function parseAriaTemplate(yamlLib: any, text: string): AriaTemplateNode {
  return parseAriaSnapshotUnsafe(yamlLib, text)
}
