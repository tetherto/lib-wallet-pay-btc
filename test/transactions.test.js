const test = require('brittle')
const {
  activeWallet,
  regtestNode,
  pause,
  BitcoinCurrency
} = require('./test-helpers.js')

test.test('sendTransaction', { timeout: 600000 }, async function (t) {
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

test.test('fund new wallet and spend from it. check balances, confirmations', { timeout: 600000 }, async function (t) {
  // We create a new wallet, send 2 utxo. we attempt to spend 1 whole utxo with amount
  // In order to pay for the fee, we must utilise the second utxo to pay for fees
  const regtest = await regtestNode()
  t.comment('create new wallet')
  const btcPay = await activeWallet({ newWallet: true })
  const addr = await btcPay.getNewAddress()
  const { result: nodeAddr } = await regtest.getNewAddress()
  t.comment('sending utxo to wallet')
  const { result: utxo1 } = await regtest.sendToAddress({ address: addr.address, amount: 0.1 })
  const { result: utxo2 } = await regtest.sendToAddress({ address: addr.address, amount: 0.1 })
  t.comment('waiting for confirmation')
  await btcPay._onNewTx()
  await regtest.mine(1)
  await btcPay._onNewTx()
  await regtest.mine(1)
  await btcPay._onNewTx()
  const balance = await btcPay.getBalance()
  t.ok(balance.confirmed.toNumber() === 20000000, 'balance added by 0.2 btc')
  const data = {
    amount: 0.1,
    unit: 'main',
    address: nodeAddr,
    fee: 10
  }
  const res = await btcPay.sendTransaction({}, data)
  const spentAmount = res.totalSpent * -1
  const totalBal = 20000000
  t.comment('waiting for confirmation')
  await btcPay._onNewTx()
  await regtest.mine(1)
  t.comment('checking balance transitions')
  let bb = await btcPay.getBalance()
  t.ok(bb.mempool.toNumber() === spentAmount, 'mempool balance is negative of totalSpent')
  t.ok(bb.pending.toNumber() === 0, 'pending balance is 0')
  t.ok(bb.confirmed.toNumber() === totalBal, 'confirmed  balance is 0.2')
  await btcPay._onNewTx()
  bb = await btcPay.getBalance()
  t.ok(bb.mempool.toNumber() === 0, 'mempool balance is 0')
  t.ok(bb.pending.toNumber() === spentAmount, 'pending balance is negative of totalSpent')
  t.ok(bb.confirmed.toNumber() === totalBal, 'confirmed balance is 0.2')
  await regtest.mine(1)
  await btcPay._onNewTx()
  bb = await btcPay.getBalance()
  t.ok(bb.mempool.toNumber() === 0, 'mempool balance is 0')
  t.ok(bb.pending.toNumber() === 0, 'pending balance is 0')
  const confirmedBal = totalBal - res.totalSpent
  t.ok(bb.confirmed.toNumber() === confirmedBal, 'confirmed balance is ' + confirmedBal)

  const utxoset = res.utxo.filter((utxo, i) => {
    if ([utxo1, utxo2].includes(utxo.txid)) {
      return false
    }
    return true
  })
  t.ok(utxoset.length === 0, 'all utxos used for tx')
  await btcPay.destroy()
})

test.test('Spending whole UTXO for amount, not enough to pay for fees', { timeout: 600000 }, async function (t) {
  const regtest = await regtestNode()
  t.comment('create new wallet')
  const btcPay = await activeWallet({ newWallet: true })
  const addr = await btcPay.getNewAddress()
  const { result: nodeAddr } = await regtest.getNewAddress()
  t.comment('sending utxo to wallet')
  await regtest.sendToAddress({ address: addr.address, amount: 0.1 })
  await regtest.sendToAddress({ address: addr.address, amount: 0.1 })
  t.comment('waiting for confirmation')
  await btcPay._onNewTx()
  await regtest.mine(1)
  await btcPay._onNewTx()
  await regtest.mine(1)
  await btcPay._onNewTx()
  const balance = await btcPay.getBalance()
  t.ok(balance.confirmed.toNumber() === 20000000, 'balance added by 0.2 btc')
  const data = {
    amount: 0.2,
    unit: 'main',
    address: nodeAddr,
    fee: 10
  }
  try {
    await btcPay.sendTransaction({}, data)
  } catch (err) {
    t.ok(err.message.includes('insufficient funds'), ' should insufficient funds')
    await btcPay.destroy()
    t.end()
    return
  }
  t.fail('should have thrown error')
})

test.test('perform 2 transactions from 1 utxo before confirmation. Spending from change address', { timeout: 600000 }, async function (t) {
  // We create a new wallet, send 2 utxo. we attempt to spend 1 whole utxo with amount
  // In order to pay for the fee, we must utilise the second utxo to pay for fees
  const regtest = await regtestNode()
  t.comment('create new wallet')
  const btcPay = await activeWallet({ newWallet: true })
  const addr = await btcPay.getNewAddress()
  const { result: nodeAddr } = await regtest.getNewAddress()
  t.comment('sending utxo to wallet')
  await regtest.sendToAddress({ address: addr.address, amount: 0.1 })
  t.comment('waiting for confirmation')
  await btcPay._onNewTx()
  await regtest.mine(1)
  await btcPay._onNewTx()
  await regtest.mine(1)
  await btcPay._onNewTx()
  const balance = await btcPay.getBalance()
  t.ok(balance.confirmed.toNumber() === 10000000, 'balance added by 0.1 btc')
  const data = {
    amount: 0.02,
    unit: 'main',
    address: nodeAddr,
    fee: 10
  }
  const txp = btcPay.sendTransaction({}, data)
  txp.broadcasted((tx) => {
    t.comment(`sent tx 1: ${tx.txid}`)
  })
  const tx1 = await txp
  let bal = await btcPay.getBalance()
  t.ok(bal.mempool.toNumber() * -1 === tx1.totalSpent, 'mempool balance matches total spent for tx 1')
  // We send second transaction spending change amount
  const txp2 = btcPay.sendTransaction({}, data)
  txp2.broadcasted((tx) => {
    t.comment(`sent tx 2: ${tx.txid}`)
  })
  const tx2 = await txp2
  bal = await btcPay.getBalance()
  const totalSent = tx1.totalSpent + tx2.totalSpent
  t.ok(bal.mempool.toNumber() * -1 === totalSent, 'mempool balance matches total spent for tx1 + tx2')
  await btcPay.destroy()
})

//
//
// Uncomment the transaction below to keep doing TX
//
//

// test.solo('sweep wallet ', { timeout: 10000000 }, async (t)=>{
//  // Leave this running to keep doing transactions
//  const regtest = await regtestNode()
//  const btcPay = await activeWallet({ newWallet: true })
//  const amount = 0.1
//
//  t.comment('funding new wallet')
//  const addr = await btcPay.getNewAddress()
//  await regtest.sendToAddress({ address: addr.address, amount })
//  const { result: nodeAddr } = await regtest.getNewAddress()
//  await regtest.mine(3)
//  await btcPay._onNewTx()
//  let bal = await btcPay.getBalance()
//  t.ok(+bal.consolidated.toMainUnit() === amount, 'balance matches')
//
//  let x = 0
//  while ( bal.consolidated.toNumber() !== 0) {
//    console.log(x)
//    x++
//    const data = {
//      amount: 700,
//      unit: 'base',
//      address: nodeAddr,
//      fee: 5,
//      deductFee: true
//    }
//    t.comment('sending')
//    let sent
//    try {
//      sent = await btcPay.sendTransaction({}, data)
//    } catch (err) {
//      console.log(err)
//    }
//    await regtest.mine(1)
//    await btcPay._onNewTx()
//
//    bal  = await btcPay.getBalance()
//    t.comment('new balance: '+bal.consolidated.toMainUnit())
//
//  }
// })
