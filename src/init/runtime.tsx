import process, { stdout } from 'node:process'
import { render } from 'ink'
import React from 'react'
import InitInkApp from './ui/app'

export const INIT_CANCEL = Symbol('init-cancel')

export type InitLogTone = 'cyan' | 'yellow' | 'green' | 'red'

export type InitScreenTone = 'cyan' | 'blue' | 'green' | 'yellow'

export interface InitScreen {
  title?: string
  introLines?: string[]
  phaseLabel?: string
  progress?: number
  stepLabel?: string
  stepSummary?: string
  roadmapLine?: string
  statusLine?: string
  resumeLine?: string
  completionLines?: string[]
  tone?: InitScreenTone
}

export interface ConfirmPrompt {
  kind: 'confirm'
  message: string
  initialValue?: boolean
  resolve: (value: boolean | symbol) => void
}

export interface TextPrompt {
  kind: 'text'
  message: string
  placeholder?: string
  validate?: (value: string | undefined) => string | undefined
  error?: string
  resolve: (value: string | symbol) => void
}

export interface SelectPromptOption<T = unknown> {
  label: string
  hint?: string
  value: T
}

export interface SelectPrompt {
  kind: 'select'
  message: string
  options: SelectPromptOption[]
  resolve: (value: unknown | symbol) => void
}

export type PromptRequest = ConfirmPrompt | TextPrompt | SelectPrompt

export interface InitLogEntry {
  message: string
  tone: InitLogTone
}

export interface InitRuntimeState {
  screen?: InitScreen
  logs: InitLogEntry[]
  spinner?: string
  prompt?: PromptRequest
}

let state: InitRuntimeState = {
  logs: [],
}

const listeners = new Set<() => void>()
let inkApp: ReturnType<typeof render> | undefined
let started = false

function emit() {
  listeners.forEach(listener => listener())
}

function updateState(updater: (current: InitRuntimeState) => InitRuntimeState) {
  state = updater(state)
  emit()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getInitSnapshot() {
  return state
}

export function ensureInitInkSession() {
  if (started)
    return
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    return

  started = true
  inkApp = render(React.createElement(InitInkApp, {
    getSnapshot: getInitSnapshot,
    subscribe,
    updatePromptError,
  }))
}

export function stopInitInkSession(finalMessage?: { text: string, tone: 'green' | 'yellow' }) {
  if (inkApp) {
    inkApp.unmount()
    inkApp = undefined
  }
  started = false
  state = { screen: undefined, logs: [], spinner: undefined, prompt: undefined }
  if (finalMessage)
    stdout.write(`${finalMessage.text}\n`)
}

export function setInitScreen(screen: InitScreen) {
  ensureInitInkSession()
  updateState(current => ({ ...current, screen }))
}

export function pushInitLog(message: string, tone: InitLogTone) {
  ensureInitInkSession()
  updateState(current => ({
    ...current,
    logs: [...current.logs, { message, tone }],
  }))
}

export function clearInitLogs() {
  ensureInitInkSession()
  updateState(current => ({
    ...current,
    logs: [],
  }))
}

export function setInitSpinner(message?: string) {
  ensureInitInkSession()
  updateState(current => ({ ...current, spinner: message }))
}

export function requestInitConfirm(message: string, initialValue?: boolean): Promise<boolean | symbol> {
  ensureInitInkSession()
  return new Promise((resolve) => {
    updateState(current => ({
      ...current,
      prompt: {
        kind: 'confirm',
        message,
        initialValue,
        resolve: (value) => {
          updateState(next => ({ ...next, prompt: undefined }))
          resolve(value)
        },
      },
    }))
  })
}

export function requestInitText(message: string, placeholder?: string, validate?: (value: string | undefined) => string | undefined): Promise<string | symbol> {
  ensureInitInkSession()
  return new Promise((resolve) => {
    updateState(current => ({
      ...current,
      prompt: {
        kind: 'text',
        message,
        placeholder,
        validate,
        resolve: (value) => {
          updateState(next => ({ ...next, prompt: undefined }))
          resolve(value)
        },
      },
    }))
  })
}

export function requestInitSelect<T = string>(message: string, options: SelectPromptOption<T>[]): Promise<T | symbol> {
  ensureInitInkSession()
  return new Promise((resolve) => {
    updateState(current => ({
      ...current,
      prompt: {
        kind: 'select',
        message,
        options,
        resolve: (value) => {
          updateState(next => ({ ...next, prompt: undefined }))
          resolve(value as T | symbol)
        },
      },
    }))
  })
}

function updatePromptError(error?: string) {
  updateState((current) => {
    if (!current.prompt || current.prompt.kind !== 'text')
      return current
    return {
      ...current,
      prompt: {
        ...current.prompt,
        error,
      },
    }
  })
}
