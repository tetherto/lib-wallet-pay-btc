const test = require('brittle')
const assert = require('assert')
const Btc = require('../src/currency.js')


test('Currency: Bitcoin', async (t) => {
  test('Units', async (t) => {
    const btc = new Btc(1, 'main')
    t.ok(btc.name === 'BTC', 'currency name is BTC')
    t.ok(btc.base_name === 'SATS', 'currency name is SATS')

    const base = btc.toBaseUnit()
    t.ok(100000000 === +base, 'toBaseUnit is correct')
    t.ok(1 === +btc.toMainUnit(base), 'toMainUnit is correct')
  })

  test('isUnitOf', async (t) => {
    const btc = new Btc(1, 'main')
    try {
      btc.isUnitOf('SATS')
    } catch(err) {
      t.ok(err.message === 'Amount must be an instance of Bitcoin', 'isUnitOf is implemented')
    }
  })

  test('Math: add', async (t) => {
    const btc = new Btc(1, 'main')
    const btc2 = btc.add(btc)

    t.ok(+btc2.toMainUnit() === 2, 'add: 1+1=2')

    const btc3 = btc2.add(new Btc(100000001, 'base'))
    t.ok(+btc3.toMainUnit() === 3.00000001, 'add: 2 + 1.00000001 = 3.00000001')
  })
  
  test('Math: minus', async (t) => {
    const btc = new Btc(2, 'main')
    const btc2 = btc.minus(btc)

    t.ok(+btc2.toMainUnit() === 0, 'add: 2-2=0')

    const btc3 = btc.minus(new Btc(100000001, 'base'))
    t.ok(+btc3.toMainUnit() === 0.99999999, 'minus: 2-1.00000001 = 0.99999999')
  })

  test('Math: lte', async (t) => {
    const btc2 = new Btc(2, 'main')
    const btc1 = new Btc(1, 'main')
    t.ok(btc1.lte(btc2), '1 <= 2')
  })

  test('Math: gte', async (t) => {
    const btc2 = new Btc(2, 'main')
    const btc1 = new Btc(1, 'main')
    t.ok(btc2.gte(btc1), '2 >= 1')
  })

  test('Math: gte', async (t) => {
    const btc2 = new Btc(2, 'main')
    const btc1 = new Btc(2, 'main')
    t.ok(btc2.eq(btc1), '2 == 2')
    t.ok(btc2.eq(new Btc(3, 'main')) === false, ' 2 != 3')
  })

})
