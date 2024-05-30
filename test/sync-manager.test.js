const test = require('brittle')
const {
  KeyManager,
  activeWallet,
  regtestNode,
  pause,
  BitcoinCurrency
} = require('./test-helpers.js')

test.test('Sync Manager', async function (t) {
  t.test('get new address', async function (t) {
    const regtest = await regtestNode({ mine: false })
    const btcPay = await activeWallet()

    await btcPay.syncTransactions()
    const addr = await btcPay.getNewAddress()
    console.log(addr)
    await btcPay.destroy()
  })
})
