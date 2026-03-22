import { ensureInitInkSession, INIT_CANCEL, pushInitLog, requestInitConfirm, requestInitSelect, requestInitText, setInitSpinner, stopInitInkSession } from './runtime'

export const CANCEL = INIT_CANCEL

type PromptResult<T> = Promise<T | symbol>

interface ConfirmOptions {
  message: string
  initialValue?: boolean
}

interface TextOptions {
  message: string
  placeholder?: string
  validate?: (value: string | undefined) => string | undefined
}

interface SelectOption<T = string> {
  value: T
  label: string
  hint?: string
}

interface SelectOptions<T = string> {
  message: string
  options: SelectOption<T>[]
}

interface SpinnerController {
  start: (message: string) => void
  stop: (message?: string) => void
  message: (message: string) => void
}

export function intro(_message: string) {
  ensureInitInkSession()
}

export function outro(message: string) {
  stopInitInkSession({ text: message, tone: 'green' })
}

export function cancel(message: string) {
  stopInitInkSession({ text: message, tone: 'yellow' })
}

export function isCancel(value: unknown): value is symbol {
  return value === CANCEL
}

export const log = {
  info(message: string) {
    pushInitLog(message, 'cyan')
  },
  warn(message: string) {
    pushInitLog(message, 'yellow')
  },
  error(message: string) {
    pushInitLog(message, 'red')
  },
  success(message: string) {
    pushInitLog(message, 'green')
  },
}

export function confirm(options: ConfirmOptions): PromptResult<boolean> {
  return requestInitConfirm(options.message, options.initialValue)
}

export function text(options: TextOptions): PromptResult<string> {
  return requestInitText(options.message, options.placeholder, options.validate)
}

export function select<T = string>(options: SelectOptions<T>): PromptResult<T> {
  return requestInitSelect(options.message, options.options)
}

export function spinner(): SpinnerController {
  return {
    start(message: string) {
      setInitSpinner(message)
    },
    stop(message?: string) {
      setInitSpinner(undefined)
      if (message)
        pushInitLog(message, message.includes('❌') ? 'red' : 'green')
    },
    message(message: string) {
      setInitSpinner(message)
    },
  }
}
