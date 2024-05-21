
const { test, solo } = require('brittle')
const assert = require('assert')
const Electrum = require('../src/electrum.js')
const { WalletStoreMemory } = require('../../wallet-store/src/wallet-store.js')
const { newElectrum, pause } = require('./test-helpers.js')

test('electrum methods', async function(t) {

  const methods = [
    {
      method : 'blockchain.transaction.get',
      params : ['735d835e3ed852bf0c7fd7260da97cbd64fc04b07c259a8285f6817ca0670187', true],
      expected : [ 
        '735d835e3ed852bf0c7fd7260da97cbd64fc04b07c259a8285f6817ca0670187',
        'txid'
      ]
    }
  ] 

  t.test('electrum methods', async function(t) {
    const e = await newElectrum({
      store: new WalletStoreMemory()
    })
    const res = await e.ping()
    t.ok(res === 'pong', 'ping')

    await Promise.all(methods.map(async function(m) {
      const res = await e.rpc(m.method, m.params)
      t.ok(res[m.expected[1]] === m.expected[0], m.method)
    }))
    await e.close()
  })
})

solo('reconnect logic', async function(t) {
  let e = await newElectrum({
    store: new WalletStoreMemory()
  })
  t.ok(e._reconnect_count === 0, 'reconnect count is 0')
  let res = await e.ping()
  t.ok(res === 'pong', 'connected')
  await e.close()
  t.ok(e._reconnect_count === e._max_attempt, 'reconnect count is max attempt after close')
  const realport = e.port
  e.port = '8888'
  let _isIncreasing = false 
  let _reconnectFail = false
  try {
    let lastCount = 0 
    let _count = 0
    let intvl = setInterval(() => {
      t.ok(e._reconnect_count > lastCount, 'reconnect count is increasing '+ e._reconnect_count)
      _isIncreasing = true
      lastCount = e._reconnect_count
      _count++
      if(_count === 2) return clearInterval(intvl)
    }, e._reconnect_interval + 1000)
    await e.connect({ reconnect : true })
  } catch(err) {
    t.ok(e._reconnect_count >= e._max_attempt, 'reconnect count is max attempt')
    t.ok(err.message.includes('ECONNREFUSED'), 'reconnect should failed')
    _reconnectFail = true
  }
  t.ok(_isIncreasing && _reconnectFail, 'catch functions are called') 
  e.port = realport
  await e.connect({ reconnect : true })
  res = await e.ping()
  t.ok(res === 'pong', 'reconnected ping pong')
  await e.close()

})
