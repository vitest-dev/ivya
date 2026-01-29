import { getByRoleSelector, Ivya } from '../src'
import { expect, test } from 'vitest'

test('works correctly', () => {
  const button = document.createElement('button')
  button.textContent = 'Click me'
  document.body.appendChild(button)

  const ivya = Ivya.create({
    browser: 'chromium',
  })

  const buttonSelector = getByRoleSelector('button', { name: 'Click me' })

  expect(
    ivya.queryLocatorSelector(buttonSelector)
  ).toBe(button)

  expect(
    ivya.queryLocatorSelector(`css=body >> ${buttonSelector}`)
  ).toBe(button)
})

test('file input', () => {
  const input = document.createElement('input')
  input.type = 'file'
  document.body.appendChild(input)

  const ivya = Ivya.create({
    browser: 'chromium',
  })

  expect(ivya.generateSelectorSimple(input)).toMatchInlineSnapshot(
    `"input[type="file"]"`
  )

  input.id = 'test1'
  expect(ivya.generateSelectorSimple(input)).toMatchInlineSnapshot(`"#test1"`)

  input.dataset.testid = 'test2'
  expect(ivya.generateSelectorSimple(input)).toMatchInlineSnapshot(
    `"internal:testid=[data-testid="test2"s]"`
  )
})
