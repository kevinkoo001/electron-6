import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
import * as cp from 'child_process'
import * as https from 'https'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import split = require('split')
import { app, BrowserWindow, Menu } from 'electron'
import { emittedOnce } from './events-helpers';
import { closeWindow } from './window-helpers';
import { ifdescribe } from './spec-helpers';

const features = process.electronBinding('features')

const { expect } = chai

chai.use(chaiAsPromised)

const fixturesPath = path.resolve(__dirname, '../spec/fixtures')

describe('electron module', () => {
  it('does not expose internal modules to require', () => {
    expect(() => {
      require('clipboard')
    }).to.throw(/Cannot find module 'clipboard'/)
  })

  describe('require("electron")', () => {
    it('always returns the internal electron module', () => {
      require('electron')
    })
  })
})

describe('app module', () => {
  let server: https.Server
  let secureUrl: string
  const certPath = path.join(fixturesPath, 'certificates')

  before((done) => {
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
      if ((req as any).client.authorized) {
        res.writeHead(200)
        res.end('<title>authorized</title>')
      } else {
        res.writeHead(401)
        res.end('<title>denied</title>')
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      secureUrl = `https://127.0.0.1:${port}`
      done()
    })
  })

  after(done => {
    server.close(() => done())
  })

  describe('app.getVersion()', () => {
    it('returns the version field of package.json', () => {
      expect(app.getVersion()).to.equal('0.1.0')
    })
  })

  describe('app.setVersion(version)', () => {
    it('overrides the version', () => {
      expect(app.getVersion()).to.equal('0.1.0')
      app.setVersion('test-version')

      expect(app.getVersion()).to.equal('test-version')
      app.setVersion('0.1.0')
    })
  })

  describe('app.getName()', () => {
    it('returns the name field of package.json', () => {
      expect(app.getName()).to.equal('Electron Test Main')
    })
  })

  describe('app.setName(name)', () => {
    it('overrides the name', () => {
      expect(app.getName()).to.equal('Electron Test Main')
      app.setName('test-name')

      expect(app.getName()).to.equal('test-name')
      app.setName('Electron Test')
    })
  })

  describe('app.getLocale()', () => {
    it('should not be empty', () => {
      expect(app.getLocale()).to.not.equal('')
    })
  })

  describe('app.getLocaleCountryCode()', () => {
    it('should be empty or have length of two', () => {
      let expectedLength = 2
      if (isCI && process.platform === 'linux') {
        // Linux CI machines have no locale.
        expectedLength = 0
      }
      expect(app.getLocaleCountryCode()).to.be.a('string').and.have.lengthOf(expectedLength)
    })
  })

  describe('app.isPackaged', () => {
    it('should be false durings tests', () => {
      expect(app.isPackaged).to.equal(false)
    })
  })

  describe('app.isInApplicationsFolder()', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('should be false during tests', () => {
      expect(app.isInApplicationsFolder()).to.equal(false)
    })
  })

  describe('app.exit(exitCode)', () => {
    let appProcess: cp.ChildProcess | null = null

    afterEach(() => {
      if (appProcess) appProcess.kill()
    })

    it('emits a process exit event with the code', async () => {
      const appPath = path.join(fixturesPath, 'api', 'quit-app')
      const electronPath = process.execPath
      let output = ''

      appProcess = cp.spawn(electronPath, [appPath])
      appProcess.stdout.on('data', data => { output += data })
      const [code] = await emittedOnce(appProcess, 'close')

      if (process.platform !== 'win32') {
        expect(output).to.include('Exit event with code: 123')
      }
      expect(code).to.equal(123)
    })

    it('closes all windows', async function () {
      const appPath = path.join(fixturesPath, 'api', 'exit-closes-all-windows-app')
      const electronPath = process.execPath

      appProcess = cp.spawn(electronPath, [appPath])
      const [code, signal] = await emittedOnce(appProcess, 'close')

      expect(signal).to.equal(null, 'exit signal should be null, if you see this please tag @MarshallOfSound')
      expect(code).to.equal(123, 'exit code should be 123, if you see this please tag @MarshallOfSound')
    })

    it('exits gracefully', async function () {
      if (!['darwin', 'linux'].includes(process.platform)) {
        this.skip()
        return
      }

      const electronPath = process.execPath
      const appPath = path.join(fixturesPath, 'api', 'singleton')
      appProcess = cp.spawn(electronPath, [appPath])

      // Singleton will send us greeting data to let us know it's running.
      // After that, ask it to exit gracefully and confirm that it does.
      appProcess.stdout.on('data', data => appProcess!.kill())
      const [code, signal] = await emittedOnce(appProcess, 'close')

      const message = `code:\n${code}\nsignal:\n${signal}`
      expect(code).to.equal(0, message)
      expect(signal).to.equal(null, message)
    })
  })

  describe('app.requestSingleInstanceLock', () => {
    it('prevents the second launch of app', function (done) {
      this.timeout(120000)
      const appPath = path.join(fixturesPath, 'api', 'singleton')
      const first = cp.spawn(process.execPath, [appPath])
      first.once('exit', code => {
        expect(code).to.equal(0)
      })
      // Start second app when received output.
      first.stdout.once('data', () => {
        const second = cp.spawn(process.execPath, [appPath])
        second.once('exit', code => {
          expect(code).to.equal(1)
          done()
        })
      })
    })

    it('passes arguments to the second-instance event', async () => {
      const appPath = path.join(fixturesPath, 'api', 'singleton')
      const first = cp.spawn(process.execPath, [appPath])
      const firstExited = emittedOnce(first, 'exit')

      // Wait for the first app to boot.
      const firstStdoutLines = first.stdout.pipe(split())
      while ((await emittedOnce(firstStdoutLines, 'data')).toString() !== 'started') {
        // wait.
      }
      const data2Promise = emittedOnce(firstStdoutLines, 'data')

      const secondInstanceArgs = [process.execPath, appPath, '--some-switch', 'some-arg']
      const second = cp.spawn(secondInstanceArgs[0], secondInstanceArgs.slice(1))
      const [code2] = await emittedOnce(second, 'exit')
      expect(code2).to.equal(1)
      const [code1] = await firstExited
      expect(code1).to.equal(0)
      const data2 = (await data2Promise)[0].toString('ascii')
      const secondInstanceArgsReceived: string[] = JSON.parse(data2.toString('ascii'))
      const expected = process.platform === 'win32'
        ? [process.execPath, '--some-switch', '--allow-file-access-from-files', secondInstanceArgsReceived.find(x => x.includes('original-process-start-time')), appPath, 'some-arg']
        : secondInstanceArgs
      expect(secondInstanceArgsReceived).to.eql(expected,
        `expected ${JSON.stringify(expected)} but got ${data2.toString('ascii')}`)
    })
  })

  describe('app.relaunch', () => {
    let server: net.Server | null = null
    const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\electron-app-relaunch' : '/tmp/electron-app-relaunch'

    beforeEach(done => {
      fs.unlink(socketPath, () => {
        server = net.createServer()
        server.listen(socketPath)
        done()
      })
    })

    afterEach((done) => {
      server!.close(() => {
        if (process.platform === 'win32') {
          done()
        } else {
          fs.unlink(socketPath, () => done())
        }
      })
    })

    it('relaunches the app', function (done) {
      this.timeout(120000)

      let state = 'none'
      server!.once('error', error => done(error))
      server!.on('connection', client => {
        client.once('data', data => {
          if (String(data) === 'false' && state === 'none') {
            state = 'first-launch'
          } else if (String(data) === 'true' && state === 'first-launch') {
            done()
          } else {
            done(`Unexpected state: ${state}`)
          }
        })
      })

      const appPath = path.join(fixturesPath, 'api', 'relaunch')
      cp.spawn(process.execPath, [appPath])
    })
  })

  describe('app.setUserActivity(type, userInfo)', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('sets the current activity', () => {
      app.setUserActivity('com.electron.testActivity', { testData: '123' })
      expect(app.getCurrentActivityType()).to.equal('com.electron.testActivity')
    })
  })

  // xdescribe('app.importCertificate', () => {
  //   let w = null

  //   before(function () {
  //     if (process.platform !== 'linux') {
  //       this.skip()
  //     }
  //   })

  //   afterEach(() => closeWindow(w).then(() => { w = null }))

  //   it('can import certificate into platform cert store', done => {
  //     const options = {
  //       certificate: path.join(certPath, 'client.p12'),
  //       password: 'electron'
  //     }

  //     w = new BrowserWindow({
  //       show: false,
  //       webPreferences: {
  //         nodeIntegration: true
  //       }
  //     })

  //     w.webContents.on('did-finish-load', () => {
  //       expect(w.webContents.getTitle()).to.equal('authorized')
  //       done()
  //     })

  //     ipcRenderer.once('select-client-certificate', (event, webContentsId, list) => {
  //       expect(webContentsId).to.equal(w.webContents.id)
  //       expect(list).to.have.lengthOf(1)

  //       expect(list[0]).to.deep.equal({
  //         issuerName: 'Intermediate CA',
  //         subjectName: 'Client Cert',
  //         issuer: { commonName: 'Intermediate CA' },
  //         subject: { commonName: 'Client Cert' }
  //       })

  //       event.sender.send('client-certificate-response', list[0])
  //     })

  //     app.importCertificate(options, result => {
  //       expect(result).toNotExist()
  //       ipcRenderer.sendSync('set-client-certificate-option', false)
  //       w.loadURL(secureUrl)
  //     })
  //   })
  // })

  describe('BrowserWindow events', () => {
    let w: BrowserWindow = null as any

    afterEach(() => closeWindow(w).then(() => { w = null as any }))

    it('should emit browser-window-focus event when window is focused', (done) => {
      app.once('browser-window-focus', (e, window) => {
        expect(w.id).to.equal(window.id)
        done()
      })
      w = new BrowserWindow({ show: false })
      w.emit('focus')
    })

    it('should emit browser-window-blur event when window is blured', (done) => {
      app.once('browser-window-blur', (e, window) => {
        expect(w.id).to.equal(window.id)
        done()
      })
      w = new BrowserWindow({ show: false })
      w.emit('blur')
    })

    it('should emit browser-window-created event when window is created', (done) => {
      app.once('browser-window-created', (e, window) => {
        setImmediate(() => {
          expect(w.id).to.equal(window.id)
          done()
        })
      })
      w = new BrowserWindow({ show: false })
    })

    it('should emit web-contents-created event when a webContents is created', (done) => {
      app.once('web-contents-created', (e, webContents) => {
        setImmediate(() => {
          expect(w.webContents.id).to.equal(webContents.id)
          done()
        })
      })
      w = new BrowserWindow({ show: false })
    })

    it('should emit renderer-process-crashed event when renderer crashes', async function() {
      // FIXME: re-enable this test on win32.
      if (process.platform === 'win32')
        return this.skip()
      w = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true
        }
      })
      await w.loadURL('about:blank')

      const promise = emittedOnce(app, 'renderer-process-crashed')
      w.webContents.executeJavaScript('process.crash()')

      const [, webContents] = await promise
      expect(webContents).to.equal(w.webContents)
    })

    ifdescribe(features.isDesktopCapturerEnabled())('desktopCapturer module filtering', () => {
      it('should emit desktop-capturer-get-sources event when desktopCapturer.getSources() is invoked', async () => {
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: true
          }
        })
        await w.loadURL('about:blank')

        const promise = emittedOnce(app, 'desktop-capturer-get-sources')
        w.webContents.executeJavaScript(`require('electron').desktopCapturer.getSources({ types: ['screen'] }, () => {})`)

        const [, webContents] = await promise
        expect(webContents).to.equal(w.webContents)
      })
    })

    describe('remote module filtering', () => {
      it('should emit remote-require event when remote.require() is invoked', async () => {
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: true
          }
        })
        await w.loadURL('about:blank')

        const promise = emittedOnce(app, 'remote-require')
        w.webContents.executeJavaScript(`require('electron').remote.require('test')`)

        const [, webContents, moduleName] = await promise
        expect(webContents).to.equal(w.webContents)
        expect(moduleName).to.equal('test')
      })

      it('should emit remote-get-global event when remote.getGlobal() is invoked', async () => {
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: true
          }
        })
        await w.loadURL('about:blank')

        const promise = emittedOnce(app, 'remote-get-global')
        w.webContents.executeJavaScript(`require('electron').remote.getGlobal('test')`)

        const [, webContents, globalName] = await promise
        expect(webContents).to.equal(w.webContents)
        expect(globalName).to.equal('test')
      })

      it('should emit remote-get-builtin event when remote.getBuiltin() is invoked', async () => {
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: true
          }
        })
        await w.loadURL('about:blank')

        const promise = emittedOnce(app, 'remote-get-builtin')
        w.webContents.executeJavaScript(`require('electron').remote.app`)

        const [, webContents, moduleName] = await promise
        expect(webContents).to.equal(w.webContents)
        expect(moduleName).to.equal('app')
      })

      it('should emit remote-get-current-window event when remote.getCurrentWindow() is invoked', async () => {
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: true
          }
        })
        await w.loadURL('about:blank')

        const promise = emittedOnce(app, 'remote-get-current-window')
        w.webContents.executeJavaScript(`require('electron').remote.getCurrentWindow()`)

        const [, webContents] = await promise
        expect(webContents).to.equal(w.webContents)
      })

      it('should emit remote-get-current-web-contents event when remote.getCurrentWebContents() is invoked', async () => {
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: true
          }
        })
        await w.loadURL('about:blank')

        const promise = emittedOnce(app, 'remote-get-current-web-contents')
        w.webContents.executeJavaScript(`require('electron').remote.getCurrentWebContents()`)

        const [, webContents] = await promise
        expect(webContents).to.equal(w.webContents)
      })
    })
  })

  describe('app.setBadgeCount', () => {
    const platformIsNotSupported =
        (process.platform === 'win32') ||
        (process.platform === 'linux' && !app.isUnityRunning())
    const platformIsSupported = !platformIsNotSupported

    const expectedBadgeCount = 42
    let returnValue: boolean | null = null

    beforeEach(() => { returnValue = app.setBadgeCount(expectedBadgeCount) })

    after(() => {
      // Remove the badge.
      app.setBadgeCount(0)
    })

    describe('on supported platform', () => {
      before(function () {
        if (platformIsNotSupported) {
          this.skip()
        }
      })

      it('returns true', () => {
        expect(returnValue).to.equal(true)
      })

      it('sets a badge count', () => {
        expect(app.getBadgeCount()).to.equal(expectedBadgeCount)
      })
    })

    describe('on unsupported platform', () => {
      before(function () {
        if (platformIsSupported) {
          this.skip()
        }
      })

      it('returns false', () => {
        expect(returnValue).to.equal(false)
      })

      it('does not set a badge count', () => {
        expect(app.getBadgeCount()).to.equal(0)
      })
    })
  })

  describe('app.get/setLoginItemSettings API', function () {
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe')
    const processStartArgs = [
      '--processStart', `"${path.basename(process.execPath)}"`,
      '--process-start-args', `"--hidden"`
    ]

    before(function () {
      if (process.platform === 'linux' || process.mas) this.skip()
    })

    beforeEach(() => {
      app.setLoginItemSettings({ openAtLogin: false })
      app.setLoginItemSettings({ openAtLogin: false, path: updateExe, args: processStartArgs })
    })

    afterEach(() => {
      app.setLoginItemSettings({ openAtLogin: false })
      app.setLoginItemSettings({ openAtLogin: false, path: updateExe, args: processStartArgs })
    })

    it('sets and returns the app as a login item', done => {
      app.setLoginItemSettings({ openAtLogin: true })
      expect(app.getLoginItemSettings()).to.deep.equal({
        openAtLogin: true,
        openAsHidden: false,
        wasOpenedAtLogin: false,
        wasOpenedAsHidden: false,
        restoreState: false
      })
      done()
    })

    it('adds a login item that loads in hidden mode', done => {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
      expect(app.getLoginItemSettings()).to.deep.equal({
        openAtLogin: true,
        openAsHidden: process.platform === 'darwin' && !process.mas, // Only available on macOS
        wasOpenedAtLogin: false,
        wasOpenedAsHidden: false,
        restoreState: false
      })
      done()
    })

    it('correctly sets and unsets the LoginItem', function () {
      expect(app.getLoginItemSettings().openAtLogin).to.equal(false)

      app.setLoginItemSettings({ openAtLogin: true })
      expect(app.getLoginItemSettings().openAtLogin).to.equal(true)

      app.setLoginItemSettings({ openAtLogin: false })
      expect(app.getLoginItemSettings().openAtLogin).to.equal(false)
    })

    it('correctly sets and unsets the LoginItem as hidden', function () {
      if (process.platform !== 'darwin') this.skip()

      expect(app.getLoginItemSettings().openAtLogin).to.equal(false)
      expect(app.getLoginItemSettings().openAsHidden).to.equal(false)

      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
      expect(app.getLoginItemSettings().openAtLogin).to.equal(true)
      expect(app.getLoginItemSettings().openAsHidden).to.equal(true)

      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false })
      expect(app.getLoginItemSettings().openAtLogin).to.equal(true)
      expect(app.getLoginItemSettings().openAsHidden).to.equal(false)
    })

    it('allows you to pass a custom executable and arguments', function () {
      if (process.platform !== 'win32') this.skip()

      app.setLoginItemSettings({ openAtLogin: true, path: updateExe, args: processStartArgs })

      expect(app.getLoginItemSettings().openAtLogin).to.equal(false)
      expect(app.getLoginItemSettings({
        path: updateExe,
        args: processStartArgs
      }).openAtLogin).to.equal(true)
    })
  })

  describe('accessibilitySupportEnabled property', () => {
    if (process.platform === 'linux') return

    it('returns whether the Chrome has accessibility APIs enabled', () => {
      expect(app.accessibilitySupportEnabled).to.be.a('boolean')

      //TODO(codebytere): remove when propertyification is complete
      expect(app.isAccessibilitySupportEnabled).to.be.a('function')
      expect(app.setAccessibilitySupportEnabled).to.be.a('function')
    })
  })

  describe('getAppPath', () => {
    it('works for directories with package.json', async () => {
      const { appPath } = await runTestApp('app-path')
      expect(appPath).to.equal(path.resolve(fixturesPath, 'api/app-path'))
    })

    it('works for directories with index.js', async () => {
      const { appPath } = await runTestApp('app-path/lib')
      expect(appPath).to.equal(path.resolve(fixturesPath, 'api/app-path/lib'))
    })

    it('works for files without extension', async () => {
      const { appPath } = await runTestApp('app-path/lib/index')
      expect(appPath).to.equal(path.resolve(fixturesPath, 'api/app-path/lib'))
    })

    it('works for files', async () => {
      const { appPath } = await runTestApp('app-path/lib/index.js')
      expect(appPath).to.equal(path.resolve(fixturesPath, 'api/app-path/lib'))
    })
  })

  describe('getPath(name)', () => {
    it('returns paths that exist', () => {
      const paths = [
        fs.existsSync(app.getPath('exe')),
        fs.existsSync(app.getPath('home')),
        fs.existsSync(app.getPath('temp'))
      ]
      expect(paths).to.deep.equal([true, true, true])
    })

    it('throws an error when the name is invalid', () => {
      expect(() => {
        app.getPath('does-not-exist')
      }).to.throw(/Failed to get 'does-not-exist' path/)
    })

    it('returns the overridden path', () => {
      app.setPath('music', __dirname)
      expect(app.getPath('music')).to.equal(__dirname)
    })
  })

  describe('setPath(name, path)', () => {
    it('does not create a new directory by default', () => {
      const badPath = path.join(__dirname, 'music')

      expect(fs.existsSync(badPath)).to.be.false
      app.setPath('music', badPath)
      expect(fs.existsSync(badPath)).to.be.false

      expect(() => { app.getPath(badPath) }).to.throw()
    })
  })

  describe('select-client-certificate event', () => {
    let w: BrowserWindow

    before(function () {
      if (process.platform === 'linux') {
        this.skip()
      }
    })

    beforeEach(() => {
      w = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          partition: 'empty-certificate'
        }
      })
    })

    afterEach(() => closeWindow(w).then(() => { w = null as any }))

    it('can respond with empty certificate list', async () => {
      app.once('select-client-certificate', function (event, webContents, url, list, callback) {
        console.log('select-client-certificate emitted')
        event.preventDefault()
        callback()
      })
      await w.webContents.loadURL(secureUrl)
      expect(w.webContents.getTitle()).to.equal('denied')
    })
  })

  describe('setAsDefaultProtocolClient(protocol, path, args)', () => {
    const protocol = 'electron-test'
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe')
    const processStartArgs = [
      '--processStart', `"${path.basename(process.execPath)}"`,
      '--process-start-args', `"--hidden"`
    ]

    let Winreg: any
    let classesKey: any

    before(function () {
      if (process.platform !== 'win32') {
        this.skip()
      } else {
        Winreg = require('winreg')

        classesKey = new Winreg({
          hive: Winreg.HKCU,
          key: '\\Software\\Classes\\'
        })
      }
    })

    after(function (done) {
      if (process.platform !== 'win32') {
        done()
      } else {
        const protocolKey = new Winreg({
          hive: Winreg.HKCU,
          key: `\\Software\\Classes\\${protocol}`
        })

        // The last test leaves the registry dirty,
        // delete the protocol key for those of us who test at home
        protocolKey.destroy(() => done())
      }
    })

    beforeEach(() => {
      app.removeAsDefaultProtocolClient(protocol)
      app.removeAsDefaultProtocolClient(protocol, updateExe, processStartArgs)
    })

    afterEach(() => {
      app.removeAsDefaultProtocolClient(protocol)
      expect(app.isDefaultProtocolClient(protocol)).to.equal(false)

      app.removeAsDefaultProtocolClient(protocol, updateExe, processStartArgs)
      expect(app.isDefaultProtocolClient(protocol, updateExe, processStartArgs)).to.equal(false)
    })

    it('sets the app as the default protocol client', () => {
      expect(app.isDefaultProtocolClient(protocol)).to.equal(false)
      app.setAsDefaultProtocolClient(protocol)
      expect(app.isDefaultProtocolClient(protocol)).to.equal(true)
    })

    it('allows a custom path and args to be specified', () => {
      expect(app.isDefaultProtocolClient(protocol, updateExe, processStartArgs)).to.equal(false)
      app.setAsDefaultProtocolClient(protocol, updateExe, processStartArgs)

      expect(app.isDefaultProtocolClient(protocol, updateExe, processStartArgs)).to.equal(true)
      expect(app.isDefaultProtocolClient(protocol)).to.equal(false)
    })

    it('creates a registry entry for the protocol class', (done) => {
      app.setAsDefaultProtocolClient(protocol)

      classesKey.keys((error: Error, keys: any[]) => {
        if (error) throw error

        const exists = !!keys.find(key => key.key.includes(protocol))
        expect(exists).to.equal(true)

        done()
      })
    })

    it('completely removes a registry entry for the protocol class', (done) => {
      app.setAsDefaultProtocolClient(protocol)
      app.removeAsDefaultProtocolClient(protocol)

      classesKey.keys((error: Error, keys: any[]) => {
        if (error) throw error

        const exists = !!keys.find(key => key.key.includes(protocol))
        expect(exists).to.equal(false)

        done()
      })
    })

    it('only unsets a class registry key if it contains other data', (done) => {
      app.setAsDefaultProtocolClient(protocol)

      const protocolKey = new Winreg({
        hive: Winreg.HKCU,
        key: `\\Software\\Classes\\${protocol}`
      })

      protocolKey.set('test-value', 'REG_BINARY', '123', () => {
        app.removeAsDefaultProtocolClient(protocol)

        classesKey.keys((error: Error, keys: any[]) => {
          if (error) throw error

          const exists = !!keys.find(key => key.key.includes(protocol))
          expect(exists).to.equal(true)

          done()
        })
      })
    })
  })

  describe('app launch through uri', () => {
    before(function () {
      if (process.platform !== 'win32') {
        this.skip()
      }
    })

    it('does not launch for argument following a URL', done => {
      const appPath = path.join(fixturesPath, 'api', 'quit-app')
      // App should exit with non 123 code.
      const first = cp.spawn(process.execPath, [appPath, 'electron-test:?', 'abc'])
      first.once('exit', code => {
        expect(code).to.not.equal(123)
        done()
      })
    })

    it('launches successfully for argument following a file path', done => {
      const appPath = path.join(fixturesPath, 'api', 'quit-app')
      // App should exit with code 123.
      const first = cp.spawn(process.execPath, [appPath, 'e:\\abc', 'abc'])
      first.once('exit', code => {
        expect(code).to.equal(123)
        done()
      })
    })

    it('launches successfully for multiple URIs following --', done => {
      const appPath = path.join(fixturesPath, 'api', 'quit-app')
      // App should exit with code 123.
      const first = cp.spawn(process.execPath, [appPath, '--', 'http://electronjs.org', 'electron-test://testdata'])
      first.once('exit', code => {
        expect(code).to.equal(123)
        done()
      })
    })
  })

  describe('getFileIcon() API', () => {
    const iconPath = path.join(__dirname, 'fixtures/assets/icon.ico')
    const sizes = {
      small: 16,
      normal: 32,
      large: process.platform === 'win32' ? 32 : 48
    }

    // (alexeykuzmin): `.skip()` called in `before`
    // doesn't affect nested `describe`s.
    beforeEach(function () {
      // FIXME Get these specs running on Linux CI
      if (process.platform === 'linux' && isCI) {
        this.skip()
      }
    })

    it('fetches a non-empty icon', async () => {
      const icon = await app.getFileIcon(iconPath)
      expect(icon.isEmpty()).to.equal(false)
    })

    // TODO(codebytere): remove when promisification is complete
    it('fetches a non-empty icon (callback)', (done) => {
      app.getFileIcon(iconPath, (error, icon) => {
        expect(error).to.equal(null)
        expect(icon.isEmpty()).to.equal(false)
        done()
      })
    })

    it('fetches normal icon size by default', async () => {
      const icon = await app.getFileIcon(iconPath)
      const size = icon.getSize()

      expect(size.height).to.equal(sizes.normal)
      expect(size.width).to.equal(sizes.normal)
    })

    // TODO(codebytere): remove when promisification is complete
    it('fetches normal icon size by default (callback)', (done) => {
      app.getFileIcon(iconPath, (error, icon) => {
        expect(error).to.equal(null)
        const size = icon.getSize()

        expect(size.height).to.equal(sizes.normal)
        expect(size.width).to.equal(sizes.normal)
        done()
      })
    })

    describe('size option', () => {
      it('fetches a small icon', async () => {
        const icon = await app.getFileIcon(iconPath, { size: 'small' })
        const size = icon.getSize()

        expect(size.height).to.equal(sizes.small)
        expect(size.width).to.equal(sizes.small)
      })

      it('fetches a normal icon', async () => {
        const icon = await app.getFileIcon(iconPath, { size: 'normal' })
        const size = icon.getSize()

        expect(size.height).to.equal(sizes.normal)
        expect(size.width).to.equal(sizes.normal)
      })

      // TODO(codebytere): remove when promisification is complete
      it('fetches a normal icon (callback)', (done) => {
        app.getFileIcon(iconPath, { size: 'normal' }, (error, icon) => {
          expect(error).to.equal(null)
          const size = icon.getSize()

          expect(size.height).to.equal(sizes.normal)
          expect(size.width).to.equal(sizes.normal)
          done()
        })
      })

      it('fetches a large icon', async () => {
        // macOS does not support large icons
        if (process.platform === 'darwin') return

        const icon = await app.getFileIcon(iconPath, { size: 'large' })
        const size = icon.getSize()

        expect(size.height).to.equal(sizes.large)
        expect(size.width).to.equal(sizes.large)
      })
    })
  })

  describe('getAppMetrics() API', () => {
    it('returns memory and cpu stats of all running electron processes', () => {
      const appMetrics = app.getAppMetrics()
      expect(appMetrics).to.be.an('array').and.have.lengthOf.at.least(1, 'App memory info object is not > 0')

      const types = []
      for (const { pid, type, cpu } of appMetrics) {
        expect(pid).to.be.above(0, 'pid is not > 0')
        expect(type).to.be.a('string').that.does.not.equal('')

        types.push(type)
        expect(cpu).to.have.ownProperty('percentCPUUsage').that.is.a('number')
        expect(cpu).to.have.ownProperty('idleWakeupsPerSecond').that.is.a('number')
      }

      if (process.platform === 'darwin') {
        expect(types).to.include('GPU')
      }

      expect(types).to.include('Browser')
    })
  })

  describe('getGPUFeatureStatus() API', () => {
    it('returns the graphic features statuses', () => {
      const features = app.getGPUFeatureStatus()
      expect(features).to.have.ownProperty('webgl').that.is.a('string')
      expect(features).to.have.ownProperty('gpu_compositing').that.is.a('string')
    })
  })

  describe('getGPUInfo() API', () => {
    const appPath = path.join(fixturesPath, 'api', 'gpu-info.js')

    const getGPUInfo = async (type: string) => {
      const appProcess = cp.spawn(process.execPath, [appPath, type])
      let gpuInfoData = ''
      let errorData = ''
      appProcess.stdout.on('data', (data) => {
        gpuInfoData += data
      })
      appProcess.stderr.on('data', (data) => {
        errorData += data
      })
      const [exitCode] = await emittedOnce(appProcess, 'exit')
      if (exitCode === 0) {
        // return info data on successful exit
        return JSON.parse(gpuInfoData)
      } else {
        // return error if not clean exit
        console.log('Error getting GPU INFO, exit code is:', exitCode)
        console.log('Error getting GPU INFO', errorData)
        console.log('GPU data: ', gpuInfoData)
        return Promise.reject(new Error(errorData))
      }
    }
    const verifyBasicGPUInfo = async (gpuInfo: any) => {
      // Devices information is always present in the available info.
      expect(gpuInfo).to.have.ownProperty('gpuDevice')
        .that.is.an('array')
        .and.does.not.equal([])

      const device = gpuInfo.gpuDevice[0]
      expect(device).to.be.an('object')
        .and.to.have.property('deviceId')
        .that.is.a('number')
        .not.lessThan(0)
    }

    it('succeeds with basic GPUInfo', async () => {
      const gpuInfo = await getGPUInfo('basic')
      await verifyBasicGPUInfo(gpuInfo)
    })

    it('succeeds with complete GPUInfo', async () => {
      const completeInfo = await getGPUInfo('complete')
      if (process.platform === 'linux') {
        // For linux and macOS complete info is same as basic info
        await verifyBasicGPUInfo(completeInfo)
        const basicInfo = await getGPUInfo('basic')
        expect(completeInfo).to.deep.equal(basicInfo)
      } else {
        // Gl version is present in the complete info.
        expect(completeInfo).to.have.ownProperty('auxAttributes')
          .that.is.an('object')
        expect(completeInfo.auxAttributes).to.have.ownProperty('glVersion')
          .that.is.a('string')
          .and.does.not.equal([])
      }
    })

    it('fails for invalid info_type', () => {
      const invalidType = 'invalid'
      const expectedErrorMessage = "Invalid info type. Use 'basic' or 'complete'"
      return expect(app.getGPUInfo(invalidType)).to.eventually.be.rejectedWith(expectedErrorMessage)
    })
  })

  describe('sandbox options', () => {
    let appProcess: cp.ChildProcess = null as any
    let server: net.Server = null as any
    const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\electron-mixed-sandbox' : '/tmp/electron-mixed-sandbox'

    beforeEach(function (done) {
      if (process.platform === 'linux' && (process.arch === 'arm64' || process.arch === 'arm')) {
        // Our ARM tests are run on VSTS rather than CircleCI, and the Docker
        // setup on VSTS disallows syscalls that Chrome requires for setting up
        // sandboxing.
        // See:
        // - https://docs.docker.com/engine/security/seccomp/#significant-syscalls-blocked-by-the-default-profile
        // - https://chromium.googlesource.com/chromium/src/+/70.0.3538.124/sandbox/linux/services/credentials.cc#292
        // - https://github.com/docker/docker-ce/blob/ba7dfc59ccfe97c79ee0d1379894b35417b40bca/components/engine/profiles/seccomp/seccomp_default.go#L497
        // - https://blog.jessfraz.com/post/how-to-use-new-docker-seccomp-profiles/
        //
        // Adding `--cap-add SYS_ADMIN` or `--security-opt seccomp=unconfined`
        // to the Docker invocation allows the syscalls that Chrome needs, but
        // are probably more permissive than we'd like.
        this.skip()
      }
      fs.unlink(socketPath, () => {
        server = net.createServer()
        server.listen(socketPath)
        done()
      })
    })

    afterEach(done => {
      if (appProcess != null) appProcess.kill()

      server.close(() => {
        if (process.platform === 'win32') {
          done()
        } else {
          fs.unlink(socketPath, () => done())
        }
      })
    })

    describe('when app.enableSandbox() is called', () => {
      it('adds --enable-sandbox to all renderer processes', done => {
        const appPath = path.join(fixturesPath, 'api', 'mixed-sandbox-app')
        appProcess = cp.spawn(process.execPath, [appPath, '--app-enable-sandbox'])

        server.once('error', error => { done(error) })

        server.on('connection', client => {
          client.once('data', (data) => {
            const argv = JSON.parse(data.toString())
            expect(argv.sandbox).to.include('--enable-sandbox')
            expect(argv.sandbox).to.not.include('--no-sandbox')

            expect(argv.noSandbox).to.include('--enable-sandbox')
            expect(argv.noSandbox).to.not.include('--no-sandbox')

            expect(argv.noSandboxDevtools).to.equal(true)
            expect(argv.sandboxDevtools).to.equal(true)

            done()
          })
        })
      })
    })

    describe('when the app is launched with --enable-sandbox', () => {
      it('adds --enable-sandbox to all renderer processes', done => {
        const appPath = path.join(fixturesPath, 'api', 'mixed-sandbox-app')
        appProcess = cp.spawn(process.execPath, [appPath, '--enable-sandbox'])

        server.once('error', error => { done(error) })

        server.on('connection', client => {
          client.once('data', data => {
            const argv = JSON.parse(data.toString())
            expect(argv.sandbox).to.include('--enable-sandbox')
            expect(argv.sandbox).to.not.include('--no-sandbox')

            expect(argv.noSandbox).to.include('--enable-sandbox')
            expect(argv.noSandbox).to.not.include('--no-sandbox')

            expect(argv.noSandboxDevtools).to.equal(true)
            expect(argv.sandboxDevtools).to.equal(true)

            done()
          })
        })
      })
    })
  })

  describe('disableDomainBlockingFor3DAPIs() API', () => {
    it('throws when called after app is ready', () => {
      expect(() => {
        app.disableDomainBlockingFor3DAPIs()
      }).to.throw(/before app is ready/)
    })
  })

  const dockDescribe = process.platform === 'darwin' ? describe : describe.skip
  dockDescribe('dock APIs', () => {
    after(async () => {
      await app.dock.show()
    })

    describe('dock.setMenu', () => {
      it('can be retrieved via dock.getMenu', () => {
        expect(app.dock.getMenu()).to.equal(null)
        const menu = new Menu()
        app.dock.setMenu(menu)
        expect(app.dock.getMenu()).to.equal(menu)
      })

      it('keeps references to the menu', () => {
        app.dock.setMenu(new Menu())
        const v8Util = process.electronBinding('v8_util')
        v8Util.requestGarbageCollectionForTesting()
      })
    })

    describe('dock.bounce', () => {
      it('should return -1 for unknown bounce type', () => {
        expect(app.dock.bounce('bad type' as any)).to.equal(-1)
      })

      it('should return a positive number for informational type', () => {
        const appHasFocus = !!BrowserWindow.getFocusedWindow()
        if (!appHasFocus) {
          expect(app.dock.bounce('informational')).to.be.at.least(0)
        }
      })

      it('should return a positive number for critical type', () => {
        const appHasFocus = !!BrowserWindow.getFocusedWindow()
        if (!appHasFocus) {
          expect(app.dock.bounce('critical')).to.be.at.least(0)
        }
      })
    })

    describe('dock.cancelBounce', () => {
      it('should not throw', () => {
        app.dock.cancelBounce(app.dock.bounce('critical'))
      })
    })

    describe('dock.setBadge', () => {
      after(() => {
        app.dock.setBadge('')
      })

      it('should not throw', () => {
        app.dock.setBadge('1')
      })

      it('should be retrievable via getBadge', () => {
        app.dock.setBadge('test')
        expect(app.dock.getBadge()).to.equal('test')
      })
    })

    describe('dock.show', () => {
      it('should not throw', () => {
        return app.dock.show().then(() => {
          expect(app.dock.isVisible()).to.equal(true)
        })
      })

      it('returns a Promise', () => {
        expect(app.dock.show()).to.be.a('promise')
      })

      it('eventually fulfills', async () => {
        await expect(app.dock.show()).to.eventually.be.fulfilled.equal(undefined)
      })
    })

    describe('dock.hide', () => {
      it('should not throw', () => {
        app.dock.hide()
        expect(app.dock.isVisible()).to.equal(false)
      })
    })
  })

  describe('whenReady', () => {
    it('returns a Promise', () => {
      expect(app.whenReady()).to.be.a('promise')
    })

    it('becomes fulfilled if the app is already ready', async () => {
      expect(app.isReady()).to.equal(true)
      await expect(app.whenReady()).to.be.eventually.fulfilled.equal(undefined)
    })
  })

  describe('app.applicationMenu', () => {
    it('has the applicationMenu property', () => {
      expect(app).to.have.property('applicationMenu')
    })
  })

  describe('commandLine.hasSwitch', () => {
    it('returns true when present', () => {
      app.commandLine.appendSwitch('foobar1')
      expect(app.commandLine.hasSwitch('foobar1')).to.equal(true)
    })

    it('returns false when not present', () => {
      expect(app.commandLine.hasSwitch('foobar2')).to.equal(false)
    })
  })

  describe('commandLine.hasSwitch (existing argv)', () => {
    it('returns true when present', async () => {
      const { hasSwitch } = await runTestApp('command-line', '--foobar')
      expect(hasSwitch).to.equal(true)
    })

    it('returns false when not present', async () => {
      const { hasSwitch } = await runTestApp('command-line')
      expect(hasSwitch).to.equal(false)
    })
  })

  describe('commandLine.getSwitchValue', () => {
    it('returns the value when present', () => {
      app.commandLine.appendSwitch('foobar', 'æøåü')
      expect(app.commandLine.getSwitchValue('foobar')).to.equal('æøåü')
    })

    it('returns an empty string when present without value', () => {
      app.commandLine.appendSwitch('foobar1')
      expect(app.commandLine.getSwitchValue('foobar1')).to.equal('')
    })

    it('returns an empty string when not present', () => {
      expect(app.commandLine.getSwitchValue('foobar2')).to.equal('')
    })
  })

  describe('commandLine.getSwitchValue (existing argv)', () => {
    it('returns the value when present', async () => {
      const { getSwitchValue } = await runTestApp('command-line', '--foobar=test')
      expect(getSwitchValue).to.equal('test')
    })

    it('returns an empty string when present without value', async () => {
      const { getSwitchValue } = await runTestApp('command-line', '--foobar')
      expect(getSwitchValue).to.equal('')
    })

    it('returns an empty string when not present', async () => {
      const { getSwitchValue } = await runTestApp('command-line')
      expect(getSwitchValue).to.equal('')
    })
  })
})

describe('default behavior', () => {
  describe('application menu', () => {
    it('creates the default menu if the app does not set it', async () => {
      const result = await runTestApp('default-menu')
      expect(result).to.equal(false)
    })

    it('does not create the default menu if the app sets a custom menu', async () => {
      const result = await runTestApp('default-menu', '--custom-menu')
      expect(result).to.equal(true)
    })

    it('does not create the default menu if the app sets a null menu', async () => {
      const result = await runTestApp('default-menu', '--null-menu')
      expect(result).to.equal(true)
    })
  })

  describe('window-all-closed', () => {
    it('quits when the app does not handle the event', async () => {
      const result = await runTestApp('window-all-closed')
      expect(result).to.equal(false)
    })

    it('does not quit when the app handles the event', async () => {
      const result = await runTestApp('window-all-closed', '--handle-event')
      expect(result).to.equal(true)
    })
  })

  describe('user agent fallback', () => {
    let initialValue: string

    before(() => {
      initialValue = app.userAgentFallback!
    })

    it('should have a reasonable default', () => {
      expect(initialValue).to.include(`Electron/${process.versions.electron}`)
      expect(initialValue).to.include(`Chrome/${process.versions.chrome}`)
    })

    it('should be overridable', () => {
      app.userAgentFallback = 'test-agent/123'
      expect(app.userAgentFallback).to.equal('test-agent/123')
    })

    it('should be restorable', () => {
      app.userAgentFallback = 'test-agent/123'
      app.userAgentFallback = ''
      expect(app.userAgentFallback).to.equal(initialValue)
    })
  })

  describe('app.allowRendererProcessReuse', () => {
    it('should default to false', () => {
      expect(app.allowRendererProcessReuse).to.equal(false)
    })

    it('should cause renderer processes to get new PIDs when false', async () => {
      const output = await runTestApp('site-instance-overrides', 'false')
      expect(output[0]).to.be.a('number').that.is.greaterThan(0)
      expect(output[1]).to.be.a('number').that.is.greaterThan(0)
      expect(output[0]).to.not.equal(output[1])
    })

    it('should cause renderer processes to keep the same PID when true', async () => {
      const output = await runTestApp('site-instance-overrides', 'true')
      expect(output[0]).to.be.a('number').that.is.greaterThan(0)
      expect(output[1]).to.be.a('number').that.is.greaterThan(0)
      expect(output[0]).to.equal(output[1])
    })
  })
})

async function runTestApp (name: string, ...args: any[]) {
  const appPath = path.join(fixturesPath, 'api', name)
  const electronPath = process.execPath
  const appProcess = cp.spawn(electronPath, [appPath, ...args])

  let output = ''
  appProcess.stdout.on('data', (data) => { output += data })

  await emittedOnce(appProcess.stdout, 'end')

  return JSON.parse(output)
}
