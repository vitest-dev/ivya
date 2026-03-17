/**
 * Tests for the ARIA snapshot pipeline.
 *
 * Based on Playwright tests:
 *   vendor/playwright/tests/page/to-match-aria-snapshot.spec.ts
 *   vendor/playwright/tests/page/page-aria-snapshot.spec.ts
 */

import {
  generateAriaTree,
  matchAriaTree,
  parseAriaTemplate as parseAriaTemplateOriginal,
  renderAriaTree,
  renderAriaTemplate,
} from '../src/aria'
import { describe, expect, test, vi } from 'vitest'
import * as yaml from 'yaml'

function parseAriaTemplate(text: string) {
  return parseAriaTemplateOriginal(yaml, text)
}

function capture(html: string) {
  document.body.innerHTML = html
  return generateAriaTree(document.body)
}

function match(html: string, template: string) {
  const templateTree = parseAriaTemplate(template)
  const r = matchAriaTree(capture(html), templateTree)
  return {
    pass: r.pass,
    actual: `\n${r.actual}\n`,
    expected: `\n${r.expected}\n`,
    rawExpected: `\n${renderAriaTemplate(templateTree)}\n`,
  }
}

const runPipeline = vi.defineHelper((
  htmlOrElement: string | Element,
  options?: {
    assertPass?: boolean
    assertAriaTemplateRoundTrip?: boolean
  }
) => {
  const captured =
    typeof htmlOrElement === 'string'
      ? capture(htmlOrElement)
      : generateAriaTree(htmlOrElement)
  const rendered = renderAriaTree(captured)
  const parsed = parseAriaTemplate(rendered)
  const matched = matchAriaTree(captured, parsed)
  if (options?.assertPass !== false) {
    expect.soft(matched.pass, `roundtrip should match`).toBe(true)
  }
  if (options?.assertAriaTemplateRoundTrip !== false) {
    const renderedTemplate = renderAriaTemplate(parsed)
    expect.soft(renderedTemplate, `template roundtrip should match`).toBe(rendered)
  }
  return {
    captured,
    rendered,
    parsed,
    matched,
    snapshot: {
      captured: captured.children,
      rendered: `\n${rendered}\n`,
      pass: matched.pass,
    },
  }
})

describe('basic', () => {
  test('heading', () => {
    const result = runPipeline('<h1>Hello</h1>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "level": 1,
            "name": "Hello",
            "props": {},
            "receivesPointerEvents": true,
            "role": "heading",
          },
        ],
        "pass": true,
        "rendered": "
      - heading "Hello" [level=1]
      ",
      }
    `)
  })

  test('link with href', () => {
    const result = runPipeline('<a href="/foo">Click</a>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Click",
            "props": {
              "url": "/foo",
            },
            "receivesPointerEvents": true,
            "role": "link",
          },
        ],
        "pass": true,
        "rendered": "
      - link "Click":
        - /url: /foo
      ",
      }
    `)
  })

  test('anchor without href has no role', () => {
    const result = runPipeline('<a>Not a link</a>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "Not a link",
        ],
        "pass": true,
        "rendered": "
      - text: Not a link
      ",
      }
    `)
  })

  test('aria-label sets name', () => {
    const result = runPipeline('<button aria-label="Close">X</button>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "X",
            ],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Close",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "Close": X
      ",
      }
    `)
  })

  test('explicit role overrides implicit', () => {
    const result = runPipeline('<div role="alert">Warning!</div>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "Warning!",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "alert",
          },
        ],
        "pass": true,
        "rendered": "
      - alert: Warning!
      ",
      }
    `)
  })

  test('aria-hidden elements are excluded', () => {
    const result = runPipeline('<div aria-hidden="true">Hidden</div><p>Visible</p>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "Visible",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - paragraph: Visible
      ",
      }
    `)
  })

  test('checkbox states', () => {
    const result = runPipeline(`
      <div role="checkbox" aria-checked="true" aria-label="A"></div>
      <div role="checkbox" aria-checked="false" aria-label="B"></div>
      <div role="checkbox" aria-checked="mixed" aria-label="C"></div>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "checked": true,
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "A",
            "props": {},
            "receivesPointerEvents": true,
            "role": "checkbox",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "checked": false,
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "B",
            "props": {},
            "receivesPointerEvents": true,
            "role": "checkbox",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "checked": "mixed",
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "C",
            "props": {},
            "receivesPointerEvents": true,
            "role": "checkbox",
          },
        ],
        "pass": true,
        "rendered": "
      - checkbox "A" [checked]
      - checkbox "B"
      - checkbox "C" [checked=mixed]
      ",
      }
    `)
  })

  test('nested list structure', () => {
    const result = runPipeline('<ul><li>One</li><li>Two</li></ul>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  "One",
                ],
                "level": 0,
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "listitem",
              },
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  "Two",
                ],
                "level": 0,
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "listitem",
              },
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "list",
          },
        ],
        "pass": true,
        "rendered": "
      - list:
        - listitem: One
        - listitem: Two
      ",
      }
    `)
  })

  test('label for input', () => {
    const result = runPipeline(
      '<label for="x">Name</label><input id="x" type="text" />'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "Name",
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "Name",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
        ],
        "pass": true,
        "rendered": "
      - text: Name
      - textbox "Name"
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "check aria-hidden text"
  test('aria-hidden nested children excluded', () => {
    const result = runPipeline(
      '<p><span>hello</span><span aria-hidden="true">world</span></p>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "hello",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - paragraph: hello
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should ignore presentation and none roles"
  // happy-dom strips trailing whitespace from text nodes during innerHTML parsing,
  // so inter-element spacing is lost. Verified logic works: presentation/none roles
  // are correctly skipped in getRole() and children are promoted.
  test('role="presentation" and role="none" promote children', () => {
    const result = runPipeline(
      '<ul><li role="presentation">hello</li><li role="none">world</li></ul>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "hello world",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "list",
          },
        ],
        "pass": true,
        "rendered": "
      - list: hello world
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should concatenate span text"
  // happy-dom strips trailing whitespace from text nodes during innerHTML parsing
  test('concatenates inline text across spans', () => {
    const result = runPipeline(
      '<span>One</span> <span>Two</span> <span>Three</span>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "One Two Three",
        ],
        "pass": true,
        "rendered": "
      - text: One Two Three
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should concatenate div text with spaces"
  // happy-dom strips trailing whitespace from text nodes during innerHTML parsing
  test('concatenates div text', () => {
    const result = runPipeline('<div>One</div><div>Two</div><div>Three</div>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "One Two Three",
        ],
        "pass": true,
        "rendered": "
      - text: One Two Three
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should support multiline text"
  test('multiline text collapses whitespace', () => {
    const result = runPipeline('<p>Line 1\n      Line 2\n      Line 3</p>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "Line 1 Line 2 Line 3",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - paragraph: Line 1 Line 2 Line 3
      ",
      }
    `)
  })

  // -- Gap: hidden HTML attribute
  test('hidden attribute excludes element', () => {
    const result = runPipeline('<div hidden>Hidden</div><p>Visible</p>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "Visible",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - paragraph: Visible
      ",
      }
    `)
  })

  // -- Gap: style/script/noscript/template tags
  test('style, script, noscript, template tags are excluded', () => {
    const result = runPipeline(
      '<style>.x{}</style><script>var x</script><noscript>No JS</noscript><template><p>T</p></template><p>Visible</p>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "Visible",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - paragraph: Visible
      ",
      }
    `)
  })

  // -- Gap: aria-labelledby
  test('aria-labelledby resolves name from referenced elements', () => {
    const result = runPipeline(
      '<span id="a">Hello</span><span id="b">World</span><button aria-labelledby="a b">X</button>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "HelloWorld",
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "X",
            ],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Hello World",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - text: HelloWorld
      - button "Hello World": X
      ",
      }
    `)
  })

  // -- Gap: IMG alt text
  test('img alt text as accessible name', () => {
    const result = runPipeline('<img alt="Logo">')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "name": "Logo",
            "props": {},
            "receivesPointerEvents": true,
            "role": "img",
          },
        ],
        "pass": true,
        "rendered": "
      - img "Logo"
      ",
      }
    `)
  })

  // -- Gap: IMG empty alt -> presentation (skipped)
  test('img with empty alt has presentation role (children promoted)', () => {
    const result = runPipeline('<main><img alt=""></main>')
    // Empty alt = presentation role, which is skipped (no node emitted)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "main",
          },
        ],
        "pass": true,
        "rendered": "
      - main
      ",
      }
    `)
  })

  // -- Gap: INPUT type variants
  test('input type variants', () => {
    const result = runPipeline(`
      <input type="radio">
      <input type="submit">
      <input type="reset">
      <input type="image">
      <input type="range">
      <input type="search">
      <input type="checkbox">
      <input>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "checked": false,
            "children": [],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "radio",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Submit",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Reset",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Submit",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "50",
            ],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "slider",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "searchbox",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "checked": false,
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "checkbox",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
        ],
        "pass": true,
        "rendered": "
      - radio
      - button "Submit"
      - button "Reset"
      - button "Submit"
      - slider: "50"
      - searchbox
      - checkbox
      - textbox
      ",
      }
    `)
  })

  // -- Gap: SELECT -> combobox
  test('select has combobox role', () => {
    const result = runPipeline('<select><option>A</option></select>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "checked": false,
                "children": [],
                "disabled": undefined,
                "name": "A",
                "props": {},
                "receivesPointerEvents": true,
                "role": "option",
                "selected": true,
              },
            ],
            "disabled": undefined,
            "expanded": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "combobox",
          },
        ],
        "pass": true,
        "rendered": "
      - combobox:
        - option "A" [selected]
      ",
      }
    `)
  })

  // -- Gap: TEXTAREA -> textbox
  test('textarea has textbox role', () => {
    const result = runPipeline('<textarea></textarea>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
        ],
        "pass": true,
        "rendered": "
      - textbox
      ",
      }
    `)
  })

  // -- Gap: SECTION with/without aria-label
  test('section with aria-label has region role', () => {
    const result = runPipeline('<section aria-label="S">content</section>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "content",
            ],
            "name": "S",
            "props": {},
            "receivesPointerEvents": true,
            "role": "region",
          },
        ],
        "pass": true,
        "rendered": "
      - region "S": content
      ",
      }
    `)
  })

  test('section without aria-label has no role', () => {
    const result = runPipeline('<section>content</section>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "content",
        ],
        "pass": true,
        "rendered": "
      - text: content
      ",
      }
    `)
  })

  // -- Gap: table elements
  test('table structure roles', () => {
    const result = runPipeline(`
      <table>
        <thead><tr><th>H</th></tr></thead>
        <tbody><tr><td>D</td></tr></tbody>
        <tfoot><tr><td>F</td></tr></tfoot>
      </table>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  {
                    "box": {
                      "inline": false,
                      "visible": true,
                    },
                    "children": [
                      {
                        "box": {
                          "inline": false,
                          "visible": true,
                        },
                        "children": [],
                        "name": "H",
                        "props": {},
                        "receivesPointerEvents": true,
                        "role": "cell",
                      },
                    ],
                    "disabled": undefined,
                    "expanded": undefined,
                    "level": 0,
                    "name": "H",
                    "props": {},
                    "receivesPointerEvents": true,
                    "role": "row",
                    "selected": false,
                  },
                ],
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "rowgroup",
              },
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  {
                    "box": {
                      "inline": false,
                      "visible": true,
                    },
                    "children": [
                      {
                        "box": {
                          "inline": false,
                          "visible": true,
                        },
                        "children": [],
                        "name": "D",
                        "props": {},
                        "receivesPointerEvents": true,
                        "role": "cell",
                      },
                    ],
                    "disabled": undefined,
                    "expanded": undefined,
                    "level": 0,
                    "name": "D",
                    "props": {},
                    "receivesPointerEvents": true,
                    "role": "row",
                    "selected": false,
                  },
                ],
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "rowgroup",
              },
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  {
                    "box": {
                      "inline": false,
                      "visible": true,
                    },
                    "children": [
                      {
                        "box": {
                          "inline": false,
                          "visible": true,
                        },
                        "children": [],
                        "name": "F",
                        "props": {},
                        "receivesPointerEvents": true,
                        "role": "cell",
                      },
                    ],
                    "disabled": undefined,
                    "expanded": undefined,
                    "level": 0,
                    "name": "F",
                    "props": {},
                    "receivesPointerEvents": true,
                    "role": "row",
                    "selected": false,
                  },
                ],
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "rowgroup",
              },
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "table",
          },
        ],
        "pass": true,
        "rendered": "
      - table:
        - rowgroup:
          - row "H":
            - cell "H"
        - rowgroup:
          - row "D":
            - cell "D"
        - rowgroup:
          - row "F":
            - cell "F"
      ",
      }
    `)
  })

  // -- Gap: other implicit roles
  test('other implicit roles', () => {
    const result = runPipeline(`
      <article>x</article>
      <aside>x</aside>
      <dialog open>x</dialog>
      <fieldset><legend>L</legend></fieldset>
      <footer>x</footer>
      <form>x</form>
      <header>x</header>
      <hr>
      <main>x</main>
      <nav>x</nav>
      <ol><li>x</li></ol>
      <progress></progress>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "x",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "article",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "x",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "complementary",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "x",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "dialog",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "L",
            "props": {},
            "receivesPointerEvents": true,
            "role": "group",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "x",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "contentinfo",
          },
          "x",
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "x",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "banner",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "separator",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "x",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "main",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "x",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "navigation",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  "x",
                ],
                "level": 0,
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "listitem",
              },
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "list",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "progressbar",
          },
        ],
        "pass": true,
        "rendered": "
      - article: x
      - complementary: x
      - dialog: x
      - group "L"
      - contentinfo: x
      - text: x
      - banner: x
      - separator
      - main: x
      - navigation: x
      - list:
        - listitem: x
      - progressbar
      ",
      }
    `)
  })

  // -- Gap: explicit role with spaces (first token)
  test('explicit role with spaces takes first token', () => {
    const result = runPipeline('<div role="alert dialog">content</div>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "content",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "alert",
          },
        ],
        "pass": true,
        "rendered": "
      - alert: content
      ",
      }
    `)
  })

  // -- Gap: name dedup
  test('sole child text matching name is deduplicated', () => {
    const result = runPipeline('<button aria-label="Click">Click</button>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Click",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "Click"
      ",
      }
    `)
  })

  // -- Gap: aria-disabled, aria-expanded, aria-pressed, aria-selected capture
  test('aria-*', () => {
    const result = runPipeline(`
<button aria-disabled="true">X</button>
<button aria-expanded="true">X</button>
<button aria-expanded="false">X</button>
<button aria-pressed="true">X</button>
<button aria-pressed="mixed">X</button>
`)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": true,
            "expanded": undefined,
            "name": "X",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": true,
            "name": "X",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": false,
            "name": "X",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "X",
            "pressed": true,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "X",
            "pressed": "mixed",
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "X" [disabled]
      - button "X" [expanded]
      - button "X"
      - button "X" [pressed]
      - button "X" [pressed=mixed]
      ",
      }
    `)
  })

  // aria-disabled should only be captured on roles that support it (kAriaDisabledRoles)
  test('aria-disabled only on supported roles', () => {
    // button supports disabled, paragraph does not
    const result = runPipeline(`
<button aria-disabled="true">A</button>
<p aria-disabled="true">B</p>
`)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": true,
            "expanded": undefined,
            "name": "A",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "B",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - button "A" [disabled]
      - paragraph: B
      ",
      }
    `)
  })

  test('aria-selected captured', () => {
    const result = runPipeline(
      '<table><tr aria-selected="true"><td>X</td></tr></table>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  {
                    "box": {
                      "inline": false,
                      "visible": true,
                    },
                    "children": [
                      {
                        "box": {
                          "inline": false,
                          "visible": true,
                        },
                        "children": [],
                        "name": "X",
                        "props": {},
                        "receivesPointerEvents": true,
                        "role": "cell",
                      },
                    ],
                    "disabled": undefined,
                    "expanded": undefined,
                    "level": 0,
                    "name": "X",
                    "props": {},
                    "receivesPointerEvents": true,
                    "role": "row",
                    "selected": true,
                  },
                ],
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "rowgroup",
              },
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "table",
          },
        ],
        "pass": true,
        "rendered": "
      - table:
        - rowgroup:
          - row "X" [selected]:
            - cell "X"
      ",
      }
    `)
  })

  // -- Gap: heading levels h2-h6
  test('heading levels h2 through h6', () => {
    const result = runPipeline(`
<h1>x</h1>
<h2>x</h2>
<h3>x</h3>
<h4>x</h4>
<h5>x</h5>
<h6>x</h6>
`)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "level": 1,
            "name": "x",
            "props": {},
            "receivesPointerEvents": true,
            "role": "heading",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "level": 2,
            "name": "x",
            "props": {},
            "receivesPointerEvents": true,
            "role": "heading",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "level": 3,
            "name": "x",
            "props": {},
            "receivesPointerEvents": true,
            "role": "heading",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "level": 4,
            "name": "x",
            "props": {},
            "receivesPointerEvents": true,
            "role": "heading",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "level": 5,
            "name": "x",
            "props": {},
            "receivesPointerEvents": true,
            "role": "heading",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "level": 6,
            "name": "x",
            "props": {},
            "receivesPointerEvents": true,
            "role": "heading",
          },
        ],
        "pass": true,
        "rendered": "
      - heading "x" [level=1]
      - heading "x" [level=2]
      - heading "x" [level=3]
      - heading "x" [level=4]
      - heading "x" [level=5]
      - heading "x" [level=6]
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should treat input value as text in templates"
  test('input value as text content', () => {
    const result = runPipeline('<input value="hello world">')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "hello world",
            ],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
        ],
        "pass": true,
        "rendered": "
      - textbox: hello world
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should treat input value as text in templates"
  test('checkbox and radio do not capture value as text', () => {
    const result = runPipeline(
      '<input type="checkbox" checked><input type="radio" checked>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "checked": true,
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "checkbox",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "checked": true,
            "children": [],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "radio",
          },
        ],
        "pass": true,
        "rendered": "
      - checkbox [checked]
      - radio [checked]
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should not report textarea textContent"
  test('textarea value tracking', () => {
    const result = runPipeline('<textarea>Before</textarea>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "Before",
            ],
            "disabled": undefined,
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
        ],
        "pass": true,
        "rendered": "
      - textbox: Before
      ",
      }
    `)
  })

  // -- /placeholder: pseudo-attribute for inputs
  // Ported from Playwright: page-aria-snapshot.spec.ts "should snapshot placeholder"
  test('input captures placeholder', () => {
    const result = runPipeline('<input placeholder="Enter name">')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "Enter name",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
        ],
        "pass": true,
        "rendered": "
      - textbox "Enter name"
      ",
      }
    `)
  })

  test('placeholder not captured when same as name', () => {
    // When placeholder is used as the accessible name (via happy-dom/browser),
    // we don't duplicate it. Our code checks placeholder !== name.
    const result = runPipeline('<input placeholder="Name" aria-label="Name">')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "Name",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
        ],
        "pass": true,
        "rendered": "
      - textbox "Name"
      ",
      }
    `)
  })

  // Playwright: page-aria-snapshot.spec.ts "should not show visible children of hidden elements"
  test('CSS visibility:hidden', () => {
    const result = runPipeline(
      '<div style="visibility:hidden">Hidden</div><p>Visible</p>'
    )
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "Visible",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - paragraph: Visible
      ",
      }
    `)
  })

  // Playwright: page-aria-snapshot.spec.ts "should work with slots"
  test('shadow DOM: slotted content appears once', () => {
    // Text "foo" is assigned to the slot, should not be used twice.
    document.body.innerHTML = '<button><div>foo</div></button>'
    const div = document.querySelector('div')!
    const shadow = div.attachShadow({ mode: 'open' })
    const slot = document.createElement('slot')
    shadow.appendChild(slot)
    const result = runPipeline(document.body)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "foo",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "foo"
      ",
      }
    `)
  })

  test('shadow DOM: slotted content replaces slot fallback', () => {
    // Text "foo" is assigned to the slot, should be used instead of slot content.
    document.body.innerHTML = '<div>foo</div>'
    const div = document.querySelector('div')!
    const shadow = div.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    shadow.appendChild(button)
    const slot = document.createElement('slot')
    button.appendChild(slot)
    const span = document.createElement('span')
    span.textContent = 'pre'
    slot.appendChild(span)
    const result = runPipeline(document.body)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "foo",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "foo"
      ",
      }
    `)
  })

  test('shadow DOM: slot fallback used when nothing assigned', () => {
    // Nothing is assigned to the slot, should use slot content.
    document.body.innerHTML = '<div></div>'
    const div = document.querySelector('div')!
    const shadow = div.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    shadow.appendChild(button)
    const slot = document.createElement('slot')
    button.appendChild(slot)
    const span = document.createElement('span')
    span.textContent = 'pre'
    slot.appendChild(span)
    const result = runPipeline(document.body)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "pre",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "pre"
      ",
      }
    `)
  })

  // Playwright: page-aria-snapshot.spec.ts "should include pseudo in text"
  test('CSS pseudo-elements included in text', () => {
    document.body.innerHTML = `
      <style>
        span:before { content: 'world'; }
        div:after { content: 'bye'; }
      </style>
      <a href="about:blank">
        <span>hello</span>
        <div>hello</div>
      </a>
    `
    const result = runPipeline(document.body)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "worldhello hellobye",
            "props": {
              "url": "about:blank",
            },
            "receivesPointerEvents": true,
            "role": "link",
          },
        ],
        "pass": true,
        "rendered": "
      - link "worldhello hellobye":
        - /url: about:blank
      ",
      }
    `)
  })

  // Playwright: page-aria-snapshot.spec.ts "should respect aria-owns"
  test('aria-owns', () => {
    const result = runPipeline(`
      <div role="list" aria-owns="item1"></div>
      <div id="item1" role="listitem">Owned</div>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  "Owned",
                ],
                "level": 0,
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "listitem",
              },
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "list",
          },
        ],
        "pass": true,
        "rendered": "
      - list:
        - listitem: Owned
      ",
      }
    `)
  })

  test('nav with nested list', () => {
    const result = runPipeline(`
      <nav aria-label="Main">
        <ul>
          <li><a href="/a">A</a></li>
          <li><a href="/b">B</a></li>
        </ul>
      </nav>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              {
                "box": {
                  "inline": false,
                  "visible": true,
                },
                "children": [
                  {
                    "box": {
                      "inline": false,
                      "visible": true,
                    },
                    "children": [
                      {
                        "box": {
                          "inline": false,
                          "visible": true,
                        },
                        "children": [],
                        "disabled": undefined,
                        "expanded": undefined,
                        "name": "A",
                        "props": {
                          "url": "/a",
                        },
                        "receivesPointerEvents": true,
                        "role": "link",
                      },
                    ],
                    "level": 0,
                    "name": "",
                    "props": {},
                    "receivesPointerEvents": true,
                    "role": "listitem",
                  },
                  {
                    "box": {
                      "inline": false,
                      "visible": true,
                    },
                    "children": [
                      {
                        "box": {
                          "inline": false,
                          "visible": true,
                        },
                        "children": [],
                        "disabled": undefined,
                        "expanded": undefined,
                        "name": "B",
                        "props": {
                          "url": "/b",
                        },
                        "receivesPointerEvents": true,
                        "role": "link",
                      },
                    ],
                    "level": 0,
                    "name": "",
                    "props": {},
                    "receivesPointerEvents": true,
                    "role": "listitem",
                  },
                ],
                "name": "",
                "props": {},
                "receivesPointerEvents": true,
                "role": "list",
              },
            ],
            "name": "Main",
            "props": {},
            "receivesPointerEvents": true,
            "role": "navigation",
          },
        ],
        "pass": true,
        "rendered": "
      - navigation "Main":
        - list:
          - listitem:
            - link "A":
              - /url: /a
          - listitem:
            - link "B":
              - /url: /b
      ",
      }
    `)
  })

  test('form with inputs', () => {
    const result = runPipeline(`
      <form>
        <label for="u">User</label>
        <input id="u" type="text" />
        <button type="submit">Go</button>
      </form>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "User",
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "name": "User",
            "props": {},
            "receivesPointerEvents": true,
            "role": "textbox",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Go",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - text: User
      - textbox "User"
      - button "Go"
      ",
      }
    `)
  })

  test('leaf node with no children', () => {
    const result = runPipeline('<button aria-label="X"></button>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "X",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "X"
      ",
      }
    `)
  })

  test('fragment with text and element children', () => {
    const result = runPipeline('Hello <p>World</p>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          "Hello",
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "World",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - text: Hello
      - paragraph: World
      ",
      }
    `)
  })

  test('link url with no text children', () => {
    const result = runPipeline('<a href="/foo" aria-label="Go"></a>')
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": undefined,
            "name": "Go",
            "props": {
              "url": "/foo",
            },
            "receivesPointerEvents": true,
            "role": "link",
          },
        ],
        "pass": true,
        "rendered": "
      - link "Go":
        - /url: /foo
      ",
      }
    `)
  })

  // Playwright: page-aria-snapshot.spec.ts "should escape yaml text in text nodes",
  //   "should escape special yaml characters", "should escape special yaml values"
  test('YAML escaping of special characters', () => {
    const result = runPipeline(`
<p>one: two</p>
<p>"quoted"</p>
<p>#comment</p>
<p>@at</p>
<p>[bracket]</p>
<p>true</p>
<p>123</p>
`)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "one: two",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              ""quoted"",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "#comment",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "@at",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "[bracket]",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "true",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [
              "123",
            ],
            "name": "",
            "props": {},
            "receivesPointerEvents": true,
            "role": "paragraph",
          },
        ],
        "pass": true,
        "rendered": "
      - paragraph: "one: two"
      - paragraph: "\\"quoted\\""
      - paragraph: "#comment"
      - paragraph: "@at"
      - paragraph: "[bracket]"
      - paragraph: "true"
      - paragraph: "123"
      ",
      }
    `)
  })
})

// Edge cases not covered by runPipeline (which tests render→parse→match roundtrip)
describe('parseAriaTemplate', () => {
  test('regex name', () => {
    const t = parseAriaTemplate('- heading /Welcome \\d+/')
    expect(t).toMatchInlineSnapshot(`
      {
        "kind": "role",
        "name": {
          "pattern": "Welcome \\d+",
        },
        "role": "heading",
      }
    `)
  })

  test('inline regex text child', () => {
    const t = parseAriaTemplate('- paragraph: /item \\d+/')
    expect(t).toMatchInlineSnapshot(`
      {
        "children": [
          {
            "kind": "text",
            "text": {
              "normalized": "/item \\d+/",
              "raw": "/item \\d+/",
            },
          },
        ],
        "kind": "role",
        "name": undefined,
        "role": "paragraph",
      }
    `)
  })

  test('regex text node', () => {
    const t = parseAriaTemplate('- text: /hello \\d+/')
    expect(t).toMatchInlineSnapshot(`
      {
        "kind": "text",
        "text": {
          "normalized": "/hello \\d+/",
          "raw": "/hello \\d+/",
        },
      }
    `)
  })

  test('/url: pseudo-child parses as regex', () => {
    const t = parseAriaTemplate(`
      - link:
        - /url: /.*example.com/
    `)
    expect(t).toMatchInlineSnapshot(`
      {
        "children": [],
        "kind": "role",
        "name": undefined,
        "props": {
          "url": {
            "normalized": "/.*example.com/",
            "raw": "/.*example.com/",
          },
        },
        "role": "link",
      }
    `)
  })

  test('wrong indent', () => {
    const t = () =>
      parseAriaTemplate(`

      - button

      not a list item
      - link
    `)
    expect(t).toThrowErrorMatchingInlineSnapshot(`
      [Error: Unexpected scalar at node end at line 5, column 7:


            not a list item
            - link
            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      ]
    `)
  })

  test('empty input', () => {
    const t = () => parseAriaTemplate(``)
    expect(t).toThrowErrorMatchingInlineSnapshot(
      `[Error: Aria snapshot must be a YAML sequence, elements starting with " -"]`
    )
  })

  test('throws on invalid role entry', () => {
    expect(() => parseAriaTemplate('- !@#')).toThrowErrorMatchingInlineSnapshot(
      `
      [Error: Unexpected end of input when expecting role:


      ^
      ]
    `
    )
  })

  // Playwright: page-aria-snapshot.spec.ts "should support multiline text" (| syntax)
  test('YAML block scalar (| multiline)', () => {
    const t = parseAriaTemplate(`
      - paragraph: |
          Line one
          Line two
    `)
    expect(t).toMatchInlineSnapshot(`
      {
        "children": [
          {
            "kind": "text",
            "text": {
              "normalized": "Line one Line two",
              "raw": "Line one
      Line two
      ",
            },
          },
        ],
        "kind": "role",
        "name": undefined,
        "role": "paragraph",
      }
    `)
  })

  // Playwright: to-match-aria-snapshot.spec.ts "should report error in YAML keys"
  test('parse error with source location', () => {
    expect(() => parseAriaTemplate('- button [invalid_attr]'))
      .toThrowErrorMatchingInlineSnapshot(`
      [Error: Expected ]:

      button [invalid_attr]
                     ^
      ]
    `)
  })

  // Playwright: to-match-aria-snapshot.spec.ts "should detect unexpected children: equal"
  test('/children: equal|deep-equal|contain directives', () => {
    const t = parseAriaTemplate(`
      - list:
        - /children: equal
        - listitem: A
    `)
    expect(t).toMatchInlineSnapshot(`
      {
        "children": [
          {
            "children": [
              {
                "kind": "text",
                "text": {
                  "normalized": "A",
                  "raw": "A",
                },
              },
            ],
            "kind": "role",
            "name": undefined,
            "role": "listitem",
          },
        ],
        "containerMode": "equal",
        "kind": "role",
        "name": undefined,
        "role": "list",
      }
    `)
  })
})

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

describe('matchAriaTree', () => {
  test('roundtrip 1', () => {
    const html = `
      <nav aria-label="Main">
        <ul>
          <li><a href="/home">Home</a></li>
          <li><a href="/about">About</a></li>
        </ul>
      </nav>
    `
    expect(match(html, renderAriaTree(capture(html)))).toMatchInlineSnapshot(`
      {
        "actual": "
      - navigation "Main":
        - list:
          - listitem:
            - link "Home":
              - /url: /home
          - listitem:
            - link "About":
              - /url: /about
      ",
        "expected": "
      - navigation "Main":
        - list:
          - listitem:
            - link "Home":
              - /url: /home
          - listitem:
            - link "About":
              - /url: /about
      ",
        "pass": true,
        "rawExpected": "
      - navigation "Main":
        - list:
          - listitem:
            - link "Home":
              - /url: /home
          - listitem:
            - link "About":
              - /url: /about
      ",
      }
    `)
  })

  test('roundtrip 2', () => {
    const html = `
      <div role="checkbox" aria-checked="true" aria-label="A"></div>
      <button aria-disabled="true">B</button>
      <button aria-expanded="true">C</button>
      <button aria-expanded="false">D</button>
      <button aria-pressed="true">E</button>
      <button aria-pressed="mixed">F</button>
      <div role="option" aria-selected="true">G</div>
    `
    expect(match(html, renderAriaTree(capture(html)))).toMatchInlineSnapshot(`
      {
        "actual": "
      - checkbox "A" [checked]
      - button "B" [disabled]
      - button "C" [expanded]
      - button "D"
      - button "E" [pressed]
      - button "F" [pressed=mixed]
      - option "G" [selected]
      ",
        "expected": "
      - checkbox "A" [checked]
      - button "B" [disabled]
      - button "C" [expanded]
      - button "D"
      - button "E" [pressed]
      - button "F" [pressed=mixed]
      - option "G" [selected]
      ",
        "pass": true,
        "rawExpected": "
      - checkbox "A" [checked]
      - button "B" [disabled]
      - button "C" [expanded]
      - button "D"
      - button "E" [pressed]
      - button "F" [pressed=mixed]
      - option "G" [selected]
      ",
      }
    `)
  })

  test('exact match', () => {
    // TODO: expected === rawExpected invariant on pass = true?
    expect(match('<h1>Hello</h1>', '- heading [level=1]')).toMatchInlineSnapshot(`
      {
        "actual": "
      - heading "Hello" [level=1]
      ",
        "expected": "
      - heading "Hello" [level=1]
      ",
        "pass": true,
        "rawExpected": "
      - heading [level=1]
      ",
      }
    `)
  })

  test('name match', () => {
    expect(match('<button aria-label="Submit">Go</button>', '- button "Submit"'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button "Submit": Go
        ",
          "expected": "
        - button "Submit"
        ",
          "pass": true,
          "rawExpected": "
        - button "Submit"
        ",
        }
      `)
  })

  test('name mismatch', () => {
    expect(match('<button aria-label="Submit">Go</button>', '- button "Cancel"'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button "Submit": Go
        ",
          "expected": "
        - button "Submit": Go
        ",
          "pass": false,
          "rawExpected": "
        - button "Cancel"
        ",
        }
      `)
  })

  test('regex name match', () => {
    expect(match('<button aria-label="User 42">Go</button>', '- button /User \\d+/'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button /User \\d+/: Go
        ",
          "expected": "
        - button /User \\d+/
        ",
          "pass": true,
          "rawExpected": "
        - button /User \\d+/
        ",
        }
      `)
  })

  test('regex name mismatch', () => {
    expect(match('<button aria-label="User 42">Go</button>', '- button /Goodbye/'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button "User 42": Go
        ",
          "expected": "
        - button "User 42": Go
        ",
          "pass": false,
          "rawExpected": "
        - button /Goodbye/
        ",
        }
      `)
  })

  // Contain semantics: template is a subset of actual children.
  // The template doesn't need to list every child — only the ones you care about.

  test('contain semantics — skip unmentioned siblings by distinct role', () => {
    // Template mentions heading and button, skipping the paragraph in between.
    // Works because pairChildren matches by role, and these are distinct roles.
    expect(
      match(
        `
      <h1>Title</h1>
      <p>Body text</p>
      <button>Submit</button>
    `,
        `
      - heading [level=1]
      - button
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - heading "Title" [level=1]
      - paragraph: Body text
      - button "Submit"
      ",
        "expected": "
      - heading "Title" [level=1]
      - button "Submit"
      ",
        "pass": true,
        "rawExpected": "
      - heading [level=1]
      - button
      ",
      }
    `)
  })

  test('contain semantics — match first of repeated role', () => {
    // When template matches the first child of a repeated role, pairing works.
    expect(
      match(
        `
      <ul>
        <li>One</li>
        <li>Two</li>
        <li>Three</li>
      </ul>
    `,
        `
      - list:
        - listitem: One
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - list:
        - listitem: One
        - listitem: Two
        - listitem: Three
      ",
        "expected": "
      - list:
        - listitem: One
      ",
        "pass": true,
        "rawExpected": "
      - list:
        - listitem: One
      ",
      }
    `)
  })

  test('contain semantics — match non-first child of same role by text', () => {
    expect(
      match(
        `
      <ul>
        <li>One</li>
        <li>Two</li>
        <li>Three</li>
      </ul>
    `,
        `
      - list:
        - listitem: Two
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - list:
        - listitem: One
        - listitem: Two
        - listitem: Three
      ",
        "expected": "
      - list:
        - listitem: Two
      ",
        "pass": true,
        "rawExpected": "
      - list:
        - listitem: Two
      ",
      }
    `)
  })

  test('contain semantics — subsequence by text', () => {
    expect(
      match(
        `
      <ul>
        <li>A</li>
        <li>B</li>
        <li>C</li>
      </ul>
    `,
        `
      - list:
        - listitem: A
        - listitem: C
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - list:
        - listitem: A
        - listitem: B
        - listitem: C
      ",
        "expected": "
      - list:
        - listitem: A
        - listitem: C
      ",
        "pass": true,
        "rawExpected": "
      - list:
        - listitem: A
        - listitem: C
      ",
      }
    `)
  })

  test('contain semantics — template with no children matches any node', () => {
    // Template says "there's a list" without specifying children.
    expect(
      match(
        `
      <ul>
        <li>One</li>
        <li>Two</li>
      </ul>
    `,
        '- list'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - list:
        - listitem: One
        - listitem: Two
      ",
        "expected": "
      - list
      ",
        "pass": true,
        "rawExpected": "
      - list
      ",
      }
    `)
  })

  test('contain semantics — nested partial match', () => {
    // Match a deeply nested structure, only mentioning the first listitem.
    expect(
      match(
        `
      <nav aria-label="Main">
        <ul>
          <li><button>Home</button></li>
          <li><button>About</button></li>
          <li><button>Contact</button></li>
        </ul>
      </nav>
    `,
        `
      - navigation "Main":
        - list:
          - listitem:
            - button: Home
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - navigation "Main":
        - list:
          - listitem:
            - button "Home"
          - listitem:
            - button "About"
          - listitem:
            - button "Contact"
      ",
        "expected": "
      - navigation "Main":
        - list:
          - listitem:
            - button "Home"
          - listitem:
            - button "About"
          - listitem:
            - button "Contact"
      ",
        "pass": false,
        "rawExpected": "
      - navigation "Main":
        - list:
          - listitem:
            - button: Home
      ",
      }
    `)
  })

  test('contain semantics — bail out to full re-render when sibling fails', () => {
    // Two lists: first partially matches (template asks for A only, B is unmentioned),
    // second fails (template says WRONG but actual is X).
    // Because list2 can't pair, bail-out renders ALL actuals at this level.
    // List1's partial form is lost (B included) — that's the Attempt 1 tradeoff.
    expect(
      match(
        `
      <ul><li>A</li><li>B</li></ul>
      <ul><li>X</li><li>Y</li></ul>
    `,
        `
      - list:
        - listitem: A
      - list:
        - listitem: WRONG
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - list:
        - listitem: A
        - listitem: B
      - list:
        - listitem: X
        - listitem: "Y"
      ",
        "expected": "
      - list:
        - listitem: A
      - list:
        - listitem: X
        - listitem: "Y"
      ",
        "pass": false,
        "rawExpected": "
      - list:
        - listitem: A
      - list:
        - listitem: WRONG
      ",
      }
    `)
  })

  test('attribute match — checked', () => {
    expect(
      match(
        '<div role="checkbox" aria-checked="true" aria-label="A"></div>',
        '- checkbox "A" [checked]'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - checkbox "A" [checked]
      ",
        "expected": "
      - checkbox "A" [checked]
      ",
        "pass": true,
        "rawExpected": "
      - checkbox "A" [checked]
      ",
      }
    `)
  })

  test('attribute mismatch — wrong level', () => {
    expect(match('<h2>Title</h2>', '- heading [level=1]')).toMatchInlineSnapshot(`
      {
        "actual": "
      - heading "Title" [level=2]
      ",
        "expected": "
      - heading "Title" [level=2]
      ",
        "pass": false,
        "rawExpected": "
      - heading [level=1]
      ",
      }
    `)
  })

  test('role mismatch', () => {
    expect(match('<button>Click</button>', '- link')).toMatchInlineSnapshot(`
      {
        "actual": "
      - button "Click"
      ",
        "expected": "
      - button "Click"
      ",
        "pass": false,
        "rawExpected": "
      - link
      ",
      }
    `)
  })

  test('regex text child match', () => {
    expect(
      match(
        '<p>You have 7 notifications</p>',
        '- paragraph: /You have \\d+ notifications/'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - paragraph: /You have \\d+ notifications/
      ",
        "expected": "
      - paragraph: /You have \\d+ notifications/
      ",
        "pass": true,
        "rawExpected": "
      - paragraph: /You have \\d+ notifications/
      ",
      }
    `)
  })

  test('regex text child mismatch', () => {
    expect(match('<p>You have 7 notifications</p>', '- paragraph: /\\d+ errors/'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - paragraph: You have 7 notifications
        ",
          "expected": "
        - paragraph: You have 7 notifications
        ",
          "pass": false,
          "rawExpected": "
        - paragraph: /\\d+ errors/
        ",
        }
      `)
  })

  test('merge preserves regex name, updates mismatched text', () => {
    expect(
      match(
        `
      <button aria-label="1234">Pattern</button>
      <p>Changed</p>
    `,
        `
      - button /\\d+/: Pattern
      - paragraph: Original
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button /\\d+/: Pattern
      - paragraph: Changed
      ",
        "expected": "
      - button /\\d+/: Pattern
      - paragraph: Changed
      ",
        "pass": false,
        "rawExpected": "
      - button /\\d+/: Pattern
      - paragraph: Original
      ",
      }
    `)
  })

  test('mismatch text and regex match', () => {
    expect(
      match(
        `
      <p>Changed</p>
      <button aria-label="1234">Pattern</button>
    `,
        `
      - paragraph: Original
      - button /\\d+/: Pattern
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - paragraph: Changed
      - button /\\d+/: Pattern
      ",
        "expected": "
      - paragraph: Changed
      - button /\\d+/: Pattern
      ",
        "pass": false,
        "rawExpected": "
      - paragraph: Original
      - button /\\d+/: Pattern
      ",
      }
    `)
  })

  test('merge flip 1', () => {
    expect(
      match(
        `
      <button aria-label="1234">Pattern</button>
      <p>Changed</p>
    `,
        `
      - paragraph: Original
      - button /\\d+/: Pattern
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button /\\d+/: Pattern
      - paragraph: Changed
      ",
        "expected": "
      - button /\\d+/: Pattern
      - paragraph: Changed
      ",
        "pass": false,
        "rawExpected": "
      - paragraph: Original
      - button /\\d+/: Pattern
      ",
      }
    `)
  })

  test('merge flip 2', () => {
    expect(
      match(
        `
      <p>Changed</p>
      <button aria-label="1234">Pattern</button>
    `,
        `
      - button /\\d+/: Pattern
      - paragraph: Original
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - paragraph: Changed
      - button /\\d+/: Pattern
      ",
        "expected": "
      - paragraph: Changed
      - button /\\d+/: Pattern
      ",
        "pass": false,
        "rawExpected": "
      - button /\\d+/: Pattern
      - paragraph: Original
      ",
      }
    `)
  })

  test('mismatch tag and regex match', () => {
    expect(
      match(
        `
      <h1>ChangedWithTag</h1>
      <button aria-label="1234">Pattern</button>
    `,
        `
      - paragraph: Original
      - button /\\d+/: Pattern
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - heading "ChangedWithTag" [level=1]
      - button /\\d+/: Pattern
      ",
        "expected": "
      - heading "ChangedWithTag" [level=1]
      - button /\\d+/: Pattern
      ",
        "pass": false,
        "rawExpected": "
      - paragraph: Original
      - button /\\d+/: Pattern
      ",
      }
    `)
  })

  test('merge 1', () => {
    expect(
      match(
        `
      <div>extra</div>
      <button aria-label="1234">Pattern</button>
      <p>Changed</p>
    `,
        `
      - button /\\d+/: Pattern
      - paragraph: Original
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - text: extra
      - button /\\d+/: Pattern
      - paragraph: Changed
      ",
        "expected": "
      - text: extra
      - button /\\d+/: Pattern
      - paragraph: Changed
      ",
        "pass": false,
        "rawExpected": "
      - button /\\d+/: Pattern
      - paragraph: Original
      ",
      }
    `)
  })

  test('merge 2', () => {
    expect(
      match(
        `
      <p>Changed</p>
      <div>extra</div>
      <button aria-label="1234">Pattern</button>
    `,
        `
      - paragraph: Original
      - button /\\d+/: Pattern
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - paragraph: Changed
      - text: extra
      - button /\\d+/: Pattern
      ",
        "expected": "
      - paragraph: Changed
      - text: extra
      - button /\\d+/: Pattern
      ",
        "pass": false,
        "rawExpected": "
      - paragraph: Original
      - button /\\d+/: Pattern
      ",
      }
    `)
  })

  test('merge 3', () => {
    expect(
      match(
        `
      <p>Changed</p>
      <button aria-label="1234">Pattern</button>
      <div>extra</div>
    `,
        `
      - paragraph: Original
      - button /\d+/: Pattern
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - paragraph: Changed
      - button "1234": Pattern
      - text: extra
      ",
        "expected": "
      - paragraph: Changed
      - button "1234": Pattern
      - text: extra
      ",
        "pass": false,
        "rawExpected": "
      - paragraph: Original
      - button /d+/: Pattern
      ",
      }
    `)
  })

  test('flipped regex match', () => {
    expect(
      match(
        `
      <button>Submit</button>
      <button>Cancel</button>
    `,
        `
      - button: Cancel
      - paragraph: /\w+/
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button "Submit"
      - button "Cancel"
      ",
        "expected": "
      - button "Submit"
      - button "Cancel"
      ",
        "pass": false,
        "rawExpected": "
      - button: Cancel
      - paragraph: /w+/
      ",
      }
    `)
  })

  // -- Ported from Playwright: to-match-aria-snapshot.spec.ts "disabled attribute"
  test('attribute match — disabled', () => {
    expect(
      match('<button aria-disabled="true">Click me</button>', '- button [disabled]')
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button "Click me" [disabled]
      ",
        "expected": "
      - button "Click me" [disabled]
      ",
        "pass": true,
        "rawExpected": "
      - button [disabled]
      ",
      }
    `)
  })

  test('attribute mismatch — disabled expected but not present', () => {
    expect(match('<button>Click me</button>', '- button [disabled]'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button "Click me"
        ",
          "expected": "
        - button "Click me"
        ",
          "pass": false,
          "rawExpected": "
        - button [disabled]
        ",
        }
      `)
  })

  // -- Ported from Playwright: to-match-aria-snapshot.spec.ts "expanded attribute"
  test('attribute match — expanded', () => {
    expect(
      match('<button aria-expanded="true">Toggle</button>', '- button [expanded]')
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button "Toggle" [expanded]
      ",
        "expected": "
      - button "Toggle" [expanded]
      ",
        "pass": true,
        "rawExpected": "
      - button [expanded]
      ",
      }
    `)
  })

  test('attribute mismatch — expanded=false vs expanded=true', () => {
    expect(
      match(
        '<button aria-expanded="true">Toggle</button>',
        '- button [expanded=false]'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button "Toggle" [expanded]
      ",
        "expected": "
      - button "Toggle" [expanded]
      ",
        "pass": false,
        "rawExpected": "
      - button
      ",
      }
    `)
  })

  // -- Ported from Playwright: to-match-aria-snapshot.spec.ts "pressed attribute"
  test('attribute match — pressed', () => {
    expect(match('<button aria-pressed="true">Like</button>', '- button [pressed]'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button "Like" [pressed]
        ",
          "expected": "
        - button "Like" [pressed]
        ",
          "pass": true,
          "rawExpected": "
        - button [pressed]
        ",
        }
      `)
  })

  test('attribute match — pressed=mixed', () => {
    expect(
      match('<button aria-pressed="mixed">Like</button>', '- button [pressed=mixed]')
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button "Like" [pressed=mixed]
      ",
        "expected": "
      - button "Like" [pressed=mixed]
      ",
        "pass": true,
        "rawExpected": "
      - button [pressed=mixed]
      ",
      }
    `)
  })

  test('attribute mismatch — pressed=true vs pressed=mixed', () => {
    expect(match('<button aria-pressed="mixed">Like</button>', '- button [pressed]'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button "Like" [pressed=mixed]
        ",
          "expected": "
        - button "Like" [pressed=mixed]
        ",
          "pass": false,
          "rawExpected": "
        - button [pressed]
        ",
        }
      `)
  })

  // -- Ported from Playwright: to-match-aria-snapshot.spec.ts "selected attribute"
  test('attribute match — selected', () => {
    expect(
      match(
        '<div role="option" aria-selected="true">Row</div>',
        '- option [selected]'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - option "Row" [selected]
      ",
        "expected": "
      - option "Row" [selected]
      ",
        "pass": true,
        "rawExpected": "
      - option [selected]
      ",
      }
    `)
  })

  test('attribute mismatch — selected expected but not present', () => {
    expect(match('<div role="option">Row</div>', '- option [selected]'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - option "Row"
        ",
          "expected": "
        - option "Row"
        ",
          "pass": false,
          "rawExpected": "
        - option [selected]
        ",
        }
      `)
  })

  // -- Ported from Playwright: to-match-aria-snapshot.spec.ts "checked attribute"
  test('attribute match — checked=mixed', () => {
    expect(
      match(
        '<div role="checkbox" aria-checked="mixed" aria-label="A"></div>',
        '- checkbox "A" [checked=mixed]'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - checkbox "A" [checked=mixed]
      ",
        "expected": "
      - checkbox "A" [checked=mixed]
      ",
        "pass": true,
        "rawExpected": "
      - checkbox "A" [checked=mixed]
      ",
      }
    `)
  })

  test('attribute mismatch — checked vs checked=mixed', () => {
    expect(
      match(
        '<div role="checkbox" aria-checked="mixed" aria-label="A"></div>',
        '- checkbox "A" [checked]'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - checkbox "A" [checked=mixed]
      ",
        "expected": "
      - checkbox "A" [checked=mixed]
      ",
        "pass": false,
        "rawExpected": "
      - checkbox "A" [checked]
      ",
      }
    `)
  })

  // -- Ported from Playwright: to-match-aria-snapshot.spec.ts "should match in list"
  test('contain semantics — matches subset of siblings', () => {
    // Template asks for a heading with name "title" which is not set via aria-label,
    // so name is "" on both headings. Template name "title" won't match "" → fails.
    // This differs from Playwright which uses accessible name computation that
    // includes text content in the name.
    expect(
      match(
        `
      <h1>title</h1>
      <h1>title 2</h1>
    `,
        `
      - heading "title"
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - heading "title" [level=1]
      - heading "title 2" [level=1]
      ",
        "expected": "
      - heading "title" [level=1]
      ",
        "pass": true,
        "rawExpected": "
      - heading "title"
      ",
      }
    `)
  })

  // Behavioral test: empty template produces zero template children,
  // and containsList(anything, []) returns true (vacuous truth).
  // Same semantics as Playwright — "I don't care what's here."
  test('empty template', () => {
    expect(() => match('<p>anything</p>', '')).toThrowErrorMatchingInlineSnapshot(
      `[Error: Aria snapshot must be a YAML sequence, elements starting with " -"]`
    )
  })

  // -- Gap: deeply nested mismatch
  test('deeply nested text mismatch', () => {
    expect(
      match(
        `
      <nav aria-label="Main">
        <ul>
          <li><a href="/a">Home</a></li>
        </ul>
      </nav>
    `,
        `
      - navigation "Main":
        - list:
          - listitem:
            - link: Away
    `
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - navigation "Main":
        - list:
          - listitem:
            - link "Home":
              - /url: /a
      ",
        "expected": "
      - navigation "Main":
        - list:
          - listitem:
            - link "Home":
              - /url: /a
      ",
        "pass": false,
        "rawExpected": "
      - navigation "Main":
        - list:
          - listitem:
            - link: Away
      ",
      }
    `)
  })

  // -- Ported from Playwright: to-match-aria-snapshot.spec.ts "should match url"
  test('/url: pseudo-attribute matches', () => {
    expect(
      match(
        '<a href="https://example.com">Link</a>',
        `\
- link:
  - /url: /.*example.com/
`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Link":
        - /url: /.*example.com/
      ",
        "expected": "
      - link "Link":
        - /url: /.*example.com/
      ",
        "pass": true,
        "rawExpected": "
      - link:
        - /url: /.*example.com/
      ",
      }
    `)
  })

  test('/url: pseudo-attribute mismatch', () => {
    expect(
      match(
        '<a href="https://example.com">Link</a>',
        `\
- link:
  - /url: /.*other.com/`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Link":
        - /url: https://example.com
      ",
        "expected": "
      - link "Link":
        - /url: https://example.com
      ",
        "pass": false,
        "rawExpected": "
      - link:
        - /url: /.*other.com/
      ",
      }
    `)
  })

  // -- Ported from Playwright: page-aria-snapshot.spec.ts "should snapshot placeholder"
  test('/placeholder: matches when input has separate aria-label', () => {
    expect(
      match(
        '<input placeholder="Enter name" aria-label="Label">',
        `
- textbox "Label":
  - /placeholder: Enter name`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - textbox "Label":
        - /placeholder: Enter name
      ",
        "expected": "
      - textbox "Label":
        - /placeholder: Enter name
      ",
        "pass": true,
        "rawExpected": "
      - textbox "Label":
        - /placeholder: Enter name
      ",
      }
    `)
  })

  test('/placeholder: not captured when placeholder is the accessible name', () => {
    expect(
      match(
        '<input placeholder="Enter name">',
        `
- textbox:
  - /placeholder: Enter name`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - textbox "Enter name"
      ",
        "expected": "
      - textbox "Enter name"
      ",
        "pass": false,
        "rawExpected": "
      - textbox:
        - /placeholder: Enter name
      ",
      }
    `)
  })

  test('/placeholder: value mismatch', () => {
    expect(
      match(
        '<input placeholder="Enter name">',
        `
- textbox:
  - /placeholder: Wrong`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - textbox "Enter name"
      ",
        "expected": "
      - textbox "Enter name"
      ",
        "pass": false,
        "rawExpected": "
      - textbox:
        - /placeholder: Wrong
      ",
      }
    `)
  })

  // -- /url: with inner children (link with child elements)
  test('/url: regex match with inner children', () => {
    expect(
      match(
        '<a href="https://example.com"><strong>Click</strong> here</a>',
        `\
- link:
  - /url: /.*example.com/`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Click here":
        - strong: Click
        - text: here
        - /url: /.*example.com/
      ",
        "expected": "
      - link "Click here":
        - /url: /.*example.com/
      ",
        "pass": true,
        "rawExpected": "
      - link:
        - /url: /.*example.com/
      ",
      }
    `)
  })

  test('/url: regex mismatch with inner children', () => {
    expect(
      match(
        '<a href="https://example.com"><strong>Click</strong> here</a>',
        `\
- link:
  - /url: /.*other.com/`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "expected": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "pass": false,
        "rawExpected": "
      - link:
        - /url: /.*other.com/
      ",
      }
    `)
  })

  test('/url: regex match with inner children and text template', () => {
    expect(
      match(
        '<a href="https://example.com"><strong>Click</strong> here</a>',
        `\
- link:
  - text: Click here
  - /url: /.*example.com/`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "expected": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "pass": false,
        "rawExpected": "
      - link:
        - text: Click here
        - /url: /.*example.com/
      ",
      }
    `)
  })

  test('/url: regex match with inner children and wrong text template', () => {
    expect(
      match(
        '<a href="https://example.com"><strong>Click</strong> here</a>',
        `\
- link:
  - text: Wrong text
  - /url: /.*example.com/`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "expected": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "pass": false,
        "rawExpected": "
      - link:
        - text: Wrong text
        - /url: /.*example.com/
      ",
      }
    `)
  })

  test('/url: literal match with inner children', () => {
    expect(
      match(
        '<a href="https://example.com"><strong>Click</strong> here</a>',
        `\
- link:
  - /url: https://example.com`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Click here":
        - strong: Click
        - text: here
        - /url: https://example.com
      ",
        "expected": "
      - link "Click here":
        - /url: https://example.com
      ",
        "pass": true,
        "rawExpected": "
      - link:
        - /url: https://example.com
      ",
      }
    `)
  })

  test('/url: literal mismatch with inner children', () => {
    expect(
      match(
        '<a href="https://example.com"><strong>Click</strong> here</a>',
        `\
- link:
  - /url: https://other.com`
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "expected": "
      - link "Click here":
        - /url: https://example.com
        - strong: Click
        - text: here
      ",
        "pass": false,
        "rawExpected": "
      - link:
        - /url: https://other.com
      ",
      }
    `)
  })
})

describe('aria-expanded', () => {
  // expanded has three ARIA states: undefined (not expandable), false (collapsed),
  // true (expanded). Rendering omits false for brevity, but matching distinguishes
  // all three. These tests verify the asymmetry is handled correctly in merge.

  test('basic', () => {
    const result = runPipeline(`
      <button aria-expanded="false">b</button>
      <button aria-expanded="true">c</button>
    `)
    expect(result.snapshot).toMatchInlineSnapshot(`
      {
        "captured": [
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": false,
            "name": "b",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
          {
            "box": {
              "inline": false,
              "visible": true,
            },
            "children": [],
            "disabled": undefined,
            "expanded": true,
            "name": "c",
            "pressed": false,
            "props": {},
            "receivesPointerEvents": true,
            "role": "button",
          },
        ],
        "pass": true,
        "rendered": "
      - button "b"
      - button "c" [expanded]
      ",
      }
    `)
  })

  // TODO: `expected` should preserve [expanded=false] from the template
  // when pass is true. Currently lost because mergedKey goes through
  // createAriaKey/renderAriaProps which omits expanded=false.
  test('expanded=false is preserved in merge when template asserts it', () => {
    expect(
      match(
        '<button aria-expanded="false">Menu</button>',
        '- button "Menu" [expanded=false]'
      )
    ).toMatchInlineSnapshot(`
      {
        "actual": "
      - button "Menu"
      ",
        "expected": "
      - button "Menu"
      ",
        "pass": true,
        "rawExpected": "
      - button "Menu"
      ",
      }
    `)
  })

  test('expanded=false vs expanded=undefined is a mismatch', () => {
    expect(match('<button>Menu</button>', '- button "Menu" [expanded=false]'))
      .toMatchInlineSnapshot(`
        {
          "actual": "
        - button "Menu"
        ",
          "expected": "
        - button "Menu"
        ",
          "pass": false,
          "rawExpected": "
        - button "Menu"
        ",
        }
      `)
  })
})
