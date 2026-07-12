import claude from '../assets/providers/claude.svg'
import cursorDark from '../assets/providers/cursor-dark.svg'
import cursorLight from '../assets/providers/cursor-light.svg'
import grokDark from '../assets/providers/grok-dark.svg'
import grokLight from '../assets/providers/grok-light.svg'
import openaiDark from '../assets/providers/openai-dark.svg'
import openaiLight from '../assets/providers/openai-light.svg'

const THEMED_LOGOS: Record<string, { light: string; dark: string }> = {
  codex: { light: openaiLight, dark: openaiDark },
  cursor: { light: cursorLight, dark: cursorDark },
  grok: { light: grokLight, dark: grokDark },
}

export function ProviderLogo({ provider, size = 16 }: { provider: string; size?: number }) {
  if (provider === 'claude') {
    return <img src={claude} width={size} height={size} alt="" aria-hidden className="provider-logo" />
  }

  const logos = THEMED_LOGOS[provider]
  if (!logos) return null

  return <>
    <img src={logos.light} width={size} height={size} alt="" aria-hidden className="provider-logo pl-light" />
    <img src={logos.dark} width={size} height={size} alt="" aria-hidden className="provider-logo pl-dark" />
  </>
}
