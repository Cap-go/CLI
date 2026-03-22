import type { InitRuntimeState } from '../runtime'
import { Box, Text, useStdout } from 'ink'
import React, { useEffect, useState } from 'react'
import { CurrentStepSection, InitHeader, ProgressSection, PromptArea, ScreenIntro, SpinnerArea } from './components'

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
  const visibleLogs = snapshot.logs.slice(-Math.max(0, rows - 14))
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

      {screen?.introLines?.length || screen?.title
        ? <ScreenIntro screen={screen} />
        : null}

      {screen && <ProgressSection screen={screen} />}

      {screen && <CurrentStepSection screen={screen} />}

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
