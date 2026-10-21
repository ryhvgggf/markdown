import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { isComposingEvent } from '../ime'
import { abapLanguage } from './abap'
import { CodeBlockView } from './code-block-view'
import { CODE_LANGUAGES } from './code-languages'

export { CODE_LANGUAGES }

export const lowlight = createLowlight()
lowlight.register({ abap: abapLanguage, javascript, typescript, java, sql, xml, json, css, bash, python, markdown })

/** A null language means plain text: tiptap would otherwise call highlightAuto, so neutralise it. */
const plainLowlight: typeof lowlight = {
  ...lowlight,
  highlightAuto: () => ({ type: 'root', children: [], data: { language: undefined, relevance: 0 } }),
}

export const CodeBlock = CodeBlockLowlight.configure({ lowlight: plainLowlight, defaultLanguage: null }).extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})

/** Tab inside a code block inserts two spaces (never while composing). */
export const CodeTab = Extension.create({
  name: 'codeTab',
  priority: 1100,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
            if (view.state.selection.$from.parent.type.name !== 'codeBlock') return false
            if (isComposingEvent(event, view)) return false
            view.dispatch(view.state.tr.insertText('  '))
            return true
          },
        },
      }),
    ]
  },
})
