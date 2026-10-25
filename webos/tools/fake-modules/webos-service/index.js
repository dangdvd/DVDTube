// A stand-in for the TV's `webos-service` module (the real one talks to the luna bus through
// the native `palmbus` addon). Used by the smoke test and the unit tests: service.js is started
// with `NODE_PATH=webos/tools/fake-modules` and `child_process.fork`, and luna calls arrive over
// the IPC channel:
//
//   parent → service  { type: 'call', id, method, payload }      (payload.subscribe = subscription)
//   parent → service  { type: 'cancel', id }                       (the caller went away)
//   service → parent  { type: 'response', id, payload }
//   service → parent  { type: 'exit', reason }                     (idle timeout, like the real one)
//
// Like the real module, every request holds an "activity" until it is answered (or, for a
// subscription, cancelled), and the process exits FAKE_LUNA_IDLE_SECONDS (default 5) after the
// last activity ended. Plain ES2017 so it runs on Node 8.

'use strict'

let instance = null

function ActivityManager(idleSeconds) {
  this.active = 0
  this.idleSeconds = idleSeconds
  this.timer = null
  this.counter = 0
  this.startTimer()
}

ActivityManager.prototype.startTimer = function () {
  if (this.timer || !(this.idleSeconds > 0)) return
  this.timer = setTimeout(() => {
    if (process.send) process.send({ type: 'exit', reason: 'idle' })
    setTimeout(() => process.exit(0), 50)
  }, this.idleSeconds * 1000)
}

ActivityManager.prototype.stopTimer = function () {
  if (this.timer) clearTimeout(this.timer)
  this.timer = null
}

ActivityManager.prototype.create = function (name, callback) {
  this.active++
  this.stopTimer()
  const activity = { activityId: ++this.counter, name: String(name) }
  if (callback) callback(activity)
  return activity
}

ActivityManager.prototype.complete = function (activity, options, callback) {
  if (typeof options === 'function') callback = options
  if (!activity || activity.completed) return false
  activity.completed = true
  this.active = Math.max(0, this.active - 1)
  if (this.active === 0) this.startTimer()
  if (callback) callback(activity)
  return true
}

function Message(service, id, method, payload) {
  this.service = service
  this.id = id
  this.method = method
  this.category = '/'
  this.payload = payload || {}
  this.isSubscription = !!(payload && payload.subscribe)
  this.uniqueToken = 'fake-' + id
  this.sender = 'com.dangdvd.dvdtube'
  this.activity = null
}

Message.prototype.respond = function (response) {
  if (typeof response !== 'object' || response === null) throw new Error('response must be an object')
  const r = Object.assign({}, response)
  if (r.returnValue === undefined) r.returnValue = !(r.errorCode || r.errorText)
  if (process.send) process.send({ type: 'response', id: this.id, payload: r })
  if (!this.isSubscription) this.service.activityManager.complete(this.activity)
  return true
}

Message.prototype.cancel = function (response) {
  if (!this.isSubscription) return
  const r = Object.assign({}, response || {}, { subscribed: false })
  this.service.endSubscription(this)
  if (process.send) process.send({ type: 'response', id: this.id, payload: Object.assign({ returnValue: true }, r) })
}

function Service(busId, activityManager, options) {
  if (instance) return instance
  instance = this
  this.busId = busId
  this.methods = {}
  this.cancels = {}
  this.subscriptions = {}
  const idle = process.env.FAKE_LUNA_IDLE_SECONDS !== undefined ? parseFloat(process.env.FAKE_LUNA_IDLE_SECONDS) : 5
  this.activityManager = activityManager || new ActivityManager(options && options.idleTimer ? options.idleTimer : idle)
  this.messages = {}
  process.on('message', (msg) => this.onIpc(msg))
}

Service.prototype.register = function (name, request, cancel) {
  this.methods[name] = request
  if (cancel) this.cancels[name] = cancel
  return { on: function () {} }
}

Service.prototype.endSubscription = function (message) {
  if (!this.subscriptions[message.id]) return
  delete this.subscriptions[message.id]
  this.activityManager.complete(message.activity)
  const cancel = this.cancels[message.method]
  if (cancel) cancel(message)
}

Service.prototype.onIpc = function (msg) {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'call') {
    const method = String(msg.method || '').replace(/^\//, '')
    const handler = this.methods[method]
    if (!handler) {
      if (process.send) process.send({ type: 'response', id: msg.id, payload: { returnValue: false, errorCode: -1, errorText: 'Unknown method "' + method + '"' } })
      return
    }
    const message = new Message(this, msg.id, method, msg.payload)
    if (message.isSubscription) {
      if (!this.cancels[method]) {
        message.isSubscription = false
      } else {
        this.subscriptions[msg.id] = message
      }
    }
    this.activityManager.create(method, (activity) => {
      message.activity = activity
      handler(message)
    })
  } else if (msg.type === 'cancel') {
    const message = this.subscriptions[msg.id]
    if (message) this.endSubscription(message)
  }
}

Service.prototype.call = function (uri, args, callback) {
  setTimeout(() => callback && callback({ payload: { returnValue: false, errorText: 'fake bus: ' + uri } }), 0)
}

Service.prototype.subscribe = function (uri) {
  const handlers = {}
  return {
    on: function (event, fn) {
      handlers[event] = fn
    },
    cancel: function () {},
  }
}

module.exports = Service
module.exports.ActivityManager = ActivityManager
