// src/styles/comparisonTheme.ts
//
// Design tokens for the artwork comparison screen (light theme, built for
// a graphic designer reviewing two PDF versions side by side). Replaces
// the previous dark-theme tokens that lived inline in ComparisonViewer.tsx.
// Contrast ratios below are checked against the backgrounds they're
// actually used on (white #FFFFFF or #FAFAF8).

export const theme = {
  // Text
  text:          '#1B1B1A', // ~16.5:1 on white
  textSecondary: '#5C5B57', // ~5.1:1 on white — meets the 4.5:1 minimum

  // Surfaces
  surface:     '#FFFFFF',
  surfaceAlt:  '#FAFAF8',
  border:      '#E2E0DA',

  // Change highlight (orange) — translucent + mix-blend-mode: multiply so the
  // PDF text underneath stays readable instead of being covered by the box.
  highlight:          '#C25E00', // marker/outline colour
  highlightFillLight: 'rgba(255,170,0,.22)', // unselected highlight fill
  highlightFillSel:   'rgba(255,170,0,.32)', // selected highlight fill
  highlightChipBg:    '#FFF1D6',
  highlightChipText:  '#7A4A00', // ~5.6:1 on #FFF1D6

  // Visual-type chip (blue)
  visualChipBg:   '#E3ECFF',
  visualChipText: '#1D3FA8', // ~6.3:1 on #E3ECFF

  // Primary action
  accent: '#2447C5', // ~6.2:1 on white

  // Accept / reject
  accept:     '#146C43', // ~5.3:1 on white
  acceptBg:   '#E3F4EA',
  reject:     '#B42318', // ~6.1:1 on white
  rejectBg:   '#FDECEA',

  // Page thumbnail strip
  thumbStripBg:     '#DDE5FB',
  thumbStripBorder: '#B6C4F0',

  // Workspace background behind the PDFs
  workspaceGradient: 'linear-gradient(135deg, #1F3FB5 0%, #3B5FD9 45%, #F28C28 100%)',

  // Status colours (diff card status pill)
  statusPending:  '#5C5B57',
  statusAccepted: '#146C43',
  statusRejected: '#B42318',

  fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const

// Minimum interactive target size (WCAG 2.5.5 AAA-ish guidance), used for
// the primary action buttons (Accept, Reject, Previous, Next, Complete).
export const MIN_TOUCH_TARGET = 44

// Class name applied to every focusable control on this screen. The
// actual :focus-visible rule is injected once as a real stylesheet rule
// (see injectComparisonGlobalStyles) — inline React styles can't target a
// pseudo-class, so a class + injected <style> is the only way to get a
// real keyboard-focus ring without a CSS file.
export const FOCUSABLE_CLASS = 'cv-focusable'

export function injectComparisonGlobalStyles(): void {
  const id = 'cv-global-styles'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    .${FOCUSABLE_CLASS} { outline: none; }
    .${FOCUSABLE_CLASS}:focus-visible {
      outline: 3px solid ${theme.accent};
      outline-offset: 2px;
    }
    @keyframes starPulse {
      0%   { transform: translateY(-50%) scale(1.0) rotate(0deg);   opacity: 1;   }
      25%  { transform: translateY(-50%) scale(1.4) rotate(45deg);  opacity: 0.8; }
      50%  { transform: translateY(-50%) scale(1.0) rotate(90deg);  opacity: 1;   }
      75%  { transform: translateY(-50%) scale(1.3) rotate(135deg); opacity: 0.8; }
      100% { transform: translateY(-50%) scale(1.0) rotate(180deg); opacity: 1;   }
    }
  `
  document.head.appendChild(style)
}
