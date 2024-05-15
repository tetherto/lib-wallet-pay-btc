
const test = require('brittle')
const { 
  KeyManager,
  activeWallet
} = require('./test-helpers.js')

test.test('sendTransaction', async function(t) {

  t.test('getUtxoForAmount', async function(t) {

    const btcPay = await activeWallet()
    await btcPay.initialize({})

    btcPay.on('sync-end', async () => {
      const amount = {
        amount: 0.1,
        unit: 'main'
      }
      const utxo = btcPay._syncManager.utxoForAmount(amount)

      t.ok(utxo.diff, 'has diff')
      t.ok(utxo.total, 'has total')
      t.ok(utxo.utxo.length > 0, 'has has utxo')

    })
    await btcPay.syncTransactions()
    await btcPay.destroy()
    
  })

  t.test('sendTransaction', async function(t) {
    const btcPay = await activeWallet()
    await btcPay.initialize({})

    btcPay.on('sync-end', async () => {
      const amount = {
        amount: 0.00001,
        unit: 'main',
        address: 'bcrt1qmdv57dzpj05zll6xcaq2hccwjv9d0hq003lp58',
        fee: 10,
      }

      const res = await btcPay.sendTransaction({}, amount)
      await btcPay.destroy()

    })
    await btcPay.syncTransactions()

  })
})
