'use strict'

const features = process.electronBinding('features')
const { EventEmitter } = require('events')
const electron = require('electron')
const path = require('path')
const url = require('url')
const { app, ipcMain, session, deprecate } = electron

const { internalWindowOpen } = require('@electron/internal/browser/guest-window-manager')
const NavigationController = require('@electron/internal/browser/navigation-controller')
const { ipcMainInternal } = require('@electron/internal/browser/ipc-main-internal')
const ipcMainUtils = require('@electron/internal/browser/ipc-main-internal-utils')
const errorUtils = require('@electron/internal/common/error-utils')

// session is not used here, the purpose is to make sure session is initalized
// before the webContents module.
// eslint-disable-next-line
session

let nextId = 0
const getNextId = function () {
  return ++nextId
}

// Stock page sizes
const PDFPageSizes = {
  A5: {
    custom_display_name: 'A5',
    height_microns: 210000,
    name: 'ISO_A5',
    width_microns: 148000
  },
  A4: {
    custom_display_name: 'A4',
    height_microns: 297000,
    name: 'ISO_A4',
    is_default: 'true',
    width_microns: 210000
  },
  A3: {
    custom_display_name: 'A3',
    height_microns: 420000,
    name: 'ISO_A3',
    width_microns: 297000
  },
  Legal: {
    custom_display_name: 'Legal',
    height_microns: 355600,
    name: 'NA_LEGAL',
    width_microns: 215900
  },
  Letter: {
    custom_display_name: 'Letter',
    height_microns: 279400,
    name: 'NA_LETTER',
    width_microns: 215900
  },
  Tabloid: {
    height_microns: 431800,
    name: 'NA_LEDGER',
    width_microns: 279400,
    custom_display_name: 'Tabloid'
  }
}

// Default printing setting
const defaultPrintingSetting = {
  pageRage: [],
  mediaSize: {},
  landscape: false,
  color: 2,
  headerFooterEnabled: false,
  marginsType: 0,
  isFirstRequest: false,
  previewUIID: 0,
  previewModifiable: true,
  printToPDF: true,
  printWithCloudPrint: false,
  printWithPrivet: false,
  printWithExtension: false,
  pagesPerSheet: 1,
  deviceName: 'Save as PDF',
  generateDraftData: true,
  fitToPageEnabled: false,
  scaleFactor: 1,
  dpiHorizontal: 72,
  dpiVertical: 72,
  rasterizePDF: false,
  duplex: 0,
  copies: 1,
  collate: true,
  shouldPrintBackgrounds: false,
  shouldPrintSelectionOnly: false
}

// JavaScript implementations of WebContents.
const binding = process.electronBinding('web_contents')
const { WebContents } = binding

Object.setPrototypeOf(NavigationController.prototype, EventEmitter.prototype)
Object.setPrototypeOf(WebContents.prototype, NavigationController.prototype)

// WebContents::send(channel, args..)
// WebContents::sendToAll(channel, args..)
WebContents.prototype.send = function (channel, ...args) {
  if (typeof channel !== 'string') {
    throw new Error('Missing required channel argument')
  }

  const internal = false
  const sendToAll = false

  return this._send(internal, sendToAll, channel, args)
}

WebContents.prototype.sendToAll = function (channel, ...args) {
  if (typeof channel !== 'string') {
    throw new Error('Missing required channel argument')
  }

  const internal = false
  const sendToAll = true

  return this._send(internal, sendToAll, channel, args)
}

WebContents.prototype._sendInternal = function (channel, ...args) {
  if (typeof channel !== 'string') {
    throw new Error('Missing required channel argument')
  }

  const internal = true
  const sendToAll = false

  return this._send(internal, sendToAll, channel, args)
}
WebContents.prototype._sendInternalToAll = function (channel, ...args) {
  if (typeof channel !== 'string') {
    throw new Error('Missing required channel argument')
  }

  const internal = true
  const sendToAll = true

  return this._send(internal, sendToAll, channel, args)
}
WebContents.prototype.sendToFrame = function (frameId, channel, ...args) {
  if (typeof channel !== 'string') {
    throw new Error('Missing required channel argument')
  } else if (typeof frameId !== 'number') {
    throw new Error('Missing required frameId argument')
  }

  const internal = false
  const sendToAll = false

  return this._sendToFrame(internal, sendToAll, frameId, channel, args)
}
WebContents.prototype._sendToFrameInternal = function (frameId, channel, ...args) {
  if (typeof channel !== 'string') {
    throw new Error('Missing required channel argument')
  } else if (typeof frameId !== 'number') {
    throw new Error('Missing required frameId argument')
  }

  const internal = true
  const sendToAll = false

  return this._sendToFrame(internal, sendToAll, frameId, channel, args)
}

// Following methods are mapped to webFrame.
const webFrameMethods = [
  'insertCSS',
  'insertText',
  'setLayoutZoomLevelLimits',
  'setVisualZoomLevelLimits'
]

for (const method of webFrameMethods) {
  WebContents.prototype[method] = function (...args) {
    ipcMainUtils.invokeInWebContents(this, false, 'ELECTRON_INTERNAL_RENDERER_WEB_FRAME_METHOD', method, ...args)
  }
}

const executeJavaScript = (contents, code, hasUserGesture) => {
  return ipcMainUtils.invokeInWebContents(contents, false, 'ELECTRON_INTERNAL_RENDERER_WEB_FRAME_METHOD', 'executeJavaScript', code, hasUserGesture)
}

// Make sure WebContents::executeJavaScript would run the code only when the
// WebContents has been loaded.
WebContents.prototype.executeJavaScript = function (code, hasUserGesture) {
  if (this.getURL() && !this.isLoadingMainFrame()) {
    return executeJavaScript(this, code, hasUserGesture)
  } else {
    return new Promise((resolve, reject) => {
      this.once('did-stop-loading', () => {
        executeJavaScript(this, code, hasUserGesture).then(resolve, reject)
      })
    })
  }
}

// TODO(codebytere): remove when promisifications is complete
const nativeZoomLevel = WebContents.prototype.getZoomLevel
WebContents.prototype.getZoomLevel = function (callback) {
  if (callback == null) {
    return nativeZoomLevel.call(this)
  } else {
    process.nextTick(() => {
      callback(nativeZoomLevel.call(this))
    })
  }
}

// TODO(codebytere): remove when promisifications is complete
const nativeZoomFactor = WebContents.prototype.getZoomFactor
WebContents.prototype.getZoomFactor = function (callback) {
  if (callback == null) {
    return nativeZoomFactor.call(this)
  } else {
    process.nextTick(() => {
      callback(nativeZoomFactor.call(this))
    })
  }
}

WebContents.prototype.takeHeapSnapshot = function (filePath) {
  return new Promise((resolve, reject) => {
    this._takeHeapSnapshot(filePath, (success) => {
      if (success) {
        resolve()
      } else {
        reject(new Error('takeHeapSnapshot failed'))
      }
    })
  })
}

// Translate the options of printToPDF.
WebContents.prototype.printToPDF = function (options) {
  const printingSetting = {
    ...defaultPrintingSetting,
    requestID: getNextId()
  }
  if (options.landscape) {
    printingSetting.landscape = options.landscape
  }
  if (options.marginsType) {
    printingSetting.marginsType = options.marginsType
  }
  if (options.printSelectionOnly) {
    printingSetting.shouldPrintSelectionOnly = options.printSelectionOnly
  }
  if (options.printBackground) {
    printingSetting.shouldPrintBackgrounds = options.printBackground
  }

  if (options.pageSize) {
    const pageSize = options.pageSize
    if (typeof pageSize === 'object') {
      if (!pageSize.height || !pageSize.width) {
        return Promise.reject(new Error('Must define height and width for pageSize'))
      }
      // Dimensions in Microns
      // 1 meter = 10^6 microns
      printingSetting.mediaSize = {
        name: 'CUSTOM',
        custom_display_name: 'Custom',
        height_microns: Math.ceil(pageSize.height),
        width_microns: Math.ceil(pageSize.width)
      }
    } else if (PDFPageSizes[pageSize]) {
      printingSetting.mediaSize = PDFPageSizes[pageSize]
    } else {
      return Promise.reject(new Error(`Does not support pageSize with ${pageSize}`))
    }
  } else {
    printingSetting.mediaSize = PDFPageSizes['A4']
  }

  // Chromium expects this in a 0-100 range number, not as float
  printingSetting.scaleFactor *= 100
  if (features.isPrintingEnabled()) {
    return this._printToPDF(printingSetting)
  } else {
    return Promise.reject(new Error('Printing feature is disabled'))
  }
}

WebContents.prototype.print = function (...args) {
  if (features.isPrintingEnabled()) {
    this._print(...args)
  } else {
    console.error('Error: Printing feature is disabled.')
  }
}

WebContents.prototype.getPrinters = function () {
  if (features.isPrintingEnabled()) {
    return this._getPrinters()
  } else {
    console.error('Error: Printing feature is disabled.')
  }
}

WebContents.prototype.loadFile = function (filePath, options = {}) {
  if (typeof filePath !== 'string') {
    throw new Error('Must pass filePath as a string')
  }
  const { query, search, hash } = options

  return this.loadURL(url.format({
    protocol: 'file',
    slashes: true,
    pathname: path.resolve(app.getAppPath(), filePath),
    query,
    search,
    hash
  }))
}

WebContents.prototype.capturePage = deprecate.promisify(WebContents.prototype.capturePage)
WebContents.prototype.executeJavaScript = deprecate.promisify(WebContents.prototype.executeJavaScript)
WebContents.prototype.printToPDF = deprecate.promisify(WebContents.prototype.printToPDF)
WebContents.prototype.savePage = deprecate.promisify(WebContents.prototype.savePage)

const addReplyToEvent = (event) => {
  event.reply = (...args) => {
    event.sender.sendToFrame(event.frameId, ...args)
  }
}

const addReplyInternalToEvent = (event) => {
  Object.defineProperty(event, '_replyInternal', {
    configurable: false,
    enumerable: false,
    value: (...args) => {
      event.sender._sendToFrameInternal(event.frameId, ...args)
    }
  })
}

const addReturnValueToEvent = (event) => {
  Object.defineProperty(event, 'returnValue', {
    set: (value) => event.sendReply([value]),
    get: () => {}
  })
}

// Add JavaScript wrappers for WebContents class.
WebContents.prototype._init = function () {
  // The navigation controller.
  NavigationController.call(this, this)

  // Every remote callback from renderer process would add a listener to the
  // render-view-deleted event, so ignore the listeners warning.
  this.setMaxListeners(0)

  // Dispatch IPC messages to the ipc module.
  this.on('-ipc-message', function (event, internal, channel, args) {
    if (internal) {
      addReplyInternalToEvent(event)
      ipcMainInternal.emit(channel, event, ...args)
    } else {
      addReplyToEvent(event)
      this.emit('ipc-message', event, channel, ...args)
      ipcMain.emit(channel, event, ...args)
    }
  })

  this.on('-ipc-message-sync', function (event, internal, channel, args) {
    addReturnValueToEvent(event)
    if (internal) {
      addReplyInternalToEvent(event)
      ipcMainInternal.emit(channel, event, ...args)
    } else {
      addReplyToEvent(event)
      this.emit('ipc-message-sync', event, channel, ...args)
      ipcMain.emit(channel, event, ...args)
    }
  })

  // Handle context menu action request from pepper plugin.
  this.on('pepper-context-menu', function (event, params, callback) {
    // Access Menu via electron.Menu to prevent circular require.
    const menu = electron.Menu.buildFromTemplate(params.menu)
    menu.popup({
      window: event.sender.getOwnerBrowserWindow(),
      x: params.x,
      y: params.y,
      callback
    })
  })

  const forwardedEvents = [
    'desktop-capturer-get-sources',
    'remote-require',
    'remote-get-global',
    'remote-get-builtin',
    'remote-get-current-window',
    'remote-get-current-web-contents',
    'remote-get-guest-web-contents'
  ]

  for (const eventName of forwardedEvents) {
    this.on(eventName, (event, ...args) => {
      app.emit(eventName, event, this, ...args)
    })
  }

  this.on('crashed', (event, ...args) => {
    app.emit('renderer-process-crashed', event, this, ...args)
  })

  deprecate.event(this, 'did-get-response-details', '-did-get-response-details')
  deprecate.event(this, 'did-get-redirect-request', '-did-get-redirect-request')

  // The devtools requests the webContents to reload.
  this.on('devtools-reload-page', function () {
    this.reload()
  })

  // Handle window.open for BrowserWindow and BrowserView.
  if (['browserView', 'window'].includes(this.getType())) {
    // Make new windows requested by links behave like "window.open".
    this.on('-new-window', (event, url, frameName, disposition,
      additionalFeatures, postData,
      referrer) => {
      const options = {
        show: true,
        width: 800,
        height: 600
      }
      internalWindowOpen(event, url, referrer, frameName, disposition, options, additionalFeatures, postData)
    })

    // Create a new browser window for the native implementation of
    // "window.open", used in sandbox and nativeWindowOpen mode.
    this.on('-add-new-contents', (event, webContents, disposition,
      userGesture, left, top, width, height, url, frameName) => {
      if ((disposition !== 'foreground-tab' && disposition !== 'new-window' &&
           disposition !== 'background-tab')) {
        event.preventDefault()
        return
      }

      const options = {
        show: true,
        x: left,
        y: top,
        width: width || 800,
        height: height || 600,
        webContents
      }
      const referrer = { url: '', policy: 'default' }
      internalWindowOpen(event, url, referrer, frameName, disposition, options)
    })
  }

  app.emit('web-contents-created', {}, this)
}

// JavaScript wrapper of Debugger.
const { Debugger } = process.electronBinding('debugger')

Debugger.prototype.sendCommand = deprecate.promisify(Debugger.prototype.sendCommand)

Object.setPrototypeOf(Debugger.prototype, EventEmitter.prototype)

// Public APIs.
module.exports = {
  create (options = {}) {
    return binding.create(options)
  },

  fromId (id) {
    return binding.fromId(id)
  },

  getFocusedWebContents () {
    let focused = null
    for (const contents of binding.getAllWebContents()) {
      if (!contents.isFocused()) continue
      if (focused == null) focused = contents
      // Return webview web contents which may be embedded inside another
      // web contents that is also reporting as focused
      if (contents.getType() === 'webview') return contents
    }
    return focused
  },

  getAllWebContents () {
    return binding.getAllWebContents()
  }
}
