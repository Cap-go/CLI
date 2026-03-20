// src/build/onboarding/ui/app.tsx
import React, { useState, useEffect, useCallback, useRef, type FC } from 'react'
import { Box, Text, Newline, useApp, useInput, useStdout } from 'ink'
import { Select, ProgressBar, Alert } from '@inkjs/ui'
import { Header, Divider, SpinnerLine, SuccessLine, ErrorLine, FilteredTextInput } from './components.js'
import {
  type OnboardingStep, type OnboardingProgress, type ApiKeyData,
  type CertificateData, type ProfileData,
  STEP_PROGRESS, getPhaseLabel,
} from '../types.js'
import { loadProgress, saveProgress, deleteProgress, getResumeStep } from '../progress.js'
import { generateCsr, createP12, DEFAULT_P12_PASSWORD } from '../csr.js'
import { generateJwt, verifyApiKey, createCertificate, ensureBundleId, createProfile, deleteProfile, revokeCertificate, DuplicateProfileError, CertificateLimitError } from '../apple-api.js'
import { canUseFilePicker, openFilePicker } from '../file-picker.js'
import { readFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import open from 'open'
import { updateSavedCredentials, loadSavedCredentials } from '../../credentials.js'
import { requestBuildInternal, type BuildLogger } from '../../request.js'
import { findSavedKey } from '../../../utils.js'

interface LogEntry { text: string, color?: string }

interface AppProps {
  appId: string
  initialProgress: OnboardingProgress | null
}

const OnboardingApp: FC<AppProps> = ({ appId, initialProgress }) => {
  const { exit } = useApp()
  const startStep = getResumeStep(initialProgress)

  const [step, setStep] = useState<OnboardingStep>(startStep === 'welcome' ? 'welcome' : startStep)
  const [log, setLog] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [retryStep, setRetryStep] = useState<OnboardingStep | null>(null)
  // askOverwrite removed — credential check happens at start now
  const [duplicateProfiles, setDuplicateProfiles] = useState<Array<{ id: string, name: string, profileType: string }>>([])
  const [existingCerts, setExistingCerts] = useState<Array<{ id: string, name: string, serialNumber: string, expirationDate: string }>>([])
  const [certToRevoke, setCertToRevoke] = useState<string | null>(null)
  const pickerOpenedRef = useRef(false)
  // overwriteConfirmedRef removed — credential check happens at start now

  // Open browser on Ctrl+O (FilteredTextInput ignores ctrl keys, so no conflict)
  useInput((input, key) => {
    if (key.ctrl && input === 'o' && (step === 'api-key-instructions' || step === 'input-issuer-id')) {
      open('https://appstoreconnect.apple.com/access/integrations/api')
    }
  })

  // Collected data — restore p8Path from progress if resuming
  const [p8Path, setP8Path] = useState(initialProgress?.p8Path || '')
  const [p8Content, _setP8Content] = useState('')
  const [keyId, setKeyId] = useState(initialProgress?.completedSteps.apiKeyVerified?.keyId || initialProgress?.keyId || '')
  const [issuerId, setIssuerId] = useState(initialProgress?.completedSteps.apiKeyVerified?.issuerId || initialProgress?.issuerId || '')

  // Get terminal height for build output sizing
  const { stdout } = useStdout()
  const terminalRows = stdout?.rows ?? 24

  // Refs to avoid stale closures in useEffect async handlers
  const p8ContentRef = useRef(p8Content)
  const p8PathRef = useRef(p8Path)
  const keyIdRef = useRef(keyId)
  const issuerIdRef = useRef(issuerId)

  // Wrapper that keeps both state and ref in sync
  const setP8Content = useCallback((val: string) => {
    p8ContentRef.current = val
    _setP8Content(val)
  }, [])

  // Keep refs in sync when state changes (for state set directly)
  useEffect(() => { p8PathRef.current = p8Path }, [p8Path])
  useEffect(() => { keyIdRef.current = keyId }, [keyId])
  useEffect(() => { issuerIdRef.current = issuerId }, [issuerId])
  const [teamId, setTeamId] = useState(initialProgress?.completedSteps.certificateCreated?.teamId || '')
  const [certData, setCertData] = useState<CertificateData | null>(initialProgress?.completedSteps.certificateCreated || null)
  const [profileData, setProfileData] = useState<ProfileData | null>(initialProgress?.completedSteps.profileCreated || null)
  const [buildUrl, setBuildUrl] = useState('')
  const [buildOutput, setBuildOutput] = useState<string[]>([])

  const addLog = useCallback((text: string, color = 'green') => {
    setLog(prev => [...prev, { text, color }])
  }, [])


  /** Save partial progress so the user can resume mid-flow */
  const savePartialProgress = useCallback(async (updates: { p8Path?: string, keyId?: string, issuerId?: string }) => {
    const existing = await loadProgress(appId) || {
      platform: 'ios' as const,
      appId,
      startedAt: new Date().toISOString(),
      completedSteps: {},
    }
    if (updates.p8Path !== undefined) existing.p8Path = updates.p8Path
    if (updates.keyId !== undefined) existing.keyId = updates.keyId
    if (updates.issuerId !== undefined) existing.issuerId = updates.issuerId
    await saveProgress(appId, existing)
  }, [appId])

  // Extract Key ID from .p8 filename (e.g. "AuthKey_ABC123.p8" or "ApiKey_ABC123.p8")
  function extractKeyIdFromPath(filePath: string): string {
    const match = filePath.match(/(?:Auth|Api)Key_([A-Z0-9]+)\.p8$/i)
    return match?.[1] || ''
  }

  /**
   * Get a fresh JWT token, re-reading the .p8 file if needed.
   * Uses refs to avoid stale closure issues.
   */
  /**
   * Special error to signal the UI should redirect to .p8 input.
   */
  class NeedP8Error extends Error {
    constructor() {
      super('Need .p8 file')
      this.name = 'NeedP8Error'
    }
  }

  async function getFreshToken(): Promise<string> {
    let content = p8ContentRef.current
    if (!content && p8PathRef.current) {
      content = await readFile(p8PathRef.current, 'utf-8')
      setP8Content(content)
    }
    if (!content) {
      throw new NeedP8Error()
    }
    return generateJwt(keyIdRef.current, issuerIdRef.current, content)
  }

  // Populate log with already-completed steps from progress (including partial input)
  useEffect(() => {
    if (!initialProgress)
      return
    // Show partial input steps
    if (initialProgress.p8Path) {
      addLog(`✔ Key file selected · ${initialProgress.p8Path}`)
    }
    if (initialProgress.keyId && !initialProgress.completedSteps.apiKeyVerified) {
      addLog(`✔ Key ID · ${initialProgress.keyId}`)
    }
    if (initialProgress.issuerId && !initialProgress.completedSteps.apiKeyVerified) {
      addLog(`✔ Issuer ID · ${initialProgress.issuerId}`)
    }
    // Show fully completed steps
    const { completedSteps } = initialProgress
    if (completedSteps.apiKeyVerified) {
      addLog(`✔ API Key verified — Key: ${completedSteps.apiKeyVerified.keyId}`)
    }
    if (completedSteps.certificateCreated) {
      addLog(`✔ Distribution certificate created — Expires ${completedSteps.certificateCreated.expirationDate}`)
    }
    if (completedSteps.profileCreated) {
      addLog(`✔ Provisioning profile created — "${completedSteps.profileCreated.profileName}"`)
    }
  }, []) // Only on mount

  const handleError = useCallback((err: unknown, failedStep: OnboardingStep) => {
    // If we need the .p8 file, redirect to the input step
    if (err instanceof NeedP8Error) {
      addLog('ℹ️  We need your .p8 key file to continue.', 'yellow')
      setStep('api-key-instructions')
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    if (retryCount === 0) {
      setError(message)
      setRetryStep(failedStep)
      setRetryCount(1)
      setStep('error')
    }
    else {
      // Second failure — exit
      addLog(`✖ ${message}`, 'red')
      addLog('Run `capgo build onboarding` to retry from where you left off.', 'yellow')
      setTimeout(() => exit(), 100)
    }
  }, [retryCount, addLog, exit])

  // ── Credential save logic ──

  async function doSaveCredentials() {
    // Re-read .p8 for APPLE_KEY_CONTENT (use refs for fresh values)
    let keyContent = p8ContentRef.current
    if (!keyContent && p8PathRef.current) {
      try {
        keyContent = await readFile(p8PathRef.current, 'utf-8')
        setP8Content(keyContent)
      }
      catch {
        throw new Error('Could not read .p8 file. Please provide the path again.')
      }
    }

    const provisioningMap: Record<string, { profile: string, name: string }> = {
      [appId]: {
        profile: profileData!.profileBase64,
        name: profileData!.profileName,
      },
    }

    await updateSavedCredentials(appId, 'ios', {
      BUILD_CERTIFICATE_BASE64: certData!.p12Base64,
      P12_PASSWORD: DEFAULT_P12_PASSWORD,
      CAPGO_IOS_PROVISIONING_MAP: JSON.stringify(provisioningMap),
      APPLE_KEY_ID: keyIdRef.current,
      APPLE_ISSUER_ID: issuerIdRef.current,
      APPLE_KEY_CONTENT: Buffer.from(keyContent).toString('base64'),
      APP_STORE_CONNECT_TEAM_ID: teamId || certData!.teamId,
      CAPGO_IOS_DISTRIBUTION: 'app_store',
    })

    await deleteProgress(appId)
    addLog('✔ Credentials saved')
  }

  // ── Async step handlers ──

  useEffect(() => {
    let cancelled = false

    if (step === 'welcome') {
      setTimeout(() => { if (!cancelled) setStep('platform-select') }, 800)
    }

    if (step === 'backing-up') {
      ;(async () => {
        const credPath = join(homedir(), '.capgo-credentials', 'credentials.json')
        const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const backupPath = join(homedir(), '.capgo-credentials', `credentials-${date}.copy.json`)
        try {
          await copyFile(credPath, backupPath)
          if (cancelled) return
          addLog(`✔ Backup saved · ${backupPath}`)
        }
        catch {
          if (cancelled) return
          addLog('⚠ Could not backup credentials (file may not exist yet)', 'yellow')
        }
        setStep('api-key-instructions')
      })()
    }

    if (step === 'platform-select') {
      // Check if ios/ exists — if not, skip Select and go straight to error
      if (!existsSync(join(process.cwd(), 'ios'))) {
        setStep('no-platform')
      }
    }

    if (step === 'no-platform') {
      setTimeout(() => {
        if (!cancelled)
          exit()
      }, 2000)
    }

    if (step === 'p8-method-select' && !pickerOpenedRef.current) {
      pickerOpenedRef.current = true
      ;(async () => {
        try {
          const selected = await openFilePicker()
          if (cancelled)
            return
          if (selected) {
            const content = await readFile(selected, 'utf-8')
            if (cancelled)
              return
            setP8Path(selected)
            setP8Content(content)
            const extracted = extractKeyIdFromPath(selected)
            if (extracted)
              setKeyId(extracted)
            addLog(`✔ Key file selected · ${selected}`)
            void savePartialProgress({ p8Path: selected })
            setStep('input-key-id')
          }
          else {
            // User cancelled picker — fall back to manual
            setStep('input-p8-path')
          }
        }
        catch (err) {
          if (cancelled)
            return
          setError(`Could not read file: ${err instanceof Error ? err.message : String(err)}`)
          setRetryStep('api-key-instructions')
          setStep('error')
        }
      })()
    }

    if (step === 'verifying-key') {
      ;(async () => {
        try {
          const token = await getFreshToken()
          const verifyResult = await verifyApiKey(token)
          if (cancelled)
            return
          if (verifyResult.teamId)
            setTeamId(verifyResult.teamId)
          const apiKeyData: ApiKeyData = { keyId: keyIdRef.current, issuerId: issuerIdRef.current }
          const progress: OnboardingProgress = {
            platform: 'ios',
            appId,
            p8Path: p8PathRef.current,
            startedAt: new Date().toISOString(),
            completedSteps: { apiKeyVerified: apiKeyData },
          }
          await saveProgress(appId, progress)
          addLog(`✔ API Key verified — Key: ${keyId}`)
          setRetryCount(0)
          setStep('creating-certificate')
        }
        catch (err) {
          if (!cancelled)
            handleError(err, 'verifying-key')
        }
      })()
    }

    if (step === 'creating-certificate') {
      ;(async () => {
        try {
          const token = await getFreshToken()
          const { csrPem, privateKeyPem } = generateCsr()
          // Save private key to progress in case of crash
          const existing = await loadProgress(appId)
          if (existing) {
            existing._privateKeyPem = privateKeyPem
            await saveProgress(appId, existing)
          }
          const cert = await createCertificate(token, csrPem)
          if (cancelled)
            return
          const { p12Base64 } = createP12(cert.certificateContent, privateKeyPem)
          const certResult: CertificateData = {
            certificateId: cert.certificateId,
            expirationDate: cert.expirationDate,
            teamId: cert.teamId,
            p12Base64,
          }
          setCertData(certResult)
          if (cert.teamId)
            setTeamId(cert.teamId)
          // Update progress: save cert data, wipe private key
          const progress = await loadProgress(appId)
          if (progress) {
            progress.completedSteps.certificateCreated = certResult
            delete progress._privateKeyPem
            await saveProgress(appId, progress)
          }
          addLog(`✔ Distribution certificate created — Expires ${cert.expirationDate}`)
          setRetryCount(0)
          setStep('creating-profile')
        }
        catch (err) {
          if (cancelled)
            return
          if (err instanceof CertificateLimitError) {
            setExistingCerts(err.certificates)
            setStep('cert-limit-prompt')
          }
          else {
            handleError(err, 'creating-certificate')
          }
        }
      })()
    }

    if (step === 'revoking-certificate') {
      ;(async () => {
        try {
          if (!certToRevoke)
            return
          const token = await getFreshToken()
          await revokeCertificate(token, certToRevoke)
          if (cancelled)
            return
          addLog('✔ Old certificate revoked')
          setCertToRevoke(null)
          setExistingCerts([])
          // Retry creating
          setStep('creating-certificate')
        }
        catch (err) {
          if (!cancelled)
            handleError(err, 'creating-certificate')
        }
      })()
    }

    if (step === 'creating-profile') {
      ;(async () => {
        try {
          const token = await getFreshToken()
          const { bundleIdResourceId } = await ensureBundleId(token, appId)
          const profile = await createProfile(token, bundleIdResourceId, certData!.certificateId, appId)
          if (cancelled)
            return
          const profileResult: ProfileData = {
            profileId: profile.profileId,
            profileName: profile.profileName,
            profileBase64: profile.profileContent,
          }
          setProfileData(profileResult)
          // Update progress
          const progress = await loadProgress(appId)
          if (progress) {
            progress.completedSteps.profileCreated = profileResult
            await saveProgress(appId, progress)
          }
          addLog(`✔ Provisioning profile created — "${profile.profileName}"`)
          setRetryCount(0)
          setStep('saving-credentials')
        }
        catch (err) {
          if (cancelled)
            return
          if (err instanceof DuplicateProfileError) {
            setDuplicateProfiles(err.profiles)
            setStep('duplicate-profile-prompt')
          }
          else {
            handleError(err, 'creating-profile')
          }
        }
      })()
    }

    if (step === 'deleting-duplicate-profiles') {
      ;(async () => {
        try {
          const token = await getFreshToken()
          // Delete all duplicate profiles
          for (const profile of duplicateProfiles) {
            await deleteProfile(token, profile.id)
          }
          if (cancelled)
            return
          addLog(`✔ Removed ${duplicateProfiles.length} old profile(s)`)
          setDuplicateProfiles([])
          // Retry creating the profile
          setStep('creating-profile')
        }
        catch (err) {
          if (!cancelled)
            handleError(err, 'creating-profile')
        }
      })()
    }

    if (step === 'saving-credentials') {
      ;(async () => {
        try {
          await doSaveCredentials()
          if (cancelled)
            return
          setStep('ask-build')
        }
        catch (err) {
          if (!cancelled)
            handleError(err, 'saving-credentials')
        }
      })()
    }

    if (step === 'requesting-build') {
      ;(async () => {
        try {
          let capgoKey: string | undefined
          try {
            capgoKey = findSavedKey(true)
          }
          catch {
            // No key found
          }
          if (!capgoKey) {
            setBuildOutput(prev => [...prev, '⚠ No Capgo API key found.'])
            setBuildOutput(prev => [...prev, 'Run `capgo login` first, then `capgo build request`.'])
            setStep('build-complete')
            return
          }

          // Use BuildLogger callbacks — no stdout/stderr interception needed
          const buildLogger: BuildLogger = {
            info: (msg: string) => setBuildOutput(prev => [...prev, msg]),
            error: (msg: string) => setBuildOutput(prev => [...prev, `✖ ${msg}`]),
            warn: (msg: string) => setBuildOutput(prev => [...prev, `⚠ ${msg}`]),
            success: (msg: string) => setBuildOutput(prev => [...prev, `✔ ${msg}`]),
            buildLog: (msg: string) => setBuildOutput(prev => [...prev, msg]),
            uploadProgress: (percent: number) => {
              setBuildOutput((prev) => {
                const uploadLineIdx = prev.findIndex(l => l.startsWith('Uploading:'))
                const line = `Uploading: ${percent.toFixed(0)}%`
                if (uploadLineIdx >= 0) {
                  const next = [...prev]
                  next[uploadLineIdx] = line
                  return next
                }
                return [...prev, line]
              })
            },
          }

          setBuildOutput([`Requesting build for ${appId} (ios)...`])
          const result = await requestBuildInternal(appId, {
            platform: 'ios',
            apikey: capgoKey,
          }, true, buildLogger) // silent=true, use our logger
          if (cancelled)
            return
          if (result.success) {
            const url = `https://capgo.app/app/${appId}/builds`
            setBuildUrl(url)
            setBuildOutput(prev => [...prev, '', `✔ Build queued — ${url}`])
          }
          else {
            setBuildOutput(prev => [...prev, `⚠ ${result.error || 'unknown error'}`])
          }
          setStep('build-complete')
        }
        catch (err) {
          // Build failure is non-fatal — credentials are saved
          if (!cancelled) {
            setBuildOutput(prev => [...prev, `⚠ ${err instanceof Error ? err.message : String(err)}`])
            setBuildOutput(prev => [...prev, 'Your credentials are saved. Run `npx @capgo/cli@latest build request --platform ios` to try again.'])
            setStep('build-complete')
          }
        }
      })()
    }

    if (step === 'build-complete') {
      setBuildOutput([])
      // Exit immediately after rendering the final screen
      const timer = setTimeout(() => {
        if (!cancelled)
          exit()
      }, 100)
      return () => { cancelled = true; clearTimeout(timer) }
    }

    return () => { cancelled = true }
  }, [step])

  // ── Render ──

  const progress = STEP_PROGRESS[step] ?? 0
  const phaseLabel = getPhaseLabel(step)
  const showProgress = step !== 'welcome' && step !== 'platform-select' && step !== 'error' && step !== 'build-complete' && step !== 'requesting-build'
  const showHeader = step !== 'requesting-build'
  const showLog = step !== 'requesting-build' && step !== 'build-complete'

  return (
    <Box flexDirection="column" padding={1}>
      {showHeader && <Header />}

      {/* Progress bar */}
      {showProgress && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">{phaseLabel}</Text>
          <Box marginTop={1}>
            <ProgressBar value={progress} />
            <Text dimColor> {progress}%</Text>
          </Box>
          <Divider />
        </Box>
      )}

      {/* Completed steps log */}
      {showLog && log.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {log.map((entry, i) => (
            <Text key={i} color={entry.color as any}>{entry.text}</Text>
          ))}
        </Box>
      )}

      {/* Welcome */}
      {step === 'welcome' && (
        <Box marginTop={1} justifyContent="center">
          <SpinnerLine text="Detecting project..." />
        </Box>
      )}

      {/* Platform select */}
      {step === 'platform-select' && (
        <Box flexDirection="column" marginTop={1}>
          <SuccessLine text="Detected Capacitor project" detail={appId} />
          <Newline />
          <Text bold>Which platform do you want to set up?</Text>
          <Newline />
          <Select
            options={[
              { label: '  iOS', value: 'ios' },
            ]}
            onChange={async () => {
              // Check for existing credentials before proceeding
              const existing = await loadSavedCredentials(appId)
              if (existing?.ios) {
                setStep('credentials-exist')
              }
              else {
                setStep('api-key-instructions')
              }
            }}
          />
          <Newline />
          <Text dimColor>Android onboarding coming soon. Use <Text bold color="white">capgo build credentials save</Text> for Android.</Text>
        </Box>
      )}

      {/* No platform directory */}
      {step === 'no-platform' && (
        <Box flexDirection="column" marginTop={1}>
          <ErrorLine text="No ios/ directory found." />
          <Newline />
          <Text>Run <Text bold color="white">npx cap add ios</Text> first, then re-run onboarding.</Text>
        </Box>
      )}

      {/* Existing credentials warning */}
      {step === 'credentials-exist' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">⚠ iOS credentials already exist for {appId}</Text>
          <Newline />
          <Text>Onboarding will create new certificates and profiles, replacing your existing credentials.</Text>
          <Newline />
          <Select
            options={[
              { label: '📦  Start fresh (backup existing credentials first)', value: 'backup' },
              { label: '✖  Exit onboarding', value: 'exit' },
            ]}
            onChange={(value) => {
              if (value === 'backup') {
                setStep('backing-up')
              }
              else {
                process.stderr.write('\nExiting onboarding.\n')
                process.exit(0)
              }
            }}
          />
        </Box>
      )}

      {/* Backing up credentials */}
      {step === 'backing-up' && (
        <Box flexDirection="column" marginTop={1}>
          <SpinnerLine text="Backing up existing credentials..." />
        </Box>
      )}

      {/* API key instructions + .p8 input */}
      {step === 'api-key-instructions' && (
        <Box flexDirection="column" marginTop={1}>
          <Alert variant="info">
            We need an App Store Connect API key to manage certificates and profiles for you.
          </Alert>
          <Newline />
          <Box flexDirection="column" marginLeft={2}>
            <Text><Text bold color="white">1.</Text> Go to <Text color="cyan" underline>appstoreconnect.apple.com/access/integrations/api</Text></Text>
            <Text><Text bold color="white">2.</Text> Click <Text bold>"Generate API Key"</Text></Text>
            <Text><Text bold color="white">3.</Text> Name it <Text color="yellow">"Capgo Builder"</Text> · Access: <Text bold color="green">"Admin"</Text></Text>
            <Text><Text bold color="white">4.</Text> Download the <Text bold>.p8</Text> file</Text>
          </Box>
          <Newline />
          <Box>
            <Text dimColor>Press </Text>
            <Text bold color="white">Ctrl+O</Text>
            <Text dimColor> to open App Store Connect in your browser</Text>
          </Box>
          <Newline />
          <Divider />
          <Newline />
          {canUseFilePicker() && (
            <>
              <Text bold>How do you want to provide the .p8 file?</Text>
              <Newline />
              <Select
                options={[
                  { label: '📂  Open file picker', value: 'picker' },
                  { label: '📝  Type the path', value: 'manual' },
                ]}
                onChange={(value) => {
                  if (value === 'picker') {
                    setStep('p8-method-select')
                  }
                  else {
                    setStep('input-p8-path')
                  }
                }}
              />
            </>
          )}
          {!canUseFilePicker() && (
            <>
              <Text bold>Path to your .p8 file:</Text>
              <Box marginTop={1}>
                <FilteredTextInput
                  placeholder="~/Downloads/AuthKey_XXXXXXXXXX.p8"
                  onSubmit={async (value) => {
                    const filePath = value.replace(/^~/, process.env.HOME || '')
                    try {
                      const content = await readFile(filePath, 'utf-8')
                      setP8Path(filePath)
                      setP8Content(content)
                      const extracted = extractKeyIdFromPath(filePath)
                      if (extracted)
                        setKeyId(extracted)
                      addLog(`✔ Key file found · ${filePath}`)
                      void savePartialProgress({ p8Path: filePath })
                      setStep('input-key-id')
                    }
                    catch {
                      setError(`File not found: ${filePath}`)
                      setRetryStep('api-key-instructions')
                      setStep('error')
                    }
                  }}
                />
              </Box>
            </>
          )}
        </Box>
      )}

      {/* File picker opening */}
      {step === 'p8-method-select' && (
        <Box flexDirection="column" marginTop={1}>
          <SpinnerLine text="Opening file picker..." />
        </Box>
      )}

      {/* Manual .p8 path input */}
      {step === 'input-p8-path' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Path to your .p8 file:</Text>
          <Box marginTop={1}>
            <FilteredTextInput
              placeholder="~/Downloads/AuthKey_XXXXXXXXXX.p8"
              onSubmit={async (value) => {
                const filePath = value.replace(/^~/, process.env.HOME || '')
                try {
                  const content = await readFile(filePath, 'utf-8')
                  setP8Path(filePath)
                  setP8Content(content)
                  const extracted = extractKeyIdFromPath(filePath)
                  if (extracted)
                    setKeyId(extracted)
                  addLog(`✔ Key file found · ${filePath}`)
                  void savePartialProgress({ p8Path: filePath })
                  setStep('input-key-id')
                }
                catch {
                  setError(`File not found: ${value}`)
                  setRetryStep('input-p8-path')
                  setStep('error')
                }
              }}
            />
          </Box>
        </Box>
      )}

      {/* Key ID */}
      {step === 'input-key-id' && (
        <Box flexDirection="column" marginTop={1}>
          {keyId
            ? (
              <>
                <Text bold>Key ID <Text dimColor>(detected from filename)</Text>:</Text>
                <Box marginTop={1}>
                  <Text color="green">✔ </Text>
                  <Text>{keyId}</Text>
                  <Text dimColor> — press Enter to confirm, or type a different one</Text>
                </Box>
                <Box marginTop={1}>
                  <Text color="cyan">❯ </Text>
                  <FilteredTextInput
                    placeholder={keyId}
                    onSubmit={(value) => {
                      const finalKeyId = (value || keyId).trim()
                      setKeyId(finalKeyId)
                      addLog(`✔ Key ID · ${finalKeyId}`)
                      void savePartialProgress({ keyId: finalKeyId })
                      setStep('input-issuer-id')
                    }}
                  />
                </Box>
              </>
              )
            : (
              <>
                <Text bold>Key ID <Text dimColor>(shown next to the key name in App Store Connect)</Text>:</Text>
                <Box marginTop={1}>
                  <Text color="cyan">❯ </Text>
                  <FilteredTextInput
                    placeholder="ABC123DEF"
                    onSubmit={(value) => {
                      const cleaned = value.trim()
                      if (!cleaned) return
                      setKeyId(cleaned)
                      addLog(`✔ Key ID · ${cleaned}`)
                      void savePartialProgress({ keyId: cleaned })
                      setStep('input-issuer-id')
                    }}
                  />
                </Box>
              </>
              )}
        </Box>
      )}

      {/* Issuer ID */}
      {step === 'input-issuer-id' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Issuer ID <Text dimColor>(UUID at the very top of the API keys page, above the key list)</Text>:</Text>
          <Newline />
          <Box>
            <Text dimColor>Press </Text>
            <Text bold color="white">Ctrl+O</Text>
            <Text dimColor> to open App Store Connect in your browser</Text>
          </Box>
          <Box marginTop={1}>
            <FilteredTextInput
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              onSubmit={(value) => {
                const cleaned = value.trim()
                if (!cleaned) return
                setIssuerId(cleaned)
                addLog(`✔ Issuer ID · ${cleaned}`)
                void savePartialProgress({ issuerId: cleaned })
                setStep('verifying-key')
              }}
            />
          </Box>
        </Box>
      )}

      {/* Verifying */}
      {step === 'verifying-key' && (
        <Box flexDirection="column" marginTop={1}>
          <SpinnerLine text="Verifying API key with Apple..." />
        </Box>
      )}

      {/* Creating certificate */}
      {step === 'creating-certificate' && (
        <Box flexDirection="column" marginTop={1}>
          <SpinnerLine text="Generating signing key and CSR..." />
          <SpinnerLine text="Creating iOS distribution certificate..." />
        </Box>
      )}

      {/* Certificate limit — ask which to revoke */}
      {step === 'cert-limit-prompt' && (
        <Box flexDirection="column" marginTop={1}>
          <ErrorLine text={`iOS distribution certificate limit reached (${existingCerts.length} existing).`} />
          <Newline />
          <Text bold>Select a certificate to revoke:</Text>
          <Newline />
          <Select
            options={[
              ...existingCerts.map(c => {
                const ourCertId = certData?.certificateId || initialProgress?.completedSteps.certificateCreated?.certificateId
                const isOurs = ourCertId === c.id
                const creator = isOurs ? ' · 🔧 Created by Capgo' : ''
                return {
                  label: `🗑️   ${c.name} · expires ${c.expirationDate.split('T')[0]}${creator}`,
                  value: c.id,
                }
              }),
              { label: '✖  Exit onboarding', value: '__exit__' },
            ]}
            onChange={(value) => {
              if (value === '__exit__') {
                process.stderr.write('\nExiting. Revoke a certificate manually, then re-run onboarding.\n')
                process.exit(0)
              }
              else {
                setCertToRevoke(value)
                setStep('revoking-certificate')
              }
            }}
          />
        </Box>
      )}

      {/* Revoking certificate */}
      {step === 'revoking-certificate' && (
        <Box flexDirection="column" marginTop={1}>
          <SpinnerLine text="Revoking old certificate..." />
        </Box>
      )}

      {/* Creating profile */}
      {step === 'creating-profile' && (
        <Box flexDirection="column" marginTop={1}>
          <SuccessLine text="Bundle ID" detail={appId} />
          <Newline />
          <SpinnerLine text="Creating App Store provisioning profile..." />
        </Box>
      )}

      {/* Duplicate profile prompt */}
      {step === 'duplicate-profile-prompt' && (
        <Box flexDirection="column" marginTop={1}>
          <ErrorLine text={`Found ${duplicateProfiles.length} existing Capgo profile(s) for this app.`} />
          <Newline />
          <Text bold>Delete old profiles and create a new one?</Text>
          <Newline />
          <Select
            options={[
              { label: '✔  Yes, delete old profiles and recreate', value: 'delete' },
              { label: '✖  No, exit onboarding', value: 'exit' },
            ]}
            onChange={(value) => {
              if (value === 'delete') {
                setStep('deleting-duplicate-profiles')
              }
              else {
                process.stderr.write('\nExiting. Delete duplicate profiles manually in the Apple Developer Portal, then re-run onboarding.\n')
                process.exit(0)
              }
            }}
          />
        </Box>
      )}

      {/* Deleting duplicate profiles */}
      {step === 'deleting-duplicate-profiles' && (
        <Box flexDirection="column" marginTop={1}>
          <SpinnerLine text={`Deleting ${duplicateProfiles.length} old profile(s)...`} />
        </Box>
      )}

      {/* Saving credentials */}
      {step === 'saving-credentials' && (
        <Box flexDirection="column" marginTop={1}>
          <SpinnerLine text="Saving credentials..." />
        </Box>
      )}

      {/* Ask to build */}
      {step === 'ask-build' && (
        <Box flexDirection="column" marginTop={1}>
          <SuccessLine text="Credentials saved" />
          <Newline />
          <Text bold>Start your first cloud build now?</Text>
          <Newline />
          <Select
            options={[
              { label: '🚀  Yes, build now', value: 'yes' },
              { label: '⏭️   No, I\'ll build later', value: 'no' },
            ]}
            onChange={(value) => {
              if (value === 'yes') {
                setStep('requesting-build')
              }
              else {
                setStep('build-complete')
              }
            }}
          />
        </Box>
      )}

      {/* Requesting build — live output fills terminal, spinner at bottom */}
      {step === 'requesting-build' && (() => {
        // 3 lines overhead: 1 divider + 1 spinner + 1 padding
        const visibleLines = Math.max(5, terminalRows - 3)
        return (
        <Box flexDirection="column" marginTop={1}>
          {buildOutput.slice(-visibleLines).map((line, i) => {
            const isSuccess = line.startsWith('✔')
            const isError = line.startsWith('✖') || line.startsWith('❌')
            const isWarn = line.startsWith('⚠')
            const isBold = line.startsWith('✔ Build') || line.startsWith('✔ Created') || line.startsWith('Uploading:')
            const color = isSuccess ? 'green' : isError ? 'red' : isWarn ? 'yellow' : undefined
            return (
              <Text key={i} color={color} dimColor={!color && !isBold} bold={isBold}>
                {line}
              </Text>
            )
          })}
          <Divider />
          <Box>
            <SpinnerLine text="Building..." />
            <Text dimColor>  ({buildOutput.length} lines)</Text>
          </Box>
        </Box>
        )
      })()}

      {/* Error with retry */}
      {step === 'error' && error && (
        <Box flexDirection="column" marginTop={1}>
          <ErrorLine text={error} />
          <Newline />
          {retryCount <= 1 && retryStep && (
            <>
              <Text bold>What do you want to do?</Text>
              <Newline />
              <Select
                options={[
                  { label: '🔄  Try again', value: 'retry' },
                  { label: '↩️   Restart onboarding', value: 'restart' },
                  { label: '❌  Exit', value: 'exit' },
                ]}
                onChange={(value) => {
                  if (value === 'retry') {
                    setError(null)
                    pickerOpenedRef.current = false
                    setStep(retryStep)
                  }
                  else if (value === 'restart') {
                    setError(null)
                    setRetryCount(0)
                    pickerOpenedRef.current = false
                    setStep('welcome')
                  }
                  else {
                    console.error('\n  Run `capgo build onboarding` to resume.\n')
                    process.exit(1)
                  }
                }}
              />
            </>
          )}
        </Box>
      )}

      {/* Done */}
      {step === 'build-complete' && (
        <Box flexDirection="column" marginTop={1}>
          <Newline />
          <Box
            borderStyle="round"
            borderColor="green"
            paddingX={3}
            paddingY={1}
            flexDirection="column"
            alignItems="center"
          >
            <Text bold color="green">
              🎉  You're all set!
            </Text>
            <Newline />
            <Text>Your iOS app is building in the cloud.</Text>
            {buildUrl && (
              <Text>Track it at <Text color="cyan" underline>{buildUrl}</Text></Text>
            )}
            <Newline />
            <Text dimColor>
              Run <Text bold color="white">npx @capgo/cli@latest build request --platform ios</Text> anytime for future builds.
            </Text>
          </Box>
          <Newline />
        </Box>
      )}
    </Box>
  )
}

export default OnboardingApp
