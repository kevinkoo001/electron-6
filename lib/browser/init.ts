import { Buffer } from 'buffer'
import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'
import * as v8 from 'v8'

const Module = require('module')

// We modified the original process.argv to let node.js load the init.js,
// we need to restore it here.
process.argv.splice(1, 1)

// Clear search paths.
require('../common/reset-search-paths')

// Import common settings.
require('@electron/internal/common/init')

const globalPaths = Module.globalPaths

// Expose public APIs.
globalPaths.push(path.join(__dirname, 'api', 'exports'))

if (process.platform === 'win32') {
  // Redirect node's console to use our own implementations, since node can not
  // handle console output when running as GUI program.
  const consoleLog = (format: any, ...args: any[]) => {
    return process.log(util.format(format, ...args) + '\n')
  }
  const streamWrite: NodeJS.WritableStream['write'] = function (chunk: Buffer | string, encoding?: any, callback?: Function) {
    if (Buffer.isBuffer(chunk)) {
      chunk = chunk.toString(encoding)
    }
    process.log(chunk)
    if (callback) {
      callback()
    }
    return true
  }
  console.log = console.error = console.warn = consoleLog
  process.stdout.write = process.stderr.write = streamWrite
}

// Don't quit on fatal error.
process.on('uncaughtException', function (error) {
  // Do nothing if the user has a custom uncaught exception handler.
  if (process.listeners('uncaughtException').length > 1) {
    return
  }

  // Show error in GUI.
  // We can't import { dialog } at the top of this file as this file is
  // responsible for setting up the require hook for the "electron" module
  // so we import it inside the handler down here
  import('electron')
    .then(({ dialog }) => {
      const stack = error.stack ? error.stack : `${error.name}: ${error.message}`
      const message = 'Uncaught Exception:\n' + stack
      dialog.showErrorBox('A JavaScript error occurred in the main process', message)
    })
})

// Emit 'exit' event on quit.
const { app } = require('electron')

app.on('quit', function (event, exitCode) {
  process.emit('exit', exitCode)
})

if (process.platform === 'win32') {
  // If we are a Squirrel.Windows-installed app, set app user model ID
  // so that users don't have to do this.
  //
  // Squirrel packages are always of the form:
  //
  // PACKAGE-NAME
  // - Update.exe
  // - app-VERSION
  //   - OUREXE.exe
  //
  // Squirrel itself will always set the shortcut's App User Model ID to the
  // form `com.squirrel.PACKAGE-NAME.OUREXE`. We need to call
  // app.setAppUserModelId with a matching identifier so that renderer processes
  // will inherit this value.
  const updateDotExe = path.join(path.dirname(process.execPath), '..', 'update.exe')

  if (fs.existsSync(updateDotExe)) {
    const packageDir = path.dirname(path.resolve(updateDotExe))
    const packageName = path.basename(packageDir).replace(/\s/g, '')
    const exeName = path.basename(process.execPath).replace(/\.exe$/i, '').replace(/\s/g, '')

    app.setAppUserModelId(`com.squirrel.${packageName}.${exeName}`)
  }
}

// Map process.exit to app.exit, which quits gracefully.
process.exit = app.exit as () => never

// Load the RPC server.
require('@electron/internal/browser/rpc-server')

// Load the guest view manager.
require('@electron/internal/browser/guest-view-manager')
require('@electron/internal/browser/guest-window-manager')

// Now we try to load app's package.json.
let packagePath = null
let packageJson = null
const searchPaths = ['app', 'app.asar', 'default_app.asar']

if (process.resourcesPath) {
  for (packagePath of searchPaths) {
    try {
      packagePath = path.join(process.resourcesPath, packagePath)
      packageJson = require(path.join(packagePath, 'package.json'))
      break
    } catch {
      continue
    }
  }
}

if (packageJson == null) {
  process.nextTick(function () {
    return process.exit(1)
  })
  throw new Error('Unable to find a valid app')
}

// Set application's version.
if (packageJson.version != null) {
  app.setVersion(packageJson.version)
}

// Set application's name.
if (packageJson.productName != null) {
  app.setName(`${packageJson.productName}`.trim())
} else if (packageJson.name != null) {
  app.setName(`${packageJson.name}`.trim())
}

// Set application's desktop name.
if (packageJson.desktopName != null) {
  app.setDesktopName(packageJson.desktopName)
} else {
  app.setDesktopName((app.getName()) + '.desktop')
}

// Set v8 flags
if (packageJson.v8Flags != null) {
  v8.setFlagsFromString(packageJson.v8Flags)
}

app._setDefaultAppPaths(packagePath)

// Load the chrome devtools support.
require('@electron/internal/browser/devtools')

// Load the chrome extension support.
require('@electron/internal/browser/chrome-extension')

const features = process.electronBinding('features')
if (features.isDesktopCapturerEnabled()) {
  // Load internal desktop-capturer module.
  require('@electron/internal/browser/desktop-capturer')
}

// Load protocol module to ensure it is populated on app ready
require('@electron/internal/browser/api/protocol')

// Set main startup script of the app.
const mainStartupScript = packageJson.main || 'index.js'

const KNOWN_XDG_DESKTOP_VALUES = ['Pantheon', 'Unity:Unity7', 'pop:GNOME']

function currentPlatformSupportsAppIndicator () {
  if (process.platform !== 'linux') return false
  const currentDesktop = process.env.XDG_CURRENT_DESKTOP

  if (!currentDesktop) return false
  if (KNOWN_XDG_DESKTOP_VALUES.includes(currentDesktop)) return true
  // ubuntu based or derived session (default ubuntu one, communitheme…) supports
  // indicator too.
  if (/ubuntu/ig.test(currentDesktop)) return true

  return false
}

// Workaround for electron/electron#5050 and electron/electron#9046
if (currentPlatformSupportsAppIndicator()) {
  process.env.XDG_CURRENT_DESKTOP = 'Unity'
}

// Quit when all windows are closed and no other one is listening to this.
app.on('window-all-closed', () => {
  if (app.listenerCount('window-all-closed') === 1) {
    app.quit()
  }
})

Promise.all([
  import('@electron/internal/browser/default-menu'),
  app.whenReady
]).then(([{ setDefaultApplicationMenu }]) => {
  // Create default menu
  setDefaultApplicationMenu()
})

if (packagePath) {
  // Finally load app's main.js and transfer control to C++.
  Module._load(path.join(packagePath, mainStartupScript), Module, true)
} else {
  console.error('Failed to locate a valid package to load (app, app.asar or default_app.asar)')
  console.error('This normally means you\'ve damaged the Electron package somehow')
}
