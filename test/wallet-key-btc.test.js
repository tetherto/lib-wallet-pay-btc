const test = require('brittle')
const assert = require('assert')
const Currency = require('wallet/src/lib/currency.js')


test('Currency', async (t) => {
  test('Currency: create', async (t) => {
    const currency = new Currency({
      name: 'bitcoin',
      symbol: 'btc',
      decimals: 8
    })
    assert(currency.name === 'bitcoin')
    assert(currency.symbol === 'btc')
    assert(currency.decimals === 8)
  })
})
