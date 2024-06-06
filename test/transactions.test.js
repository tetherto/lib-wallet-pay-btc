const test = require('brittle')
const {
  activeWallet,
  regtestNode,
  pause,
  promiseSteps,
  BitcoinCurrency
} = require('./test-helpers.js')

test.test('sendTransaction', { timeout: 600000 }, async function (t) {
  // TODO: write tests for bad transactions.
  // TODO: compare balance to make sure is reduced
  // TODO: tests for mempool transactions

  t.test('create transaction, mine and compare result with electrum', async function (t) {
    const regtest = await regtestNode()
    const btcPay = await activeWallet()

    const { result: nodeAddr } = await regtest.getNewAddress()

    // const fuzz = Array.from({ length: 10 }, () => Math.random() * (2 - 0.00000546) + 0.00000546).map(num => +num.toFixed(8));
    const fuzz = []
    const amounts = [0.1, 0.001, 0.01999, 0.031, 0.000666, 0.008484, 0.0091, 0.002001, 0.00000546].concat(fuzz)
    const fee = [2, 10, 20, 100, 300]

    async function send (amount, index) {
      const data = {
        amount,
        unit: 'main',
        address: nodeAddr,
        fee: fee[index] || +(Math.random() * 1000).toFixed()
      }
      console.log('sending amount', data)
      const res = await btcPay.sendTransaction({}, data)

      console.log(res)

      await btcPay.provider._getTransaction(res.txid)
      await regtest.mine(1)

      const eTx = await btcPay.provider._getTransaction(res.txid)
      t.ok(eTx.hex === res.hex, 'tx hex is same')
      t.ok(eTx.vsize === res.vSize, 'vsize is same')
      t.ok(eTx.vin.length === res.utxo.length, 'same number of vin')
      t.ok(res.vout.length === eTx.vout.length, 'same number of vout')
      eTx.vin.forEach((vin, i) => {
        const resVin = res.utxo[i]
        t.ok(vin.txid === resVin.txid, 'vin txid is same')
        t.ok(vin.vout === resVin.index, 'vin index is same')
      })
      res.vout.forEach((vout, i) => {
        const eVout = eTx.vout[i]
        t.ok(eVout.n === i, 'vout index is same')
        t.ok(new BitcoinCurrency(vout.value, 'base').eq(new BitcoinCurrency(eVout.value, 'main')), 'vout value is same: ' + eVout.value)
      })
      const eOut = eTx.vout[0]
      const eChange = eTx.vout[1]
      t.ok(eOut.scriptPubKey.address === nodeAddr, 'output address is same')
      t.ok(eChange.scriptPubKey.address === res.changeAddress.address, 'change address is same')
      t.ok(res, 'transaction sent')
    }

    await btcPay.syncTransactions()

    let c = 0
    for (const amount of amounts) {
      await send(amount, c)
      await pause(10000)
      c++
    }
    await btcPay.destroy()
  })
})

test.solo('balance reduction', { timeout: 600000 }, async function (t) {
  const test = t.test('balance reduction')
  test.plan(1)
  const regtest = await regtestNode()
  t.comment('create new wallet')
  const btcPay = await activeWallet({ newWallet: true })
  const addr = await btcPay.getNewAddress()
  const { result: nodeAddr } = await regtest.getNewAddress()

  t.comment('send 1 btc to new wallet ')

  btcPay.once('new-tx', async function () {
    t.comment('tx received')
    const balance = await btcPay.getBalance()
    const total = balance.pending.add(balance.confirmed)
    t.ok(total.toString() === '10000000', 'balance added by 0.1 btc')
    send()
  })

  async function send() {
    async function confirmed(){
      t.comment('tx confirmed')
      const balance = await btcPay.getBalance()
      console.log(balance)
      t.ok(balance.mempool.toNumber() === (sentTx.totalSpent * -1), 'mempool balance is same totalSpent')

    }

    btcPay.once('new-tx', async function () {
      t.comment('tx detected in mempool')
      const balance = await btcPay.getBalance()
      t.ok(balance.mempool.toNumber() === (sentTx.totalSpent * -1), 'mempool balance is same totalSpent')
      btcPay.on('new-tx', confirmed)
      t.comment('mining')
      regtest.mine(1)
    })
    const data = {
      amount : 0.0001,
      unit: 'main',
      address: nodeAddr,
      fee:(Math.random() * 1000).toFixed()
    }
    console.log('sending amount', data)
    const sentTx = await btcPay.sendTransaction({}, data)
    console.log(sentTx)
  }

  const pass = promiseSteps(['mempool', 'pending', 'confirmed'])
  await btcPay.syncTransactions()
  await regtest.sendToAddress({ address: addr.address, amount: 0.1 })
  t.comment('mining blocks')
  await regtest.mine(3)

  await test
  await btcPay.destroy()

  test.pass('done')
  console.log(111)

})

