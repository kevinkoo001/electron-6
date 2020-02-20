const assert = require('assert')
const chai = require('chai')
const http = require('http')
const https = require('https')
const path = require('path')
const fs = require('fs')
const send = require('send')
const auth = require('basic-auth')
const ChildProcess = require('child_process')
const { closeWindow } = require('./window-helpers')

const { ipcRenderer, remote } = require('electron')
const { ipcMain, session, BrowserWindow, net } = remote
const { expect } = chai

/* The whole session API doesn't use standard callbacks */
/* eslint-disable standard/no-callback-literal */

describe('session module', () => {
  let fixtures = path.resolve(__dirname, 'fixtures')
  let w = null
  let webview = null
  const url = 'http://127.0.0.1'

  beforeEach(() => {
    w = new BrowserWindow({
      show: false,
      width: 400,
      height: 400,
      webPreferences: {
        nodeIntegration: true
      }
    })
  })

  afterEach(() => {
    if (webview != null) {
      if (!document.body.contains(webview)) {
        document.body.appendChild(webview)
      }
      webview.remove()
    }

    return closeWindow(w).then(() => { w = null })
  })

  describe('session.defaultSession', () => {
    it('returns the default session', () => {
      assert.strictEqual(session.defaultSession, session.fromPartition(''))
    })
  })

  describe('session.fromPartition(partition, options)', () => {
    it('returns existing session with same partition', () => {
      assert.strictEqual(session.fromPartition('test'), session.fromPartition('test'))
    })

    it('created session is ref-counted', () => {
      const partition = 'test2'
      const userAgent = 'test-agent'
      const ses1 = session.fromPartition(partition)
      ses1.setUserAgent(userAgent)
      assert.strictEqual(ses1.getUserAgent(), userAgent)
      ses1.destroy()
      const ses2 = session.fromPartition(partition)
      assert.notStrictEqual(ses2.getUserAgent(), userAgent)
    })
  })

  describe('ses.cookies', () => {
    const name = '0'
    const value = '0'

    it('should get cookies with promises', (done) => {
      const server = http.createServer((req, res) => {
        res.setHeader('Set-Cookie', [`${name}=${value}`])
        res.end('finished')
        server.close()
      })
      server.listen(0, '127.0.0.1', () => {
        w.webContents.once('did-finish-load', async () => {
          const list = await w.webContents.session.cookies.get({ url })
          const cookie = list.find(cookie => cookie.name === name)

          expect(cookie).to.exist.and.to.have.property('value', value)
          done()
        })
        const { port } = server.address()
        w.loadURL(`${url}:${port}`)
      })
    })

    it('should get cookies with callbacks', (done) => {
      const server = http.createServer((req, res) => {
        res.setHeader('Set-Cookie', [`${name}=${value}`])
        res.end('finished')
        server.close()
      })
      server.listen(0, '127.0.0.1', () => {
        w.webContents.once('did-finish-load', () => {
          w.webContents.session.cookies.get({ url }, (error, list) => {
            if (error) return done(error)
            const cookie = list.find(cookie => cookie.name === name)
            expect(cookie).to.exist.and.to.have.property('value', value)
            done()
          })
        })
        const { port } = server.address()
        w.loadURL(`${url}:${port}`)
      })
    })

    it('sets cookies with promises', async () => {
      let error
      try {
        const { cookies } = session.defaultSession
        const name = '1'
        const value = '1'

        await cookies.set({ url, name, value })
      } catch (e) {
        error = e
      }
      expect(error).to.be.undefined(error)
    })

    it('sets cookies with callbacks', (done) => {
      const { cookies } = session.defaultSession
      const name = '1'
      const value = '1'
      cookies.set({ url, name, value }, (error, list) => done(error))
    })

    it('yields an error when setting a cookie with missing required fields', async () => {
      let error
      try {
        const { cookies } = session.defaultSession
        const name = '1'
        const value = '1'
        await cookies.set({ url: '', name, value })
      } catch (e) {
        error = e
      }
      expect(error).is.an('Error')
      expect(error).to.have.property('message').which.equals('Failed to get cookie domain')
    })

    it('yields an error when setting a cookie with an invalid URL', async () => {
      const { cookies } = session.defaultSession
      const name = '1'
      const value = '1'

      await expect(
        cookies.set({ url: 'asdf', name, value })
      ).to.eventually.be.rejectedWith('Failed to get cookie domain')
    })

    it('should overwrite previous cookies', async () => {
      let error
      try {
        const { cookies } = session.defaultSession
        const name = 'DidOverwrite'
        for (const value of [ 'No', 'Yes' ]) {
          await cookies.set({ url, name, value })
          const list = await cookies.get({ url })

          assert(list.some(cookie => cookie.name === name && cookie.value === value))
        }
      } catch (e) {
        error = e
      }
      expect(error).to.be.undefined(error)
    })

    it('should remove cookies with promises', async () => {
      let error
      try {
        const { cookies } = session.defaultSession
        const name = '2'
        const value = '2'

        await cookies.set({ url, name, value })
        await cookies.remove(url, name)
        const list = await cookies.get({ url })

        assert(!list.some(cookie => cookie.name === name && cookie.value === value))
      } catch (e) {
        error = e
      }
      expect(error).to.be.undefined(error)
    })

    it('should remove cookies with callbacks', (done) => {
      const { cookies } = session.defaultSession
      const name = '2'
      const value = '2'

      cookies.set({ url, name, value }, (error) => {
        if (error) return done(error)
        cookies.remove(url, name, (error) => {
          if (error) return done(error)
          cookies.get({ url }, (error, list) => {
            if (error) return done(error)
            assert(!list.some(cookie => cookie.name === name))
            done()
          })
        })
      })
    })

    it('should set cookie for standard scheme', async () => {
      let error
      try {
        const { cookies } = session.defaultSession
        const standardScheme = remote.getGlobal('standardScheme')
        const domain = 'fake-host'
        const url = `${standardScheme}://${domain}`
        const name = 'custom'
        const value = '1'

        await cookies.set({ url, name, value })
        const list = await cookies.get({ url })

        expect(list).to.have.lengthOf(1)
        expect(list[0]).to.have.property('name', name)
        expect(list[0]).to.have.property('value', value)
        expect(list[0]).to.have.property('domain', domain)
      } catch (e) {
        error = e
      }

      expect(error).to.be.undefined(error)
    })

    it('emits a changed event when a cookie is added or removed', async () => {
      let error
      const changes = []

      try {
        const { cookies } = session.fromPartition('cookies-changed')
        const name = 'foo'
        const value = 'bar'
        const eventName = 'changed'
        const listener = (event, cookie, cause, removed) => { changes.push({ cookie, cause, removed }) }

        cookies.on(eventName, listener)
        await cookies.set({ url, name, value })
        await cookies.remove(url, name)
        cookies.off(eventName, listener)

        expect(changes).to.have.lengthOf(2)
        expect(changes.every(change => change.cookie.name === name))
        expect(changes.every(change => change.cookie.value === value))
        expect(changes.every(change => change.cause === 'explicit'))
        expect(changes[0].removed).to.be.false()
        expect(changes[1].removed).to.be.true()
      } catch (e) {
        error = e
      }
      expect(error).to.be.undefined(error)
    })

    describe('ses.cookies.flushStore()', async () => {
      describe('flushes the cookies to disk and invokes the callback when done', async () => {
        it('with promises', async () => {
          let error
          try {
            const name = 'foo'
            const value = 'bar'
            const { cookies } = session.defaultSession

            await cookies.set({ url, name, value })
            await cookies.flushStore()
          } catch (e) {
            error = e
          }
          expect(error).to.be.undefined(error)
        })

        it('with callbacks', (done) => {
          const name = 'foo'
          const value = 'bar'
          const { cookies } = session.defaultSession

          cookies.set({ url, name, value }, (error) => {
            if (error) return done(error)
            cookies.flushStore(error => done(error))
          })
        })
      })
    })

    describe('ses.cookies.flushStore(callback)', () => {
      it('flushes the cookies to disk and invokes the callback when done', (done) => {
        session.defaultSession.cookies.set({
          url: url,
          name: 'foo',
          value: 'bar'
        }, (error) => {
          if (error) return done(error)
          session.defaultSession.cookies.flushStore(() => done())
        })
      })
    })

    it('should survive an app restart for persistent partition', async () => {
      const appPath = path.join(__dirname, 'fixtures', 'api', 'cookie-app')
      const electronPath = remote.getGlobal('process').execPath

      const test = (result, phase) => {
        return new Promise((resolve, reject) => {
          let output = ''

          const appProcess = ChildProcess.spawn(
            electronPath,
            [appPath],
            { env: { PHASE: phase, ...process.env } }
          )

          appProcess.stdout.on('data', data => { output += data })
          appProcess.stdout.on('end', () => {
            output = output.replace(/(\r\n|\n|\r)/gm, '')
            assert.strictEqual(output, result)
            resolve()
          })
        })
      }

      await test('011', 'one')
      await test('110', 'two')
    })
  })

  describe('ses.clearStorageData(options)', () => {
    fixtures = path.resolve(__dirname, 'fixtures')
    it('clears localstorage data', (done) => {
      ipcMain.on('count', (event, count) => {
        ipcMain.removeAllListeners('count')
        assert.strictEqual(count, 0)
        done()
      })
      w.webContents.on('did-finish-load', () => {
        const options = {
          origin: 'file://',
          storages: ['localstorage'],
          quotas: ['persistent']
        }
        w.webContents.session.clearStorageData(options).then(() => {
          w.webContents.send('getcount')
        })
      })
      w.loadFile(path.join(fixtures, 'api', 'localstorage.html'))
    })

    // TODO(codebytere): remove when promisification is complete
    it('clears localstorage data (callback)', (done) => {
      ipcMain.on('count', (event, count) => {
        ipcMain.removeAllListeners('count')
        assert.strictEqual(count, 0)
        done()
      })
      w.webContents.on('did-finish-load', () => {
        const options = {
          origin: 'file://',
          storages: ['localstorage'],
          quotas: ['persistent']
        }
        w.webContents.session.clearStorageData(options, () => {
          w.webContents.send('getcount')
        })
      })
      w.loadFile(path.join(fixtures, 'api', 'localstorage.html'))
    })
  })

  describe('will-download event', () => {
    beforeEach(() => {
      if (w != null) w.destroy()
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400
      })
    })

    it('can cancel default download behavior', (done) => {
      const mockFile = Buffer.alloc(1024)
      const contentDisposition = 'inline; filename="mockFile.txt"'
      const downloadServer = http.createServer((req, res) => {
        res.writeHead(200, {
          'Content-Length': mockFile.length,
          'Content-Type': 'application/plain',
          'Content-Disposition': contentDisposition
        })
        res.end(mockFile)
        downloadServer.close()
      })

      downloadServer.listen(0, '127.0.0.1', () => {
        const port = downloadServer.address().port
        const url = `http://127.0.0.1:${port}/`

        ipcRenderer.sendSync('set-download-option', false, true)
        w.loadURL(url)
        ipcRenderer.once('download-error', (event, downloadUrl, filename, error) => {
          assert.strictEqual(downloadUrl, url)
          assert.strictEqual(filename, 'mockFile.txt')
          assert.strictEqual(error, 'Object has been destroyed')
          done()
        })
      })
    })
  })

  describe('DownloadItem', () => {
    const mockPDF = Buffer.alloc(1024 * 1024 * 5)
    const protocolName = 'custom-dl'
    let contentDisposition = 'inline; filename="mock.pdf"'
    const downloadFilePath = path.join(fixtures, 'mock.pdf')
    const downloadServer = http.createServer((req, res) => {
      if (req.url === '/?testFilename') contentDisposition = 'inline'
      res.writeHead(200, {
        'Content-Length': mockPDF.length,
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition
      })
      res.end(mockPDF)
      downloadServer.close()
    })

    const isPathEqual = (path1, path2) => {
      return path.relative(path1, path2) === ''
    }
    const assertDownload = (event, state, url, mimeType,
      receivedBytes, totalBytes, disposition,
      filename, port, savePath, isCustom) => {
      assert.strictEqual(state, 'completed')
      assert.strictEqual(filename, 'mock.pdf')
      assert.ok(path.isAbsolute(savePath))
      assert.ok(isPathEqual(savePath, path.join(__dirname, 'fixtures', 'mock.pdf')))
      if (isCustom) {
        assert.strictEqual(url, `${protocolName}://item`)
      } else {
        assert.strictEqual(url, `http://127.0.0.1:${port}/`)
      }
      assert.strictEqual(mimeType, 'application/pdf')
      assert.strictEqual(receivedBytes, mockPDF.length)
      assert.strictEqual(totalBytes, mockPDF.length)
      assert.strictEqual(disposition, contentDisposition)
      assert(fs.existsSync(downloadFilePath))
      fs.unlinkSync(downloadFilePath)
    }

    it('can download using WebContents.downloadURL', (done) => {
      downloadServer.listen(0, '127.0.0.1', () => {
        const port = downloadServer.address().port
        ipcRenderer.sendSync('set-download-option', false, false)
        w.webContents.downloadURL(`${url}:${port}`)
        ipcRenderer.once('download-done', (event, state, url,
          mimeType, receivedBytes,
          totalBytes, disposition,
          filename, savePath) => {
          assertDownload(event, state, url, mimeType, receivedBytes,
            totalBytes, disposition, filename, port, savePath)
          done()
        })
      })
    })

    it('can download from custom protocols using WebContents.downloadURL', (done) => {
      const protocol = session.defaultSession.protocol
      downloadServer.listen(0, '127.0.0.1', () => {
        const port = downloadServer.address().port
        const handler = (ignoredError, callback) => {
          callback({ url: `${url}:${port}` })
        }
        protocol.registerHttpProtocol(protocolName, handler, (error) => {
          if (error) return done(error)
          ipcRenderer.sendSync('set-download-option', false, false)
          w.webContents.downloadURL(`${protocolName}://item`)
          ipcRenderer.once('download-done', (event, state, url,
            mimeType, receivedBytes,
            totalBytes, disposition,
            filename, savePath) => {
            assertDownload(event, state, url, mimeType, receivedBytes,
              totalBytes, disposition, filename, port, savePath,
              true)
            done()
          })
        })
      })
    })

    it('can download using WebView.downloadURL', (done) => {
      downloadServer.listen(0, '127.0.0.1', () => {
        const port = downloadServer.address().port
        ipcRenderer.sendSync('set-download-option', false, false)
        webview = new WebView()
        webview.addEventListener('did-finish-load', () => {
          webview.downloadURL(`${url}:${port}/`)
        })
        webview.src = `file://${fixtures}/api/blank.html`
        ipcRenderer.once('download-done', (event, state, url,
          mimeType, receivedBytes,
          totalBytes, disposition,
          filename, savePath) => {
          assertDownload(event, state, url, mimeType, receivedBytes,
            totalBytes, disposition, filename, port, savePath)
          document.body.removeChild(webview)
          done()
        })
        document.body.appendChild(webview)
      })
    })

    it('can cancel download', (done) => {
      downloadServer.listen(0, '127.0.0.1', () => {
        const port = downloadServer.address().port
        ipcRenderer.sendSync('set-download-option', true, false)
        w.webContents.downloadURL(`${url}:${port}/`)
        ipcRenderer.once('download-done', (event, state, url,
          mimeType, receivedBytes,
          totalBytes, disposition,
          filename) => {
          assert.strictEqual(state, 'cancelled')
          assert.strictEqual(filename, 'mock.pdf')
          assert.strictEqual(mimeType, 'application/pdf')
          assert.strictEqual(receivedBytes, 0)
          assert.strictEqual(totalBytes, mockPDF.length)
          assert.strictEqual(disposition, contentDisposition)
          done()
        })
      })
    })

    it('can generate a default filename', function (done) {
      if (process.env.APPVEYOR === 'True') {
        // FIXME(alexeykuzmin): Skip the test.
        // this.skip()
        return done()
      }

      downloadServer.listen(0, '127.0.0.1', () => {
        const port = downloadServer.address().port
        ipcRenderer.sendSync('set-download-option', true, false)
        w.webContents.downloadURL(`${url}:${port}/?testFilename`)
        ipcRenderer.once('download-done', (event, state, url,
          mimeType, receivedBytes,
          totalBytes, disposition,
          filename) => {
          assert.strictEqual(state, 'cancelled')
          assert.strictEqual(filename, 'download.pdf')
          assert.strictEqual(mimeType, 'application/pdf')
          assert.strictEqual(receivedBytes, 0)
          assert.strictEqual(totalBytes, mockPDF.length)
          assert.strictEqual(disposition, contentDisposition)
          done()
        })
      })
    })

    it('can set options for the save dialog', (done) => {
      downloadServer.listen(0, '127.0.0.1', () => {
        const filePath = path.join(__dirname, 'fixtures', 'mock.pdf')
        const port = downloadServer.address().port
        const options = {
          window: null,
          title: 'title',
          message: 'message',
          buttonLabel: 'buttonLabel',
          nameFieldLabel: 'nameFieldLabel',
          defaultPath: '/',
          filters: [{
            name: '1', extensions: ['.1', '.2']
          }, {
            name: '2', extensions: ['.3', '.4', '.5']
          }],
          showsTagField: true,
          securityScopedBookmarks: true
        }

        ipcRenderer.sendSync('set-download-option', true, false, filePath, options)
        w.webContents.downloadURL(`${url}:${port}`)
        ipcRenderer.once('download-done', (event, state, url,
          mimeType, receivedBytes,
          totalBytes, disposition,
          filename, savePath, dialogOptions) => {
          expect(dialogOptions).to.deep.equal(options)
          done()
        })
      })
    })

    describe('when a save path is specified and the URL is unavailable', () => {
      it('does not display a save dialog and reports the done state as interrupted', (done) => {
        ipcRenderer.sendSync('set-download-option', false, false)
        ipcRenderer.once('download-done', (event, state) => {
          assert.strictEqual(state, 'interrupted')
          done()
        })
        w.webContents.downloadURL(`file://${path.join(__dirname, 'does-not-exist.txt')}`)
      })
    })
  })

  describe('ses.protocol', () => {
    const partitionName = 'temp'
    const protocolName = 'sp'
    const partitionProtocol = session.fromPartition(partitionName).protocol
    const protocol = session.defaultSession.protocol
    const handler = (ignoredError, callback) => {
      callback({ data: 'test', mimeType: 'text/html' })
    }

    beforeEach((done) => {
      if (w != null) w.destroy()
      w = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: partitionName
        }
      })
      partitionProtocol.registerStringProtocol(protocolName, handler, (error) => {
        done(error != null ? error : undefined)
      })
    })

    afterEach((done) => {
      partitionProtocol.unregisterProtocol(protocolName, () => done())
    })

    it('does not affect defaultSession', async () => {
      const result1 = await protocol.isProtocolHandled(protocolName)
      assert.strictEqual(result1, false)

      const result2 = await partitionProtocol.isProtocolHandled(protocolName)
      assert.strictEqual(result2, true)
    })

    it('handles requests from partition', (done) => {
      w.webContents.on('did-finish-load', () => done())
      w.loadURL(`${protocolName}://fake-host`)
    })
  })

  describe('ses.setProxy(options)', () => {
    let server = null
    let customSession = null

    beforeEach((done) => {
      customSession = session.fromPartition('proxyconfig')
      // FIXME(deepak1556): This is just a hack to force
      // creation of request context which in turn initializes
      // the network context, can be removed with network
      // service enabled.
      customSession.clearHostResolverCache().then(() => done())
    })

    afterEach(() => {
      if (server) {
        server.close()
      }
      if (customSession) {
        customSession.destroy()
      }
    })

    it('allows configuring proxy settings', async () => {
      const config = { proxyRules: 'http=myproxy:80' }
      await customSession.setProxy(config)
      const proxy = await customSession.resolveProxy('http://example.com/')
      assert.strictEqual(proxy, 'PROXY myproxy:80')
    })

    // TODO(codebytere): remove when Promisification is complete
    it('allows configuring proxy settings (callback)', (done) => {
      const config = { proxyRules: 'http=myproxy:80' }
      customSession.setProxy(config, () => {
        customSession.resolveProxy('http://example.com/', proxy => {
          assert.strictEqual(proxy, 'PROXY myproxy:80')
          done()
        })
      })
    })

    it('allows removing the implicit bypass rules for localhost', async () => {
      const config = {
        proxyRules: 'http=myproxy:80',
        proxyBypassRules: '<-loopback>'
      }

      await customSession.setProxy(config)
      const proxy = await customSession.resolveProxy('http://localhost')
      assert.strictEqual(proxy, 'PROXY myproxy:80')
    })

    // TODO(codebytere): remove when Promisification is complete
    it('allows removing the implicit bypass rules for localhost (callback)', (done) => {
      const config = {
        proxyRules: 'http=myproxy:80',
        proxyBypassRules: '<-loopback>'
      }
      customSession.setProxy(config).then(() => {
        customSession.resolveProxy('http://localhost').then(proxy => {
          assert.strictEqual(proxy, 'PROXY myproxy:80')
          done()
        })
      })
    })

    it('allows configuring proxy settings with pacScript', async () => {
      server = http.createServer((req, res) => {
        const pac = `
          function FindProxyForURL(url, host) {
            return "PROXY myproxy:8132";
          }
        `
        res.writeHead(200, {
          'Content-Type': 'application/x-ns-proxy-autoconfig'
        })
        res.end(pac)
      })
      return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', async () => {
          try {
            const config = { pacScript: `http://127.0.0.1:${server.address().port}` }
            await customSession.setProxy(config)
            const proxy = await customSession.resolveProxy('https://google.com')
            assert.strictEqual(proxy, 'PROXY myproxy:8132')
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      })
    })

    // TODO(codebytere): reconfigure when Promisification is complete
    it('allows configuring proxy settings with pacScript (callback)', (done) => {
      server = http.createServer((req, res) => {
        const pac = `
          function FindProxyForURL(url, host) {
            return "PROXY myproxy:8132";
          }
        `
        res.writeHead(200, {
          'Content-Type': 'application/x-ns-proxy-autoconfig'
        })
        res.end(pac)
      })
      server.listen(0, '127.0.0.1', () => {
        const config = { pacScript: `http://127.0.0.1:${server.address().port}` }
        customSession.setProxy(config, () => {
          customSession.resolveProxy('https://google.com', proxy => {
            assert.strictEqual(proxy, 'PROXY myproxy:8132')
            done()
          })
        })
      })
    })

    it('allows bypassing proxy settings', async () => {
      const config = {
        proxyRules: 'http=myproxy:80',
        proxyBypassRules: '<local>'
      }
      await customSession.setProxy(config)
      const proxy = await customSession.resolveProxy('http://example/')
      assert.strictEqual(proxy, 'DIRECT')
    })

    // TODO(codebytere): remove when Promisification is complete
    it('allows bypassing proxy settings (callback)', (done) => {
      const config = {
        proxyRules: 'http=myproxy:80',
        proxyBypassRules: '<local>'
      }
      customSession.setProxy(config, () => {
        customSession.resolveProxy('http://example/', proxy => {
          assert.strictEqual(proxy, 'DIRECT')
          done()
        })
      })
    })
  })

  describe('ses.getBlobData()', () => {
    it('returns blob data for uuid', (done) => {
      const scheme = 'cors-blob'
      const protocol = session.defaultSession.protocol
      const url = `${scheme}://host`
      before(() => {
        if (w != null) w.destroy()
        w = new BrowserWindow({ show: false })
      })

      after((done) => {
        protocol.unregisterProtocol(scheme, () => {
          closeWindow(w).then(() => {
            w = null
            done()
          })
        })
      })

      const postData = JSON.stringify({
        type: 'blob',
        value: 'hello'
      })
      const content = `<html>
                       <script>
                       let fd = new FormData();
                       fd.append('file', new Blob(['${postData}'], {type:'application/json'}));
                       fetch('${url}', {method:'POST', body: fd });
                       </script>
                       </html>`

      protocol.registerStringProtocol(scheme, (request, callback) => {
        if (request.method === 'GET') {
          callback({ data: content, mimeType: 'text/html' })
        } else if (request.method === 'POST') {
          const uuid = request.uploadData[1].blobUUID
          assert(uuid)
          session.defaultSession.getBlobData(uuid).then(result => {
            assert.strictEqual(result.toString(), postData)
            done()
          })
        }
      }, (error) => {
        if (error) return done(error)
        w.loadURL(url)
      })
    })
  })

  describe('ses.setCertificateVerifyProc(callback)', (done) => {
    let server = null

    beforeEach((done) => {
      const certPath = path.join(__dirname, 'fixtures', 'certificates')
      const options = {
        key: fs.readFileSync(path.join(certPath, 'server.key')),
        cert: fs.readFileSync(path.join(certPath, 'server.pem')),
        ca: [
          fs.readFileSync(path.join(certPath, 'rootCA.pem')),
          fs.readFileSync(path.join(certPath, 'intermediateCA.pem'))
        ],
        requestCert: true,
        rejectUnauthorized: false
      }

      server = https.createServer(options, (req, res) => {
        res.writeHead(200)
        res.end('<title>hello</title>')
      })
      server.listen(0, '127.0.0.1', done)
    })

    afterEach(() => {
      session.defaultSession.setCertificateVerifyProc(null)
      server.close()
    })

    it('accepts the request when the callback is called with 0', (done) => {
      session.defaultSession.setCertificateVerifyProc(({ hostname, certificate, verificationResult, errorCode }, callback) => {
        assert(['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID'].includes(verificationResult), verificationResult)
        assert([-202, -200].includes(errorCode), errorCode)
        callback(0)
      })

      w.webContents.once('did-finish-load', () => {
        assert.strictEqual(w.webContents.getTitle(), 'hello')
        done()
      })
      w.loadURL(`https://127.0.0.1:${server.address().port}`)
    })

    it('rejects the request when the callback is called with -2', (done) => {
      session.defaultSession.setCertificateVerifyProc(({ hostname, certificate, verificationResult }, callback) => {
        assert.strictEqual(hostname, '127.0.0.1')
        assert.strictEqual(certificate.issuerName, 'Intermediate CA')
        assert.strictEqual(certificate.subjectName, 'localhost')
        assert.strictEqual(certificate.issuer.commonName, 'Intermediate CA')
        assert.strictEqual(certificate.subject.commonName, 'localhost')
        assert.strictEqual(certificate.issuerCert.issuer.commonName, 'Root CA')
        assert.strictEqual(certificate.issuerCert.subject.commonName, 'Intermediate CA')
        assert.strictEqual(certificate.issuerCert.issuerCert.issuer.commonName, 'Root CA')
        assert.strictEqual(certificate.issuerCert.issuerCert.subject.commonName, 'Root CA')
        assert.strictEqual(certificate.issuerCert.issuerCert.issuerCert, undefined)
        assert(['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID'].includes(verificationResult), verificationResult)
        callback(-2)
      })

      const url = `https://127.0.0.1:${server.address().port}`
      w.webContents.once('did-finish-load', () => {
        assert.strictEqual(w.webContents.getTitle(), url)
        done()
      })
      w.loadURL(url)
    })
  })

  describe('ses.createInterruptedDownload(options)', () => {
    it('can create an interrupted download item', (done) => {
      ipcRenderer.sendSync('set-download-option', true, false)
      const filePath = path.join(__dirname, 'fixtures', 'mock.pdf')
      const options = {
        path: filePath,
        urlChain: ['http://127.0.0.1/'],
        mimeType: 'application/pdf',
        offset: 0,
        length: 5242880
      }
      w.webContents.session.createInterruptedDownload(options)
      ipcRenderer.once('download-created', (event, state, urlChain,
        mimeType, receivedBytes,
        totalBytes, filename,
        savePath) => {
        assert.strictEqual(state, 'interrupted')
        assert.deepStrictEqual(urlChain, ['http://127.0.0.1/'])
        assert.strictEqual(mimeType, 'application/pdf')
        assert.strictEqual(receivedBytes, 0)
        assert.strictEqual(totalBytes, 5242880)
        assert.strictEqual(savePath, filePath)
        done()
      })
    })

    it('can be resumed', (done) => {
      const fixtures = path.join(__dirname, 'fixtures')
      const downloadFilePath = path.join(fixtures, 'logo.png')
      const rangeServer = http.createServer((req, res) => {
        const options = { root: fixtures }
        send(req, req.url, options)
          .on('error', (error) => { done(error) }).pipe(res)
      })
      ipcRenderer.sendSync('set-download-option', true, false, downloadFilePath)
      rangeServer.listen(0, '127.0.0.1', () => {
        const port = rangeServer.address().port
        const downloadUrl = `http://127.0.0.1:${port}/assets/logo.png`
        const callback = (event, state, url, mimeType,
          receivedBytes, totalBytes, disposition,
          filename, savePath, dialogOptions, urlChain,
          lastModifiedTime, eTag) => {
          if (state === 'cancelled') {
            const options = {
              path: savePath,
              urlChain: urlChain,
              mimeType: mimeType,
              offset: receivedBytes,
              length: totalBytes,
              lastModified: lastModifiedTime,
              eTag: eTag
            }
            ipcRenderer.sendSync('set-download-option', false, false, downloadFilePath)
            w.webContents.session.createInterruptedDownload(options)
          } else {
            assert.strictEqual(state, 'completed')
            assert.strictEqual(filename, 'logo.png')
            assert.strictEqual(savePath, downloadFilePath)
            assert.strictEqual(url, downloadUrl)
            assert.strictEqual(mimeType, 'image/png')
            assert.strictEqual(receivedBytes, 14022)
            assert.strictEqual(totalBytes, 14022)
            assert(fs.existsSync(downloadFilePath))
            fs.unlinkSync(downloadFilePath)
            rangeServer.close()
            ipcRenderer.removeListener('download-done', callback)
            done()
          }
        }
        ipcRenderer.on('download-done', callback)
        w.webContents.downloadURL(downloadUrl)
      })
    })
  })

  describe('ses.clearAuthCache(options)', () => {
    it('can clear http auth info from cache', (done) => {
      const ses = session.fromPartition('auth-cache')
      const server = http.createServer((req, res) => {
        const credentials = auth(req)
        if (!credentials || credentials.name !== 'test' || credentials.pass !== 'test') {
          res.statusCode = 401
          res.setHeader('WWW-Authenticate', 'Basic realm="Restricted"')
          res.end()
        } else {
          res.end('authenticated')
        }
      })
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port
        function issueLoginRequest (attempt = 1) {
          if (attempt > 2) {
            server.close()
            return done()
          }
          const request = net.request({
            url: `http://127.0.0.1:${port}`,
            session: ses
          })
          request.on('login', (info, callback) => {
            attempt += 1
            assert.strictEqual(info.scheme, 'basic')
            assert.strictEqual(info.realm, 'Restricted')
            callback('test', 'test')
          })
          request.on('response', (response) => {
            let data = ''
            response.pause()
            response.on('data', (chunk) => {
              data += chunk
            })
            response.on('end', () => {
              assert.strictEqual(data, 'authenticated')
              ses.clearAuthCache({ type: 'password' }).then(() => {
                issueLoginRequest(attempt)
              })
            })
            response.on('error', (error) => { done(error) })
            response.resume()
          })
          // Internal api to bypass cache for testing.
          request.urlRequest._setLoadFlags(1 << 1)
          request.end()
        }
        issueLoginRequest()
      })
    })

    // TODO(codebytere): remove when promisification complete
    it('can clear http auth info from cache (callback)', (done) => {
      const ses = session.fromPartition('auth-cache')
      const server = http.createServer((req, res) => {
        const credentials = auth(req)
        if (!credentials || credentials.name !== 'test' || credentials.pass !== 'test') {
          res.statusCode = 401
          res.setHeader('WWW-Authenticate', 'Basic realm="Restricted"')
          res.end()
        } else {
          res.end('authenticated')
        }
      })
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port
        function issueLoginRequest (attempt = 1) {
          if (attempt > 2) {
            server.close()
            return done()
          }
          const request = net.request({
            url: `http://127.0.0.1:${port}`,
            session: ses
          })
          request.on('login', (info, callback) => {
            attempt += 1
            assert.strictEqual(info.scheme, 'basic')
            assert.strictEqual(info.realm, 'Restricted')
            callback('test', 'test')
          })
          request.on('response', (response) => {
            let data = ''
            response.pause()
            response.on('data', (chunk) => {
              data += chunk
            })
            response.on('end', () => {
              assert.strictEqual(data, 'authenticated')
              ses.clearAuthCache({ type: 'password' }, () => {
                issueLoginRequest(attempt)
              })
            })
            response.on('error', (error) => { done(error) })
            response.resume()
          })
          // Internal api to bypass cache for testing.
          request.urlRequest._setLoadFlags(1 << 1)
          request.end()
        }
        issueLoginRequest()
      })
    })
  })

  describe('ses.setPermissionRequestHandler(handler)', () => {
    it('cancels any pending requests when cleared', (done) => {
      const ses = session.fromPartition('permissionTest')
      ses.setPermissionRequestHandler(() => {
        ses.setPermissionRequestHandler(null)
      })

      webview = new WebView()
      webview.addEventListener('ipc-message', (e) => {
        assert.strictEqual(e.channel, 'message')
        assert.deepStrictEqual(e.args, ['SecurityError'])
        done()
      })
      webview.src = `file://${fixtures}/pages/permissions/midi-sysex.html`
      webview.partition = 'permissionTest'
      webview.setAttribute('nodeintegration', 'on')
      document.body.appendChild(webview)
    })
  })
})
