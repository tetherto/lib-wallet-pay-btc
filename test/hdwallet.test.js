
const test = require('brittle')
const assert = require('assert')
const HdWallet = require('../src/hdwallet.js')
const { WalletStoreMemory } = require("./test-helpers.js")


test('hdwallet', async function(t) {

  t.test('parsePath', async function(t) {
    const path = "m/44'/0'/1'/2/3"
    const parsed = HdWallet.parsePath(path)
    t.ok(parsed.purpose === "44'", 'purpose')
    t.ok(parsed.coin_type === "0'", 'coin_type')
    t.ok(parsed.account === "1'", 'account')
    t.ok(parsed.change === 2, 'change')
    t.ok(parsed.index === 3, 'index')
  })

  t.test('mergePath', async function(t) {
    const path = "m/44'/0'/1'/2/3"
    const parsed = HdWallet.parsePath(path)
    const merged = HdWallet.mergePath(parsed)
    t.ok(path === merged, 'merged path works')
  })

  t.test('eachAccount', async function(t) {
    const store = new WalletStoreMemory()
    const hd = new HdWallet({ store })
    await hd.init({})
    
    let expect = [
      "m/84'/0'/0'/0/0",
      "m/84'/0'/0'/0/1"
    ]
    let count = 0 
    await hd.eachAccount('external', null, async function(path, next) {
      t.ok(path === expect[count], 'external paths match: '+ expect[count])
      if(count >= expect.length - 1) {
        return next()
      }
      count += 1
    })
    expect = [
      "m/84'/0'/0'/1/0",
      "m/84'/0'/0'/1/1"
    ]
    count = 0 
    await hd.eachAccount('internal', null, async function(path, next) {
      t.ok(path === expect[count], 'internal paths match: '+ expect[count])
      if(count >= expect.length - 1) {
        return next()
      }
      count += 1
    })

  })
})
