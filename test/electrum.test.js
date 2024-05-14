
const test = require('brittle')
const assert = require('assert')
const Electrum = require('../src/electrum.js')
const { WalletStoreMemory } = require('../../wallet-store/src/wallet-store.js')

async function newElectrum(config = {}) {
  config.host = 'localhost' || config.host
  config.port = '8001' || config.port
  const e = new Electrum(config)
  await e.connect()
  return e 
}

test('electrum', async function(t) {

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
