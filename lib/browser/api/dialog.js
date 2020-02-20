'use strict'

const { app, BrowserWindow, deprecate } = require('electron')
const binding = process.electronBinding('dialog')
const v8Util = process.electronBinding('v8_util')

const fileDialogProperties = {
  openFile: 1 << 0,
  openDirectory: 1 << 1,
  multiSelections: 1 << 2,
  createDirectory: 1 << 3,
  showHiddenFiles: 1 << 4,
  promptToCreate: 1 << 5,
  noResolveAliases: 1 << 6,
  treatPackageAsDirectory: 1 << 7
}

const normalizeAccessKey = (text) => {
  if (typeof text !== 'string') return text

  // macOS does not have access keys so remove single ampersands
  // and replace double ampersands with a single ampersand
  if (process.platform === 'darwin') {
    return text.replace(/&(&?)/g, '$1')
  }

  // Linux uses a single underscore as an access key prefix so escape
  // existing single underscores with a second underscore, replace double
  // ampersands with a single ampersand, and replace a single ampersand with
  // a single underscore
  if (process.platform === 'linux') {
    return text.replace(/_/g, '__').replace(/&(.?)/g, (match, after) => {
      if (after === '&') return after
      return `_${after}`
    })
  }

  return text
}

const checkAppInitialized = function () {
  if (!app.isReady()) {
    throw new Error('dialog module can only be used after app is ready')
  }
}

const saveDialog = (sync, window, options) => {
  checkAppInitialized()

  if (window && window.constructor !== BrowserWindow) {
    options = window
    window = null
  }

  if (options == null) options = { title: 'Save' }

  const {
    buttonLabel = '',
    defaultPath = '',
    filters = [],
    title = '',
    message = '',
    securityScopedBookmarks = false,
    nameFieldLabel = '',
    showsTagField = true
  } = options

  if (typeof title !== 'string') throw new TypeError('Title must be a string')
  if (typeof buttonLabel !== 'string') throw new TypeError('Button label must be a string')
  if (typeof defaultPath !== 'string') throw new TypeError('Default path must be a string')
  if (typeof message !== 'string') throw new TypeError('Message must be a string')
  if (typeof nameFieldLabel !== 'string') throw new TypeError('Name field label must be a string')

  const settings = { buttonLabel, defaultPath, filters, title, message, securityScopedBookmarks, nameFieldLabel, showsTagField, window }
  return (sync) ? binding.showSaveDialogSync(settings) : binding.showSaveDialog(settings)
}

const openDialog = (sync, window, options) => {
  checkAppInitialized()

  if (window && window.constructor !== BrowserWindow) {
    options = window
    window = null
  }

  if (options == null) {
    options = {
      title: 'Open',
      properties: ['openFile']
    }
  }

  const {
    buttonLabel = '',
    defaultPath = '',
    filters = [],
    properties = ['openFile'],
    title = '',
    message = '',
    securityScopedBookmarks = false
  } = options

  if (!Array.isArray(properties)) throw new TypeError('Properties must be an array')

  let dialogProperties = 0
  for (const prop in fileDialogProperties) {
    if (properties.includes(prop)) {
      dialogProperties |= fileDialogProperties[prop]
    }
  }

  if (typeof title !== 'string') throw new TypeError('Title must be a string')
  if (typeof buttonLabel !== 'string') throw new TypeError('Button label must be a string')
  if (typeof defaultPath !== 'string') throw new TypeError('Default path must be a string')
  if (typeof message !== 'string') throw new TypeError('Message must be a string')

  const settings = { title, buttonLabel, defaultPath, filters, message, securityScopedBookmarks, window }
  settings.properties = dialogProperties

  return (sync) ? binding.showOpenDialogSync(settings) : binding.showOpenDialog(settings)
}

const messageBox = (sync, window, options) => {
  checkAppInitialized()

  if (window && window.constructor !== BrowserWindow) {
    options = window
    window = null
  }

  if (options == null) options = { type: 'none' }

  const messageBoxTypes = ['none', 'info', 'warning', 'error', 'question']
  const messageBoxOptions = { noLink: 1 << 0 }

  let {
    buttons = [],
    cancelId,
    checkboxLabel = '',
    checkboxChecked,
    defaultId = -1,
    detail = '',
    icon = null,
    message = '',
    title = '',
    type = 'none'
  } = options

  const messageBoxType = messageBoxTypes.indexOf(type)
  if (messageBoxType === -1) throw new TypeError('Invalid message box type')
  if (!Array.isArray(buttons)) throw new TypeError('Buttons must be an array')
  if (options.normalizeAccessKeys) buttons = buttons.map(normalizeAccessKey)
  if (typeof title !== 'string') throw new TypeError('Title must be a string')
  if (typeof message !== 'string') throw new TypeError('Message must be a string')
  if (typeof detail !== 'string') throw new TypeError('Detail must be a string')
  if (typeof checkboxLabel !== 'string') throw new TypeError('checkboxLabel must be a string')

  checkboxChecked = !!checkboxChecked

  // Choose a default button to get selected when dialog is cancelled.
  if (cancelId == null) {
    // If the defaultId is set to 0, ensure the cancel button is a different index (1)
    cancelId = (defaultId === 0 && buttons.length > 1) ? 1 : 0
    for (let i = 0; i < buttons.length; i++) {
      const text = buttons[i].toLowerCase()
      if (text === 'cancel' || text === 'no') {
        cancelId = i
        break
      }
    }
  }

  const flags = options.noLink ? messageBoxOptions.noLink : 0

  if (sync) {
    return binding.showMessageBoxSync(messageBoxType, buttons,
      defaultId, cancelId, flags, title, message, detail,
      checkboxLabel, checkboxChecked, icon, window)
  } else {
    return binding.showMessageBox(messageBoxType, buttons,
      defaultId, cancelId, flags, title, message, detail,
      checkboxLabel, checkboxChecked, icon, window)
  }
}

module.exports = {
  showOpenDialog: function (window, options) {
    return openDialog(false, window, options)
  },

  showOpenDialogSync: function (window, options) {
    return openDialog(true, window, options)
  },

  showSaveDialog: function (window, options) {
    return saveDialog(false, window, options)
  },

  showSaveDialogSync: function (window, options) {
    return saveDialog(true, window, options)
  },

  showMessageBox: function (window, options) {
    return messageBox(false, window, options)
  },

  showMessageBoxSync: function (window, options) {
    return messageBox(true, window, options)
  },

  showErrorBox: function (...args) {
    return binding.showErrorBox(...args)
  },

  showCertificateTrustDialog: function (window, options) {
    if (window && window.constructor !== BrowserWindow) options = window
    if (options == null || typeof options !== 'object') {
      throw new TypeError('options must be an object')
    }

    const { certificate, message = '' } = options
    if (certificate == null || typeof certificate !== 'object') {
      throw new TypeError('certificate must be an object')
    }

    if (typeof message !== 'string') throw new TypeError('message must be a string')

    return binding.showCertificateTrustDialog(window, certificate, message)
  }
}

module.exports.showMessageBox = deprecate.promisifyMultiArg(module.exports.showMessageBox, ({ response, checkboxChecked }) => [response, checkboxChecked])
module.exports.showOpenDialog = deprecate.promisifyMultiArg(module.exports.showOpenDialog, ({ filePaths, bookmarks }) => [filePaths, bookmarks])
module.exports.showSaveDialog = deprecate.promisifyMultiArg(module.exports.showSaveDialog, ({ filePath, bookmarks }) => [filePath, bookmarks])
module.exports.showCertificateTrustDialog = deprecate.promisify(module.exports.showCertificateTrustDialog)
