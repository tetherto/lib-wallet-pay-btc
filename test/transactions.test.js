
const test = require('brittle')
const { 
  KeyManager,
  activeWallet
} = require('./test-helpers.js')

test.test('sendTransaction', async function(t) {

  t.test('sendBasic', async function(t) {

    const btcPay = await activeWallet()
    await btcPay.initialize({})

    btcPay.on('sync-end', async () => {
      await btcPay.sendTransaction({}, {
        amount: 0.00001,
        unit: 'main',
        address: 'bcrt1qxkxzmp6yff2yfl307vlgzc0m6v75axhaamnrqs'
      })
    })

    await btcPay.syncTransactions()

    await btcPay.destroy()
    
  })
})
