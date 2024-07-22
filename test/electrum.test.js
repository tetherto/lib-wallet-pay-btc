const test = require('brittle')
const { WalletStoreMemory } = require('../../wallet-store/')
const { newElectrum } = require('./test-helpers.js')

test('electrum', async function (t) {
  const methods = [
    {
      method: 'blockchain.transaction.get',
      params: ['735d835e3ed852bf0c7fd7260da97cbd64fc04b07c259a8285f6817ca0670187', true],
      expected: [
        '735d835e3ed852bf0c7fd7260da97cbd64fc04b07c259a8285f6817ca0670187',
        'txid'
      ]
    }
  ]

  t.test('electrum methods', async function (t) {
    const e = await newElectrum({
      store: new WalletStoreMemory()
    })
    const res = await e.ping()
    t.ok(res === 'pong', 'ping')

    await Promise.all(methods.map(async function (m) {
      const res = await e.rpc(m.method, m.params)
      console.log(res)
      t.ok(res[m.expected[1]] === m.expected[0], m.method)
    }))
    await e.close()
  })
}) 
