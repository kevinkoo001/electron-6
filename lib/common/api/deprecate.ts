let deprecationHandler: ElectronInternal.DeprecationHandler | null = null

function warnOnce (oldName: string, newName?: string) {
  let warned = false
  const msg = newName
    ? `'${oldName}' is deprecated and will be removed. Please use '${newName}' instead.`
    : `'${oldName}' is deprecated and will be removed.`
  return () => {
    if (!warned && !process.noDeprecation) {
      warned = true
      deprecate.log(msg)
    }
  }
}

const deprecate: ElectronInternal.DeprecationUtil = {
  setHandler: (handler) => { deprecationHandler = handler },
  getHandler: () => deprecationHandler,
  warn: (oldName, newName) => {
    if (!process.noDeprecation) {
      deprecate.log(`'${oldName}' is deprecated. Use '${newName}' instead.`)
    }
  },
  log: (message) => {
    if (typeof deprecationHandler === 'function') {
      deprecationHandler(message)
    } else if (process.throwDeprecation) {
      throw new Error(message)
    } else if (process.traceDeprecation) {
      return console.trace(message)
    } else {
      return console.warn(`(electron) ${message}`)
    }
  },

  // remove a function with no replacement
  removeFunction: (fn, removedName) => {
    if (!fn) { throw Error(`'${removedName} function' is invalid or does not exist.`) }

    // wrap the deprecated function to warn user
    const warn = warnOnce(`${fn.name} function`)
    return function (this: any) {
      warn()
      fn.apply(this, arguments)
    }
  },

  // change the name of a function
  renameFunction: (fn, newName) => {
    const warn = warnOnce(`${fn.name} function`, `${newName} function`)
    return function (this: any) {
      warn()
      fn.apply(this, arguments)
    }
  },

  // change the name of an event
  event: (emitter, oldName, newName) => {
    const warn = newName.startsWith('-') /* internal event */
      ? warnOnce(`${oldName} event`)
      : warnOnce(`${oldName} event`, `${newName} event`)
    return emitter.on(newName, function (this: NodeJS.EventEmitter, ...args) {
      if (this.listenerCount(oldName) !== 0) {
        warn()
        this.emit(oldName, ...args)
      }
    })
  },

  // deprecate a getter/setter function pair in favor of a property
  fnToProperty: (module: any, prop: string, getter: string, setter: string) => {
    const withWarnOnce = (obj: any, key: any, oldName: string, newName: string) => {
      const warn = warnOnce(oldName, newName)
      return (...args: any) => {
        warn()
        return obj[key](...args)
      }
    }

    module[getter.substr(1)] = withWarnOnce(module, getter, `${getter.substr(1)} function`, `${prop} property`)
    module[setter.substr(1)] = withWarnOnce(module, setter, `${setter.substr(1)} function`, `${prop} property`)
  },

  // remove a property with no replacement
  removeProperty: (o, removedName) => {
    // if the property's already been removed, warn about it
    if (!(removedName in o)) {
      deprecate.log(`Unable to remove property '${removedName}' from an object that lacks it.`)
    }

    // wrap the deprecated property in an accessor to warn
    const warn = warnOnce(removedName)
    let val = o[removedName]
    return Object.defineProperty(o, removedName, {
      configurable: true,
      get: () => {
        warn()
        return val
      },
      set: newVal => {
        warn()
        val = newVal
      }
    })
  },

  // deprecate a callback-based function in favor of one returning a Promise
  promisify: <T extends (...args: any[]) => any>(fn: T): T => {
    const fnName = fn.name || 'function'
    const oldName = `${fnName} with callbacks`
    const newName = `${fnName} with Promises`
    const warn = warnOnce(oldName, newName)

    return function (this: any, ...params: any[]) {
      let cb: Function | undefined
      if (params.length > 0 && typeof params[params.length - 1] === 'function') {
        cb = params.pop()
      }
      const promise = fn.apply(this, params)
      if (!cb) return promise
      if (process.enablePromiseAPIs) warn()
      return promise
        .then((res: any) => {
          process.nextTick(() => {
            cb!.length === 2 ? cb!(null, res) : cb!(res)
          })
          return res
        }, (err: Error) => {
          process.nextTick(() => {
            cb!.length === 2 ? cb!(err) : cb!()
          })
          throw err
        })
    } as T
  },

  // deprecate a callback-based function in favor of one returning a Promise
  promisifyMultiArg: <T extends (...args: any[]) => any>(fn: T, convertPromiseValue?: (v: any) => any): T => {
    const fnName = fn.name || 'function'
    const oldName = `${fnName} with callbacks`
    const newName = `${fnName} with Promises`
    const warn = warnOnce(oldName, newName)

    return function (this: any, ...params) {
      let cb: Function | undefined
      if (params.length > 0 && typeof params[params.length - 1] === 'function') {
        cb = params.pop()
      }
      const promise = fn.apply(this, params)
      if (!cb) return promise
      if (process.enablePromiseAPIs) warn()
      return promise
        .then((res: any) => {
          if (convertPromiseValue) { res = convertPromiseValue(res) }
          process.nextTick(() => {
            // eslint-disable-next-line standard/no-callback-literal
            cb!.length > 2 ? cb!(null, ...res) : cb!(...res)
          })
        }, (err: Error) => {
          process.nextTick(() => cb!(err))
        })
    } as T
  },

  // change the name of a property
  renameProperty: (o, oldName, newName) => {
    const warn = warnOnce(oldName, newName)

    // if the new property isn't there yet,
    // inject it and warn about it
    if ((oldName in o) && !(newName in o)) {
      warn()
      o[newName] = (o as any)[oldName]
    }

    // wrap the deprecated property in an accessor to warn
    // and redirect to the new property
    return Object.defineProperty(o, oldName, {
      get: () => {
        warn()
        return o[newName]
      },
      set: value => {
        warn()
        o[newName] = value
      }
    })
  }
}

export default deprecate
