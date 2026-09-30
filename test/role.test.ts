import { getByRoleSelector, Ivya } from '../src'
import { getAriaRole } from '../src/roleUtils'
import { afterEach, describe, expect, test } from 'vitest'

function render(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  return container
}

function roleOf(html: string) {
  const target = render(html).querySelector('#target')!
  return getAriaRole(target)
}

afterEach(() => {
  document.body.innerHTML = ''
})

// Cases mirror Playwright's tests/assets/axe-core/implicit-role.js (microsoft/playwright#38160)
describe('implicit role of th without scope', () => {
  test('th in a header row is a columnheader', () => {
    expect(
      roleOf(
        '<table><thead><tr><th id="target">A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
      )
    ).toBe('columnheader')
    expect(
      roleOf(
        '<table><thead><tr><th>A</th><th id="target">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
      )
    ).toBe('columnheader')
  })

  test('th in a header row without thead is a columnheader', () => {
    expect(
      roleOf(
        '<table><tr><th>A</th><th id="target">B</th><th>C</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>'
      )
    ).toBe('columnheader')
  })

  test('th first in a body row next to a data cell is a rowheader', () => {
    expect(
      roleOf(
        '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><th id="target">1</th><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>'
      )
    ).toBe('rowheader')
  })

  test('th next to an empty data cell is a columnheader', () => {
    expect(
      roleOf(
        '<table><tr><th id="target">A</th><td></td></tr><tr><td>1</td><td>2</td></tr></table>'
      )
    ).toBe('columnheader')
  })

  test('the only th in a single-row table has no role', () => {
    expect(roleOf('<table><tr><th id="target">A</th></tr></table>')).toBe(null)
  })

  test('the only th in its row of a multi-row table is a columnheader', () => {
    expect(
      roleOf(
        '<table><thead><tr><th id="target">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
      )
    ).toBe('columnheader')
  })
})

describe('explicit scope on th wins', () => {
  test.each([
    ['col', 'columnheader'],
    ['colgroup', 'columnheader'],
    ['row', 'rowheader'],
    ['rowgroup', 'rowheader'],
  ])('scope="%s" is a %s', (scope, role) => {
    // a header-row position would imply columnheader, a data-cell sibling rowheader
    expect(
      roleOf(
        `<table><thead><tr><th>A</th><th id="target" scope="${scope}">B</th><th>C</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>`
      )
    ).toBe(role)
    expect(
      roleOf(
        `<table><tbody><tr><th id="target" scope="${scope}">1</th><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>`
      )
    ).toBe(role)
  })
})

// https://github.com/vitest-dev/vitest/issues/8054
test('getByRole finds header cells without scope', () => {
  const container = render(`
    <table>
      <thead><tr><th>Column 1</th><th>Column 2</th></tr></thead>
      <tbody>
        <tr><th>Row 1</th><td>Hello</td></tr>
        <tr><th>Row 2</th><td>World</td></tr>
      </tbody>
    </table>
  `)
  const ivya = Ivya.create({ browser: 'chromium' })
  const [column1, column2, row1, row2] = container.querySelectorAll('th')

  expect(ivya.queryAllByRole('columnheader')).toEqual([column1, column2])
  expect(ivya.queryAllByRole('rowheader')).toEqual([row1, row2])
  expect(
    ivya.queryLocatorSelector(
      getByRoleSelector('columnheader', { name: 'Column 1' })
    )
  ).toBe(column1)
})
