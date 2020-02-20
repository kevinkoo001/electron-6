'use strict'

const { ipc } = process.electronBinding('ipc')
const v8Util = process.electronBinding('v8_util')

// Created by init.js.
const ipcRenderer = v8Util.getHiddenValue(global, 'ipc')
const internal = false

ipcRenderer.send = function (channel, ...args) {
  return ipc.send(internal, channel, args)
}

ipcRenderer.sendSync = function (channel, ...args) {
  return ipc.sendSync(internal, channel, args)[0]
}

ipcRenderer.sendToHost = function (channel, ...args) {
  return ipc.sendToHost(channel, args)
}

ipcRenderer.sendTo = function (webContentsId, channel, ...args) {
  return ipc.sendTo(internal, false, webContentsId, channel, args)
}

ipcRenderer.sendToAll = function (webContentsId, channel, ...args) {
  return ipc.sendTo(internal, true, webContentsId, channel, args)
}

module.exports = ipcRenderer
