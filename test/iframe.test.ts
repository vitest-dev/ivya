import { getByTestIdSelector, Ivya } from '../src'
import { expect, test } from 'vitest'

test('locates element inside iframe', async () => {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('data-testid', 'test-iframe')
  iframe.srcdoc = '<body><button>Click me</button>'
  document.body.appendChild(iframe)

  const ivya = Ivya.create({
    browser: 'chromium',
  })

  // wait for iframe to load
  await new Promise((resolve) => (iframe.onload = resolve))

  const iframeSelector = getByTestIdSelector('data-testid', 'test-iframe')
  expect(ivya.queryLocatorSelector(iframeSelector)).toBe(iframe)

  const button = iframe.contentDocument!.querySelector('button')
  expect(
    ivya.queryLocatorSelector('iframe >> internal:control=enter-frame >> button')
  ).toBe(button)
})
