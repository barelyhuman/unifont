import type { FontFaceData, LocalFontSource, RemoteFontSource } from '../types'

import { type Declaration, findAll, parse } from 'css-tree'

const extractableKeyMap: Record<string, keyof FontFaceData> = {
  'src': 'src',
  'font-display': 'display',
  'font-weight': 'weight',
  'font-style': 'style',
  'font-feature-settings': 'featureSettings',
  'font-variations-settings': 'variationSettings',
  'unicode-range': 'unicodeRange',
}

const formatMap: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  otf: 'opentype',
  ttf: 'truetype',
  eot: 'embedded-opentype',
  svg: 'svg',
}

const formatPriorityList = Object.values(formatMap)

export function extractFontFaceData(css: string, family?: string): FontFaceData[] {
  const fontFaces: FontFaceData[] = []

  for (const node of findAll(parse(css), node => node.type === 'Atrule' && node.name === 'font-face')) {
    if (node.type !== 'Atrule' || node.name !== 'font-face') {
      continue
    }

    if (family) {
      const isCorrectFontFace = node.block?.children.some((child) => {
        if (child.type !== 'Declaration' || child.property !== 'font-family') {
          return false
        }

        const value = extractCSSValue(child) as string | string[]
        const slug = family.toLowerCase()
        if (typeof value === 'string' && value.toLowerCase() === slug) {
          return true
        }
        if (Array.isArray(value) && value.length > 0 && value.some(v => v.toLowerCase() === slug)) {
          return true
        }
        return false
      })

      // Don't extract font face data from this `@font-face` rule if it doesn't match the specified family
      if (!isCorrectFontFace) {
        continue
      }
    }

    const data: Partial<FontFaceData> = {}
    for (const child of node.block?.children || []) {
      if (child.type === 'Declaration' && child.property in extractableKeyMap) {
        const value = extractCSSValue(child) as any
        data[extractableKeyMap[child.property]!] = child.property === 'src' && !Array.isArray(value) ? [value] : value
      }
    }
    fontFaces.push(data as FontFaceData)
  }

  return mergeFontSources(fontFaces)
}

function processRawValue(value: string) {
  return value.split(',').map(v => v.trim().replace(/^(?<quote>['"])(.*)\k<quote>$/, '$2'))
}

function extractCSSValue(node: Declaration) {
  if (node.value.type === 'Raw') {
    return processRawValue(node.value.value)
  }

  const values = [] as Array<string | number | RemoteFontSource | LocalFontSource>
  let buffer = ''
  for (const child of node.value.children) {
    if (child.type === 'Function') {
      if (child.name === 'local' && child.children.first?.type === 'String') {
        values.push({ name: child.children.first.value })
      }
      if (child.name === 'format' && child.children.first?.type === 'String') {
        (values.at(-1) as RemoteFontSource).format = child.children.first.value
      }
      if (child.name === 'tech' && child.children.first?.type === 'String') {
        (values.at(-1) as RemoteFontSource).tech = child.children.first.value
      }
    }
    if (child.type === 'Url') {
      values.push({ url: child.value })
    }
    if (child.type === 'Identifier') {
      buffer = buffer ? `${buffer} ${child.name}` : child.name
    }
    if (child.type === 'String') {
      values.push(child.value)
    }
    if (child.type === 'Operator' && child.value === ',' && buffer) {
      values.push(buffer)
      buffer = ''
    }
    if (child.type === 'UnicodeRange') {
      values.push(child.value)
    }
    if (child.type === 'Number') {
      values.push(Number(child.value))
    }
  }

  if (buffer) {
    values.push(buffer)
  }

  if (values.length === 1) {
    return values[0]
  }

  return values
}

function mergeFontSources(data: FontFaceData[]) {
  const mergedData: FontFaceData[] = []
  for (const face of data) {
    const keys = Object.keys(face).filter(k => k !== 'src') as Array<keyof typeof face>
    const existing = mergedData.find(f => (Object.keys(f).length === keys.length + 1) && keys.every(key => f[key]?.toString() === face[key]?.toString()))
    if (existing) {
      existing.src.push(...face.src)
    }
    else {
      mergedData.push(face)
    }
  }

  // Sort font sources by priority
  for (const face of mergedData) {
    face.src.sort((a, b) => {
      // Prioritise local fonts (with 'name' property) over remote fonts, and then formats by formatPriorityList
      const aIndex = 'format' in a ? formatPriorityList.indexOf(a.format || 'woff2') : -2
      const bIndex = 'format' in b ? formatPriorityList.indexOf(b.format || 'woff2') : -2
      return aIndex - bIndex
    })
  }

  return mergedData
}
