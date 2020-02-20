import { ipcRendererInternal } from '@electron/internal/renderer/ipc-renderer-internal'

// This file implements the following APIs:
// - window.history.back()
// - window.history.forward()
// - window.history.go()
// - window.history.length
// - window.open()
// - window.opener.blur()
// - window.opener.close()
// - window.opener.eval()
// - window.opener.focus()
// - window.opener.location
// - window.opener.print()
// - window.opener.postMessage()
// - window.prompt()
// - document.hidden
// - document.visibilityState

const { defineProperty } = Object

// Helper function to resolve relative url.
const a = window.document.createElement('a')
const resolveURL = function (url: string) {
  a.href = url
  return a.href
}

// Use this method to ensure values expected as strings in the main process
// are convertible to strings in the renderer process. This ensures exceptions
// converting values to strings are thrown in this process.
const toString = (value: any) => {
  return value != null ? `${value}` : value
}

const windowProxies: Record<number, BrowserWindowProxy> = {}

const getOrCreateProxy = (guestId: number) => {
  let proxy = windowProxies[guestId]
  if (proxy == null) {
    proxy = new BrowserWindowProxy(guestId)
    windowProxies[guestId] = proxy
  }
  return proxy
}

const removeProxy = (guestId: number) => {
  delete windowProxies[guestId]
}

type LocationProperties = 'hash' | 'href' | 'host' | 'hostname' | 'origin' | 'pathname' | 'port' | 'protocol' | 'search'

class LocationProxy {
  @LocationProxy.ProxyProperty public hash!: string;
  @LocationProxy.ProxyProperty public href!: string;
  @LocationProxy.ProxyProperty public host!: string;
  @LocationProxy.ProxyProperty public hostname!: string;
  @LocationProxy.ProxyProperty public origin!: string;
  @LocationProxy.ProxyProperty public pathname!: string;
  @LocationProxy.ProxyProperty public port!: string;
  @LocationProxy.ProxyProperty public protocol!: string;
  @LocationProxy.ProxyProperty public search!: URLSearchParams;

  private guestId: number;

  /**
   * Beware: This decorator will have the _prototype_ as the `target`. It defines properties
   * commonly found in URL on the LocationProxy.
   */
  private static ProxyProperty<T> (target: LocationProxy, propertyKey: LocationProperties) {
    Object.defineProperty(target, propertyKey, {
      get: function (this: LocationProxy): T | string {
        const guestURL = this.getGuestURL()
        const value = guestURL ? guestURL[propertyKey] : ''
        return value === undefined ? '' : value
      },
      set: function (this: LocationProxy, newVal: T) {
        const guestURL = this.getGuestURL()
        if (guestURL) {
          // TypeScript doesn't want us to assign to read-only variables.
          // It's right, that's bad, but we're doing it anway.
          (guestURL as any)[propertyKey] = newVal

          return ipcRendererInternal.sendSync(
            'ELECTRON_GUEST_WINDOW_MANAGER_WEB_CONTENTS_METHOD_SYNC',
            this.guestId, 'loadURL', guestURL.toString())
        }
      }
    })
  }

  constructor (guestId: number) {
    // eslint will consider the constructor "useless"
    // unless we assign them in the body. It's fine, that's what
    // TS would do anyway.
    this.guestId = guestId
    this.getGuestURL = this.getGuestURL.bind(this)
  }

  public toString (): string {
    return this.href
  }

  private getGuestURL (): URL | null {
    const urlString = ipcRendererInternal.sendSync('ELECTRON_GUEST_WINDOW_MANAGER_WEB_CONTENTS_METHOD_SYNC', this.guestId, 'getURL')
    try {
      return new URL(urlString)
    } catch (e) {
      console.error('LocationProxy: failed to parse string', urlString, e)
    }

    return null
  }
}

class BrowserWindowProxy {
  public closed: boolean = false

  private _location: LocationProxy
  private guestId: number

  // TypeScript doesn't allow getters/accessors with different types,
  // so for now, we'll have to make do with an "any" in the mix.
  // https://github.com/Microsoft/TypeScript/issues/2521
  public get location (): LocationProxy | any {
    return this._location
  }
  public set location (url: string | any) {
    url = resolveURL(url)
    ipcRendererInternal.sendSync('ELECTRON_GUEST_WINDOW_MANAGER_WEB_CONTENTS_METHOD_SYNC', this.guestId, 'loadURL', url)
  }

  constructor (guestId: number) {
    this.guestId = guestId
    this._location = new LocationProxy(guestId)

    ipcRendererInternal.once(`ELECTRON_GUEST_WINDOW_MANAGER_WINDOW_CLOSED_${guestId}`, () => {
      removeProxy(guestId)
      this.closed = true
    })
  }

  public close () {
    ipcRendererInternal.send('ELECTRON_GUEST_WINDOW_MANAGER_WINDOW_CLOSE', this.guestId)
  }

  public focus () {
    ipcRendererInternal.send('ELECTRON_GUEST_WINDOW_MANAGER_WINDOW_METHOD', this.guestId, 'focus')
  }

  public blur () {
    ipcRendererInternal.send('ELECTRON_GUEST_WINDOW_MANAGER_WINDOW_METHOD', this.guestId, 'blur')
  }

  public print () {
    ipcRendererInternal.send('ELECTRON_GUEST_WINDOW_MANAGER_WEB_CONTENTS_METHOD', this.guestId, 'print')
  }

  public postMessage (message: any, targetOrigin: any) {
    ipcRendererInternal.send('ELECTRON_GUEST_WINDOW_MANAGER_WINDOW_POSTMESSAGE', this.guestId, message, toString(targetOrigin), window.location.origin)
  }

  public eval (...args: any[]) {
    ipcRendererInternal.send('ELECTRON_GUEST_WINDOW_MANAGER_WEB_CONTENTS_METHOD', this.guestId, 'executeJavaScript', ...args)
  }
}

export const windowSetup = (
  guestInstanceId: number, openerId: number, isHiddenPage: boolean, usesNativeWindowOpen: boolean
) => {
  if (!process.sandboxed && guestInstanceId == null) {
    // Override default window.close.
    window.close = function () {
      ipcRendererInternal.sendSync('ELECTRON_BROWSER_WINDOW_CLOSE')
    }
  }

  if (!usesNativeWindowOpen) {
    // Make the browser window or guest view emit "new-window" event.
    (window as any).open = function (url?: string, frameName?: string, features?: string) {
      if (url != null && url !== '') {
        url = resolveURL(url)
      }
      const guestId = ipcRendererInternal.sendSync('ELECTRON_GUEST_WINDOW_MANAGER_WINDOW_OPEN', url, toString(frameName), toString(features))
      if (guestId != null) {
        return getOrCreateProxy(guestId)
      } else {
        return null
      }
    }
  }

  if (openerId != null) {
    window.opener = getOrCreateProxy(openerId)
  }

  // But we do not support prompt().
  window.prompt = function () {
    throw new Error('prompt() is and will not be supported.')
  }

  if (!usesNativeWindowOpen || openerId != null) {
    ipcRendererInternal.on('ELECTRON_GUEST_WINDOW_POSTMESSAGE', function (
      _event, sourceId: number, message: any, sourceOrigin: string
    ) {
      // Manually dispatch event instead of using postMessage because we also need to
      // set event.source.
      //
      // Why any? We can't construct a MessageEvent and we can't
      // use `as MessageEvent` because you're not supposed to override
      // data, origin, and source
      const event: any = document.createEvent('Event')
      event.initEvent('message', false, false)

      event.data = message
      event.origin = sourceOrigin
      event.source = getOrCreateProxy(sourceId)

      window.dispatchEvent(event as MessageEvent)
    })
  }

  if (!process.sandboxed) {
    window.history.back = function () {
      ipcRendererInternal.send('ELECTRON_NAVIGATION_CONTROLLER_GO_BACK')
    }

    window.history.forward = function () {
      ipcRendererInternal.send('ELECTRON_NAVIGATION_CONTROLLER_GO_FORWARD')
    }

    window.history.go = function (offset: number) {
      ipcRendererInternal.send('ELECTRON_NAVIGATION_CONTROLLER_GO_TO_OFFSET', +offset)
    }

    defineProperty(window.history, 'length', {
      get: function () {
        return ipcRendererInternal.sendSync('ELECTRON_NAVIGATION_CONTROLLER_LENGTH')
      }
    })
  }

  if (guestInstanceId != null) {
    // Webview `document.visibilityState` tracks window visibility (and ignores
    // the actual <webview> element visibility) for backwards compatibility.
    // See discussion in #9178.
    //
    // Note that this results in duplicate visibilitychange events (since
    // Chromium also fires them) and potentially incorrect visibility change.
    // We should reconsider this decision for Electron 2.0.
    let cachedVisibilityState = isHiddenPage ? 'hidden' : 'visible'

    // Subscribe to visibilityState changes.
    ipcRendererInternal.on('ELECTRON_GUEST_INSTANCE_VISIBILITY_CHANGE', function (_event, visibilityState: VisibilityState) {
      if (cachedVisibilityState !== visibilityState) {
        cachedVisibilityState = visibilityState
        document.dispatchEvent(new Event('visibilitychange'))
      }
    })

    // Make document.hidden and document.visibilityState return the correct value.
    defineProperty(document, 'hidden', {
      get: function () {
        return cachedVisibilityState !== 'visible'
      }
    })

    defineProperty(document, 'visibilityState', {
      get: function () {
        return cachedVisibilityState
      }
    })
  }
}
