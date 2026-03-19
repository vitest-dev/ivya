/**
 * Minimal YAML parser for aria snapshot templates.
 *
 * Supports only the subset needed by ariaSnapshot.ts:
 * - Sequences (- item)
 * - Maps (key: value)
 * - Scalars (plain strings, double-quoted strings, numbers, booleans)
 * - Indentation-based nesting
 *
 * NOT supported: anchors, aliases, tags, merge keys, block scalars,
 * flow collections, multi-document, comments.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Range = [number, number, number]

// ---------------------------------------------------------------------------
// AST node classes — API-compatible with the `yaml` package
// ---------------------------------------------------------------------------

export class Scalar<T = unknown> {
  value: T
  range: [number, number, number]
  constructor(value: T, range: [number, number, number] = [0, 0, 0]) {
    this.value = value
    this.range = range
  }
}

export class YAMLMap {
  items: { key: Scalar<string>; value: Scalar | YAMLSeq | YAMLMap | null }[]
  range: [number, number, number]
  constructor(range: [number, number, number] = [0, 0, 0]) {
    this.items = []
    this.range = range
  }
}

export class YAMLSeq {
  items: (Scalar | YAMLMap | YAMLSeq)[]
  range: [number, number, number]
  constructor(range: [number, number, number] = [0, 0, 0]) {
    this.items = []
    this.range = range
  }
}

// ---------------------------------------------------------------------------
// LineCounter — API-compatible with the `yaml` package
// ---------------------------------------------------------------------------

export class LineCounter {
  lineStarts: number[] = [0]

  addNewLine(offset: number) {
    if (offset > this.lineStarts[this.lineStarts.length - 1])
      this.lineStarts.push(offset)
  }

  linePos(offset: number): { line: number; col: number } {
    let low = 0
    let high = this.lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (this.lineStarts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return { line: low + 1, col: offset - this.lineStarts[low] + 1 }
  }
}

// ---------------------------------------------------------------------------
// YAMLError
// ---------------------------------------------------------------------------

export class YAMLError extends Error {
  pos: [number, number]
  constructor(message: string, pos: [number, number]) {
    super(message)
    this.pos = pos
  }
}

// ---------------------------------------------------------------------------
// parseDocument
// ---------------------------------------------------------------------------

interface ParseOptions {
  keepSourceTokens?: boolean
  lineCounter?: LineCounter
  prettyErrors?: boolean
  [key: string]: unknown
}

interface ParsedDocument {
  contents: Scalar | YAMLMap | YAMLSeq | null
  errors: YAMLError[]
}

export function parseDocument(
  text: string,
  options: ParseOptions = {}
): ParsedDocument {
  const lineCounter = options.lineCounter
  const errors: YAMLError[] = []

  // Build line starts for the lineCounter
  if (lineCounter) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') lineCounter.addNewLine(i + 1)
    }
  }

  try {
    const parser = new Parser(text, errors)
    const contents = parser.parseRoot()
    return { contents, errors }
  } catch (e) {
    if (e instanceof YAMLError) {
      errors.push(e)
      return { contents: null, errors }
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Internal line representation
// ---------------------------------------------------------------------------

interface Line {
  indent: number
  offset: number // absolute offset of first non-whitespace char
  lineOffset: number // absolute offset of start of line
  raw: string // full line including leading whitespace
  content: string // trimmed content (no leading/trailing whitespace)
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private lines: Line[]
  private pos: number // current line index
  private text: string
  private errors: YAMLError[]

  constructor(text: string, errors: YAMLError[]) {
    this.text = text
    this.errors = errors
    this.lines = []
    this.pos = 0

    let offset = 0
    const rawLines = text.split('\n')
    for (const raw of rawLines) {
      const stripped = raw.replace(/\r$/, '')
      const trimmed = stripped.replace(/^\s+/, '')
      const indent = stripped.length - trimmed.length
      this.lines.push({
        indent,
        offset: offset + indent,
        lineOffset: offset,
        raw: stripped,
        content: trimmed,
      })
      offset += raw.length + 1 // +1 for \n
    }

    // Remove trailing empty lines
    while (
      this.lines.length > 0 &&
      this.lines[this.lines.length - 1].content === ''
    ) {
      this.lines.pop()
    }
  }

  parseRoot(): Scalar | YAMLMap | YAMLSeq | null {
    if (this.lines.length === 0) return null
    return this.parseNode(0)
  }

  private currentLine(): Line | undefined {
    return this.lines[this.pos]
  }

  private parseNode(minIndent: number): Scalar | YAMLMap | YAMLSeq | null {
    this.skipEmpty()
    const line = this.currentLine()
    if (!line || line.indent < minIndent) return null

    if (line.content.startsWith('- ') || line.content === '-') {
      return this.parseSequence(line.indent)
    }
    if (this.isMapEntry(line.content)) {
      return this.parseMap(line.indent)
    }
    // Single scalar
    return this.parseScalarValue(line.content, line.offset, line)
  }

  private parseSequence(baseIndent: number): YAMLSeq {
    const startLine = this.currentLine()!
    const seq = new YAMLSeq([startLine.offset - startLine.indent, 0, 0])
    let lastOffset = startLine.offset

    while (this.pos < this.lines.length) {
      this.skipEmpty()
      const line = this.currentLine()
      if (!line || line.indent < baseIndent) break
      if (line.indent > baseIndent) {
        this.addError('Bad indentation of a sequence entry', line.offset)
        break
      }

      if (!line.content.startsWith('- ') && line.content !== '-') {
        // Not a sequence item at this level — could be a map that follows
        break
      }

      // Content after "- "
      const dashLen = line.content === '-' ? 1 : 2
      const itemContent = line.content.slice(dashLen)
      const itemOffset = line.offset + dashLen

      this.pos++

      if (itemContent === '' || itemContent.trim() === '') {
        // "- \n" followed by indented content
        const child = this.parseNode(baseIndent + 1)
        if (child) {
          seq.items.push(child)
          lastOffset = this.peekLastOffset()
        }
      } else if (this.isMapEntry(itemContent)) {
        // "- key: value" — inline map entry, possibly with more at same indent+2
        const map = this.parseInlineMap(
          itemContent,
          itemOffset,
          baseIndent + dashLen,
          line
        )
        seq.items.push(map)
        lastOffset = map.range[2]
      } else {
        // "- scalar"
        const scalar = this.parseScalarValue(itemContent, itemOffset, line)
        seq.items.push(scalar)
        lastOffset = scalar.range[2]
      }
    }

    seq.range[1] = lastOffset
    seq.range[2] = lastOffset
    return seq
  }

  private parseMap(baseIndent: number): YAMLMap {
    const startLine = this.currentLine()!
    const map = new YAMLMap([startLine.offset - startLine.indent, 0, 0])
    let lastOffset = startLine.offset

    while (this.pos < this.lines.length) {
      this.skipEmpty()
      const line = this.currentLine()
      if (!line || line.indent < baseIndent) break
      if (line.indent > baseIndent) {
        this.addError('Bad indentation of a mapping entry', line.offset)
        break
      }
      if (!this.isMapEntry(line.content)) break

      const { key, valueStr, colonOffset, valueOffset } = this.splitMapEntry(
        line.content,
        line.offset
      )
      const keyScalar = new Scalar<string>(key, [
        line.offset,
        line.offset + key.length,
        colonOffset,
      ])

      this.pos++

      let value: Scalar | YAMLSeq | YAMLMap | null
      if (valueStr === '') {
        value = this.parseMapValue(baseIndent, colonOffset)
      } else {
        value = this.parseScalarValue(valueStr.trim(), valueOffset, line)
      }

      map.items.push({ key: keyScalar, value })
      lastOffset = value ? this.getNodeEnd(value) : colonOffset + 1
    }

    map.range[1] = lastOffset
    map.range[2] = lastOffset
    return map
  }

  /**
   * Parse an inline map that starts after "- " in a sequence.
   * E.g. "- key: value" or "- key:\n    - child"
   * May continue with more entries at the same indent level.
   */
  private parseInlineMap(
    firstEntry: string,
    entryOffset: number,
    contentIndent: number,
    _sourceLine: Line
  ): YAMLMap {
    const map = new YAMLMap([entryOffset, 0, 0])
    let lastOffset = entryOffset

    // Parse first entry
    const { key, valueStr, colonOffset, valueOffset } = this.splitMapEntry(
      firstEntry,
      entryOffset
    )
    const keyScalar = new Scalar<string>(key, [
      entryOffset,
      entryOffset + key.length,
      colonOffset,
    ])

    let value: Scalar | YAMLSeq | YAMLMap | null
    if (valueStr === '') {
      value = this.parseMapValue(contentIndent, colonOffset)
    } else {
      value = this.parseScalarValue(valueStr.trim(), valueOffset, _sourceLine)
    }

    map.items.push({ key: keyScalar, value })
    lastOffset = value ? this.getNodeEnd(value) : colonOffset + 1

    // Continue with more map entries at contentIndent
    while (this.pos < this.lines.length) {
      this.skipEmpty()
      const line = this.currentLine()
      if (!line || line.indent < contentIndent) break
      if (line.indent > contentIndent) break
      if (!this.isMapEntry(line.content)) break
      // Ensure it's not a sequence item
      if (line.content.startsWith('- ')) break

      const entry = this.splitMapEntry(line.content, line.offset)
      const ks = new Scalar<string>(entry.key, [
        line.offset,
        line.offset + entry.key.length,
        entry.colonOffset,
      ])

      this.pos++

      let v: Scalar | YAMLSeq | YAMLMap | null
      if (entry.valueStr === '') {
        v = this.parseMapValue(contentIndent, entry.colonOffset)
      } else {
        v = this.parseScalarValue(entry.valueStr.trim(), entry.valueOffset, line)
      }

      map.items.push({ key: ks, value: v })
      lastOffset = v ? this.getNodeEnd(v) : entry.colonOffset + 1
    }

    map.range[1] = lastOffset
    map.range[2] = lastOffset
    return map
  }

  /**
   * Parse the value of a map entry when the value is on subsequent lines.
   * In YAML, a block sequence can start at the same indent as the key,
   * but other block collections must be indented further.
   */
  private parseMapValue(
    contentIndent: number,
    colonOffset: number
  ): Scalar | YAMLSeq | YAMLMap | null {
    this.skipEmpty()
    const nextLine = this.currentLine()
    if (!nextLine || nextLine.indent < contentIndent) {
      return new Scalar(null, [colonOffset + 1, colonOffset + 1, colonOffset + 1])
    }
    // Block sequence at same indent as content is allowed
    if (
      nextLine.indent === contentIndent &&
      (nextLine.content.startsWith('- ') || nextLine.content === '-')
    ) {
      return this.parseNode(contentIndent)!
    }
    // Other content must be further indented
    if (nextLine.indent > contentIndent) {
      return this.parseNode(contentIndent + 1)!
    }
    return new Scalar(null, [colonOffset + 1, colonOffset + 1, colonOffset + 1])
  }

  private getNodeEnd(node: Scalar | YAMLSeq | YAMLMap): number {
    return node.range[2]
  }

  private peekLastOffset(): number {
    if (this.pos > 0 && this.pos <= this.lines.length) {
      const prev = this.lines[this.pos - 1]
      return prev.lineOffset + prev.raw.length
    }
    return this.text.length
  }

  // -------------------------------------------------------------------------
  // Scalar parsing
  // -------------------------------------------------------------------------

  private parseScalarValue(raw: string, offset: number, line: Line): Scalar {
    const trimmed = raw.trim()
    const trimStart = raw.indexOf(trimmed)
    const adjOffset = offset + trimStart
    const end = adjOffset + trimmed.length
    const lineEnd = line.lineOffset + line.raw.length

    if (trimmed.startsWith('"')) {
      return this.parseQuotedScalar(trimmed, adjOffset, lineEnd)
    }

    // Boolean
    if (trimmed === 'true' || trimmed === 'false') {
      return new Scalar<boolean>(trimmed === 'true', [adjOffset, end, lineEnd])
    }

    // Null
    if (trimmed === 'null' || trimmed === '~') {
      return new Scalar(null, [adjOffset, end, lineEnd])
    }

    // Number — integers and floats
    if (trimmed !== '' && isNumeric(trimmed)) {
      return new Scalar<number>(Number(trimmed), [adjOffset, end, lineEnd])
    }

    // Plain string
    return new Scalar<string>(trimmed, [adjOffset, end, lineEnd])
  }

  private parseQuotedScalar(
    raw: string,
    offset: number,
    lineEnd: number
  ): Scalar<string> {
    let result = ''
    let i = 1 // skip opening quote
    while (i < raw.length) {
      const ch = raw[i]
      if (ch === '\\') {
        i++
        if (i >= raw.length) {
          this.addError('Unterminated double-quoted string', offset + i)
          break
        }
        const esc = raw[i]
        switch (esc) {
          case 'n':
            result += '\n'
            break
          case 't':
            result += '\t'
            break
          case 'r':
            result += '\r'
            break
          case '"':
            result += '"'
            break
          case '\\':
            result += '\\'
            break
          case '/':
            result += '/'
            break
          default:
            result += esc
        }
      } else if (ch === '"') {
        // End of string
        const end = offset + i + 1
        return new Scalar<string>(result, [offset, end, lineEnd])
      } else {
        result += ch
      }
      i++
    }
    // Unterminated
    this.addError('Unterminated double-quoted string', offset)
    return new Scalar<string>(result, [offset, offset + raw.length, lineEnd])
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private skipEmpty() {
    while (this.pos < this.lines.length && this.lines[this.pos].content === '') {
      this.pos++
    }
  }

  /**
   * Check if content looks like a map entry: `key: value` or `key:`.
   * Must not start with "- ".
   * The colon must be followed by a space or end of string.
   */
  private isMapEntry(content: string): boolean {
    // Find colon that is followed by space or EOL, not inside quotes
    const colonIdx = this.findMapColon(content)
    return colonIdx >= 0
  }

  /**
   * Find the colon index for a map entry.
   * Skip colons inside double-quoted strings.
   */
  private findMapColon(content: string): number {
    let inQuote = false
    let escaped = false
    for (let i = 0; i < content.length; i++) {
      const ch = content[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\' && inQuote) {
        escaped = true
        continue
      }
      if (ch === '"') {
        inQuote = !inQuote
        continue
      }
      if (!inQuote && ch === ':') {
        // Colon must be followed by space or EOL
        if (i + 1 >= content.length || content[i + 1] === ' ') {
          return i
        }
      }
    }
    return -1
  }

  private splitMapEntry(
    content: string,
    baseOffset: number
  ): {
    key: string
    valueStr: string
    colonOffset: number
    valueOffset: number
  } {
    const colonIdx = this.findMapColon(content)
    const keyRaw = content.slice(0, colonIdx)
    const key = keyRaw.trim()
    const colonOffset = baseOffset + colonIdx
    const afterColon = content.slice(colonIdx + 1)
    const valueStr = afterColon.trimStart()
    const valueOffset =
      colonOffset + 1 + (afterColon.length - afterColon.trimStart().length)

    // Handle quoted keys
    if (key.startsWith('"') && key.endsWith('"')) {
      return {
        key: key.slice(1, -1),
        valueStr,
        colonOffset,
        valueOffset,
      }
    }

    return { key, valueStr, colonOffset, valueOffset }
  }

  private addError(message: string, offset: number) {
    this.errors.push(new YAMLError(message, [offset, offset + 1]))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNumeric(str: string): boolean {
  if (str === '' || str === '-' || str === '+') return false
  // Allow optional leading sign, digits, optional decimal, optional exponent
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(str)
}
