import type { InitRuntimeState } from '../runtime'
import { Box, Text, useStdout } from 'ink'
import React, { useEffect, useState } from 'react'
import { CurrentStepSection, InitHeader, ProgressSection, PromptArea, ScreenIntro, SpinnerArea } from './components'

interface InitInkAppProps {
  getSnapshot: () => InitRuntimeState
  subscribe: (listener: () => void) => () => void
  updatePromptError: (error?: string) => void
}

export default function InitInkApp({ getSnapshot, subscribe, updatePromptError }: InitInkAppProps) {
  const [snapshot, setSnapshot] = useState(getSnapshot())
  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 96
  const rows = stdout?.rows ?? 24
  const contentWidth = Math.max(60, columns - 6)
  const visibleLogs = snapshot.logs.slice(-Math.max(6, rows - 14))

  useEffect(() => {
    const unsubscribe = subscribe(() => setSnapshot(getSnapshot()))
    return () => {
      unsubscribe()
    }
  }, [getSnapshot, subscribe])

  return (
    <Box flexDirection="column" padding={1} width={columns}>
      <InitHeader />

      {snapshot.screen?.introLines?.length || snapshot.screen?.title
        ? <ScreenIntro screen={snapshot.screen!} />
        : null}

      {snapshot.screen && <ProgressSection screen={snapshot.screen} />}

      {snapshot.screen && <CurrentStepSection screen={snapshot.screen} />}

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
