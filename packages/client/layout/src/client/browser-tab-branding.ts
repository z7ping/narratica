/**
 * Browser-tab branding belongs to the active Narratica main panel, not the DSH host.
 * The host owns DocumentTitle and its favicon outside this panel.
 */
const NARRATICA_TAB_TITLE = 'Narratica'

interface IconSnapshot {
  icon: HTMLLinkElement
  href: string | null
  type: string | null
  sizes: string | null
}

function restoreAttribute(element: HTMLLinkElement, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

/** Scope the approved icon/title to Narratica's mounted workspace and restore DSH on exit. */
export function activateNarraticaBrowserTab(iconUrl: string): () => void {
  const hostTitle = document.title
  const hostIcons = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
  const snapshots: IconSnapshot[] = hostIcons.map(icon => ({
    icon,
    href: icon.getAttribute('href'),
    type: icon.getAttribute('type'),
    sizes: icon.getAttribute('sizes'),
  }))

  // Avoid a permanent host favicon change. Most DSH pages already provide one.
  const ownedIcon = hostIcons.length === 0 ? document.createElement('link') : undefined
  if (ownedIcon !== undefined) {
    ownedIcon.setAttribute('rel', 'icon')
    document.head.appendChild(ownedIcon)
  }
  for (const icon of ownedIcon === undefined ? hostIcons : [ownedIcon]) {
    icon.setAttribute('href', iconUrl)
    icon.setAttribute('type', 'image/svg+xml')
    icon.removeAttribute('sizes')
  }

  // DSH's DocumentTitle effect may run after panel activation; preserve the panel title.
  const syncTitle = (): void => {
    if (document.title !== NARRATICA_TAB_TITLE) document.title = NARRATICA_TAB_TITLE
  }
  const observer = new MutationObserver(syncTitle)
  observer.observe(document.head, { childList: true, characterData: true, subtree: true })
  syncTitle()

  return () => {
    observer.disconnect()
    for (const { icon, href, type, sizes } of snapshots) {
      restoreAttribute(icon, 'href', href)
      restoreAttribute(icon, 'type', type)
      restoreAttribute(icon, 'sizes', sizes)
    }
    ownedIcon?.remove()
    // DSH's DocumentTitle effect resumes authoritative updates after panel navigation.
    document.title = hostTitle
  }
}
