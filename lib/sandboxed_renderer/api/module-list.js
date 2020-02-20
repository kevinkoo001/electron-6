'use strict'

const features = process.electronBinding('features')

module.exports = [
  {
    name: 'contextBridge',
    load: () => require('@electron/internal/renderer/api/context-bridge')
  },
  {
    name: 'crashReporter',
    load: () => require('@electron/internal/renderer/api/crash-reporter')
  },
  {
    name: 'desktopCapturer',
    load: () => require('@electron/internal/renderer/api/desktop-capturer'),
    enabled: features.isDesktopCapturerEnabled()
  },
  {
    name: 'ipcRenderer',
    load: () => require('@electron/internal/renderer/api/ipc-renderer')
  },
  {
    name: 'nativeImage',
    load: () => require('@electron/internal/common/api/native-image')
  },
  {
    name: 'remote',
    load: () => require('@electron/internal/renderer/api/remote'),
    enabled: process.isRemoteModuleEnabled
  },
  {
    name: 'webFrame',
    load: () => require('@electron/internal/renderer/api/web-frame')
  },
  // The internal modules, invisible unless you know their names.
  {
    name: 'deprecate',
    load: () => require('@electron/internal/common/api/deprecate'),
    private: true
  },
  {
    name: 'isPromise',
    load: () => require('@electron/internal/common/api/is-promise'),
    private: true
  }
]
