import type { InitCodeDiff, InitRuntimeState } from '../runtime'
import { Alert } from '@inkjs/ui'
import { Box, Text, useStdout } from 'ink'
import React, { useEffect, useState } from 'react'
import { CurrentStepSection, InitHeader, ProgressSection, PromptArea, ScreenIntro, SpinnerArea } from './components'

function CodeDiffPanel({ diff, width }: Readonly<{ diff: InitCodeDiff, width: number }>) {
  const title = diff.created
    ? `Created ${diff.filePath}`
    : `Updated ${diff.filePath}`
  const maxLineNumber = diff.lines.reduce((max, line) => Math.max(max, line.lineNumber), 0)
  const gutterWidth = Math.max(2, String(maxLineNumber).length)
  return (
    <Box flexDirection="column" marginTop={1} width={width} borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green" bold>{`📝 ${title}`}</Text>
      {diff.note !== undefined && (
        <Text color="gray">{`  ${diff.note}`}</Text>
      )}
      {diff.lines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {diff.lines.map((line, index) => {
            const marker = line.kind === 'add' ? '+' : ' '
            const lineNum = String(line.lineNumber).padStart(gutterWidth, ' ')
            const color = line.kind === 'add' ? 'green' : 'gray'
            return (
              <Text key={`diff-${index}`} color={color}>
                {`${marker} ${lineNum} │ ${line.text}`}
              </Text>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

interface InitInkAppProps {
  getSnapshot: () => InitRuntimeState
  subscribe: (listener: () => void) => () => void
  updatePromptError: (error?: string) => void
}

export default function InitInkApp({ getSnapshot, subscribe, updatePromptError }: Readonly<InitInkAppProps>) {
  const [snapshot, setSnapshot] = useState(getSnapshot())
  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 96
  const rows = stdout?.rows ?? 24
  const contentWidth = Math.max(0, columns - 6)
  // Estimate how many terminal rows the code diff panel consumes so the log
  // area (and the prompt/spinner rendered after it) still fit in the viewport
  // on short terminals. Overhead covers the panel's marginTop, top/bottom
  // borders, title line, and the marginTop between title and line content.
  // Long lines that wrap are approximated by counting each line's wrap count.
  const diffPanelHeight = (() => {
    const diff = snapshot.codeDiff
    if (!diff)
      return 0
    const innerWidth = Math.max(1, contentWidth - 4)
    const wrappedLineRows = diff.lines.reduce((sum, line) => {
      const rendered = `  ${String(line.lineNumber)} │ ${line.text}`
      return sum + Math.max(1, Math.ceil(rendered.length / innerWidth))
    }, 0)
    const noteRows = diff.note !== undefined ? 1 : 0
    const linesBlockRows = diff.lines.length > 0 ? wrappedLineRows + 1 : 0
    // 1 (panel marginTop) + 2 (borders) + 1 (title) + noteRows + linesBlockRows
    return 4 + noteRows + linesBlockRows
  })()
  // `Array.prototype.slice(-0)` returns the full array because `-0` coerces
  // to `0`, so we cannot feed a zero clamp into slice — explicitly short-
  // circuit to an empty array when there's no viewport budget left for logs.
  const visibleLogCount = Math.max(0, rows - 14 - diffPanelHeight)
  const visibleLogs = visibleLogCount === 0 ? [] : snapshot.logs.slice(-visibleLogCount)
  const screen = snapshot.screen

  useEffect(() => {
    const unsubscribe = subscribe(() => setSnapshot(getSnapshot()))
    return () => {
      unsubscribe()
    }
  }, [getSnapshot, subscribe])

  return (
    <Box flexDirection="column" padding={1} width={columns}>
      <InitHeader />

      {snapshot.versionWarning && (
        <Box marginTop={1} width={contentWidth}>
          <Alert variant="warning">
            You are using @capgo/cli@{snapshot.versionWarning.currentVersion} — update to @capgo/cli@{snapshot.versionWarning.latestVersion} or @capgo/cli@{snapshot.versionWarning.majorVersion}
          </Alert>
        </Box>
      )}

      {screen?.introLines?.length || screen?.title
        ? <ScreenIntro screen={screen} />
        : null}

      {screen && <ProgressSection screen={screen} />}

      {screen && <CurrentStepSection screen={screen} />}

      {snapshot.codeDiff && (
        <CodeDiffPanel diff={snapshot.codeDiff} width={contentWidth} />
      )}

      {visibleLogs.length > 0 && (
        <Box flexDirection="column" marginTop={1} width={contentWidth}>
          {visibleLogs.map((entry, index) => (
            <Text key={`${entry.message}-${index}`} color={entry.tone}>{entry.message}</Text>
          ))}
        </Box>
      )}

      <Box width={contentWidth}>
        <PromptArea prompt={snapshot.prompt} onTextError={updatePromptError} />
      </Box>

      <Box width={contentWidth}>
        <SpinnerArea text={snapshot.spinner} />
      </Box>
    </Box>
  )
}
